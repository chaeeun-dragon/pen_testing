#!/usr/bin/env python3
"""Local-only operator console for the Haeon diagnostic API scenario."""
import json, os, re, threading, uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

PORT = int(os.environ.get("CONSOLE_PORT", "8094"))
SUPPORT = os.environ.get("SUPPORT_BASE_URL", "http://haeon-merchant-support:8091").rstrip("/")
CONTROL = os.environ.get("LAB_CONTROL_TOKEN", "lab-control-token-2026")
LOGIN = os.environ.get("LAB_MERCHANT_LOGIN", "labmart")
PASSWORD = os.environ.get("LAB_MERCHANT_PASSWORD", "LabMart!2026")
DATA = Path(os.environ.get("CONSOLE_DATA_DIR", "/data"))
STATE_FILE = DATA / "console-state.json"
PRIVATE_FILE = DATA / "private-sessions.json"
EXPORT = Path(os.environ.get("CONSOLE_EVIDENCE_DIR", "/evidence/console"))
WEB = Path(__file__).parent / "www"
LOCK = threading.RLock()
ACTION_LOCK = threading.Lock()


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def read_state():
    try:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        if isinstance(state, dict) and isinstance(state.get("runs"), list):
            state.setdefault("pendingResponseRunId", None)
            return state
    except (OSError, ValueError):
        pass
    return {"runs": [], "pendingResponseRunId": None}


STATE = read_state()
try:
    PRIVATE_SESSIONS = json.loads(PRIVATE_FILE.read_text(encoding="utf-8"))
except (OSError, ValueError):
    PRIVATE_SESSIONS = {}


def remember_session(run_id, token):
    # Never put bearer credentials into public state, evidence, logs or the DOM.
    with LOCK:
        PRIVATE_SESSIONS[run_id] = token
        PRIVATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        temp = PRIVATE_FILE.with_suffix(".tmp")
        temp.write_text(json.dumps(PRIVATE_SESSIONS), encoding="utf-8")
        os.replace(temp, PRIVATE_FILE)
        os.chmod(PRIVATE_FILE, 0o600)


def archive(run_id):
    try:
        snapshot = detail(run_id)
        if snapshot:
            EXPORT.mkdir(parents=True, exist_ok=True)
            (EXPORT / (run_id + ".json")).write_text(
                json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        patch_run(run_id, evidenceWarning="증거 파일 저장 실패 · 저장소 확인 필요")


def save():
    DATA.mkdir(parents=True, exist_ok=True)
    temp = STATE_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(STATE, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temp, STATE_FILE)


def find_run(run_id):
    return next((r for r in STATE["runs"] if r["runId"] == run_id), None)


def patch_run(run_id, **values):
    with LOCK:
        row = find_run(run_id)
        if row:
            row.update(values)
            row["updatedAt"] = now()
            save()


def stage(run_id, label, status, detail=None):
    with LOCK:
        row = find_run(run_id)
        if row:
            entry = {"at": now(), "label": label, "status": status}
            if detail:
                entry["detail"] = detail
            entries = row.setdefault("stages", [])
            previous = next((x for x in reversed(entries) if x["label"] == label and x["status"] == "RUNNING"), None)
            if previous and status != "RUNNING":
                previous.update(entry)
            else:
                entries.append(entry)
            row["updatedAt"] = now()
            save()


def call(method, path, body=None, merchant=None, control=False, timeout=8):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if merchant:
        headers["Authorization"] = "Bearer " + merchant
    if control:
        headers["X-Lab-Control-Token"] = CONTROL
    try:
        with urlopen(Request(SUPPORT + path, data=data, headers=headers, method=method), timeout=timeout) as r:
            raw, code = r.read(), r.status
    except HTTPError as e:
        raw, code = e.read(), e.code
    except (URLError, TimeoutError, OSError) as e:
        return 502, {"errorCode": "UPSTREAM_UNAVAILABLE", "message": str(getattr(e, "reason", e))}
    try:
        return code, json.loads(raw.decode()) if raw else {}
    except (UnicodeDecodeError, ValueError):
        return code, {"errorCode": "INVALID_UPSTREAM_RESPONSE", "message": "지원 서비스 응답을 읽지 못했습니다."}


def error_info(value):
    return {"errorCode": value.get("errorCode", "UPSTREAM_ERROR"),
            "message": value.get("message", "요청을 처리하지 못했습니다.")}


def execute(run_id, mode):
    merchant = None
    try:
        stage(run_id, "가맹점 지원 계정 인증", "RUNNING")
        code, result = call("POST", "/merchant/v1/sessions",
                            {"loginId": LOGIN, "password": PASSWORD})
        if code != 200 or not result.get("sessionToken"):
            stage(run_id, "가맹점 지원 계정 인증", "ERROR", error_info(result))
            patch_run(run_id, status="ERROR", summary="가맹점 인증 실패")
            return
        merchant = result["sessionToken"]
        stage(run_id, "가맹점 지원 계정 인증", "SUCCESS", {"merchantNo": result.get("merchantNo")})

        stage(run_id, "등록 진단 대상 확인", "RUNNING")
        code, targets = call("GET", "/merchant/v1/diagnostic-targets", merchant=merchant)
        target = next((x for x in targets if x.get("targetId") == "diag-target-mart"), None) if isinstance(targets, list) else None
        if code != 200 or not target:
            stage(run_id, "등록 진단 대상 확인", "ERROR",
                  error_info(targets if isinstance(targets, dict) else {}))
            patch_run(run_id, status="ERROR", summary="등록 진단 대상을 확인하지 못했습니다.")
            return
        stage(run_id, "등록 진단 대상 확인", "SUCCESS", {"target": target.get("displayName", "진단 대상")})

        request = {"targetId": target["targetId"],
                   "option": "status" if mode == "baseline" else "status;LAB_SHELL"}
        if mode != "baseline":
            request["runId"] = run_id
        stage(run_id, "진단 요청 전송", "RUNNING", {"mode": mode})
        code, result = call("POST", "/merchant/v1/diagnostics/connectivity", request, merchant)
        stage(run_id, "진단 요청 전송", "SUCCESS" if code in (200, 403) else "ERROR", {"httpStatus": code})
        if mode == "baseline":
            if code == 200 and result.get("result") == "SUCCESS":
                stage(run_id, "등록 대상 연결 진단", "SUCCESS", {"latencyMs": result.get("latencyMs")})
                patch_run(run_id, status="COMPLETED", summary="등록된 진단 대상 연결 정상")
            else:
                stage(run_id, "등록 대상 연결 진단", "ERROR", error_info(result))
                patch_run(run_id, status="ERROR", summary="정상 연결 진단 실패")
            return
        if mode == "after":
            if code == 403 and result.get("errorCode") == "DIAGNOSTIC_INPUT_BLOCKED":
                stage(run_id, "비정상 진단 입력 탐지·차단", "BLOCKED",
                      {"httpStatus": code, "errorCode": result.get("errorCode"), "control": "허용 진단 옵션 목록"})
                stage(run_id, "세션 생성 · 자료 조회 · 전송", "SKIPPED", {"message": "선행 단계 차단으로 미실행"})
                normal_code, normal = call("POST", "/merchant/v1/diagnostics/connectivity",
                    {"targetId": target["targetId"], "option": "status"}, merchant)
                normal_ok = normal_code == 200 and normal.get("result") == "SUCCESS"
                stage(run_id, "After 정상 진단 재검증", "SUCCESS" if normal_ok else "ERROR",
                      {"httpStatus": normal_code, "latencyMs": normal.get("latencyMs"),
                       "result": normal.get("result"), "errorCode": normal.get("errorCode")})
                patch_run(run_id, status="BLOCKED" if normal_ok else "ERROR",
                          summary="비정상 입력 403 차단 · 정상 진단 유지" if normal_ok else "입력은 차단됐지만 정상 진단 재검증 실패")
            else:
                stage(run_id, "비정상 진단 입력 탐지·차단", "ERROR",
                      {"httpStatus": code, **error_info(result)})
                patch_run(run_id, status="ERROR", summary="차단 결과를 확인하지 못했습니다.")
            return

        if code != 200 or result.get("result") != "ALERT" or not result.get("shellSessionToken"):
            stage(run_id, "제한된 모의 웹 세션 생성", "ERROR",
                  {"httpStatus": code, **error_info(result)})
            patch_run(run_id, status="ERROR", summary="모의 세션을 확인하지 못했습니다.")
            return
        shell = result["shellSessionToken"]
        remember_session(run_id, shell)
        stage(run_id, "제한된 모의 웹 세션 생성", "ALERT", {"result": "ALERT"})

        stage(run_id, "합성 지원 자료 조회", "RUNNING")
        code, records = call("GET", f"/lab-shell/v1/sessions/{shell}/records")
        if code != 200:
            stage(run_id, "합성 지원 자료 조회", "ERROR", {"httpStatus": code, **error_info(records)})
            patch_run(run_id, status="ERROR", summary="합성 자료 조회 실패")
            return
        count = records.get("recordCount", 0)
        stage(run_id, "합성 지원 자료 조회", "ALERT", {"recordCount": count, "memberNo": "HC-MEMBER-001"})

        stage(run_id, "내부 수신기로 전송", "RUNNING")
        code, transfer = call("POST", f"/lab-shell/v1/sessions/{shell}/exfiltrate",
                              {"transferId": "TRANSFER-" + run_id})
        receipt_ok = (code == 200 and transfer.get("receiverStatus") == "RECEIVED"
                      and transfer.get("transferId") == "TRANSFER-" + run_id
                      and transfer.get("runId") == run_id and transfer.get("recordCount") == count
                      and isinstance(transfer.get("payloadSha256"), str)
                      and re.fullmatch(r"[a-f0-9]{64}", transfer["payloadSha256"]) is not None)
        if receipt_ok:
            stage(run_id, "내부 수신기로 전송", "ALERT", {
                "recordCount": transfer.get("recordCount", count),
                "receiverStatus": transfer.get("receiverStatus"),
                "payloadSha256": transfer.get("payloadSha256"),
                "transferId": transfer.get("transferId"),
                "runId": transfer.get("runId"),
            })
            patch_run(run_id, status="ALERT", summary="합성 자료 수신 기록 확인")
        else:
            stage(run_id, "내부 수신기로 전송", "ERROR",
                  {"httpStatus": code, **error_info(transfer)})
            patch_run(run_id, status="ERROR", summary="수신 결과를 확인하지 못했습니다.")
    except Exception as e:
        stage(run_id, "시나리오 실행 오류", "ERROR", {"message": str(e)[:200]})
        patch_run(run_id, status="ERROR", summary="서비스 호출 중 오류가 발생했습니다.")
    finally:
        if merchant:
            call("DELETE", "/merchant/v1/sessions", merchant=merchant)
        archive(run_id)


def detail(run_id):
    with LOCK:
        item = find_run(run_id)
        row = dict(item) if item else None
    if not row:
        return None
    events, upstream_state, upstream_error = [], None, None
    if row.get("controlRunId"):
        code, events_value = call("GET", f"/control/v1/runs/{row['controlRunId']}/events", control=True)
        if code == 200 and isinstance(events_value, list):
            events = events_value
        else:
            upstream_error = "보안 이벤트를 갱신하지 못했습니다."
        code, state_value = call("GET", f"/control/v1/runs/{row['controlRunId']}", control=True)
        if code == 200:
            upstream_state = state_value
            if state_value.get("status") == "CONTAINED" and row.get("status") != "CONTAINED":
                patch_run(run_id, status="CONTAINED", summary="지원 서비스에서 대응 완료 확인")
                row["status"] = "CONTAINED"
                with LOCK:
                    if STATE.get("pendingResponseRunId") == run_id:
                        STATE["pendingResponseRunId"] = None
                        save()
        else:
            upstream_error = "지원 서비스의 현재 상태를 확인하지 못했습니다."
    with LOCK:
        pending = STATE.get("pendingResponseRunId")
    return {"run": row, "supportState": upstream_state, "events": events, "pendingResponseRunId": pending, "upstreamError": upstream_error}


def respond(run_id):
    if not ACTION_LOCK.acquire(False):
        return 409, {"errorCode": "SCENARIO_BUSY", "message": "다른 시나리오 작업이 끝난 뒤 다시 시도하세요."}
    try:
        row = detail(run_id)
        if not row:
            return 404, {"errorCode": "RUN_NOT_FOUND", "message": "실행 기록을 찾을 수 없습니다."}
        item = row["run"]
        if item.get("status") == "RUNNING":
            return 409, {"errorCode":"RUN_IN_PROGRESS", "message":"진행 중인 단계가 끝난 뒤 대응을 실행하세요."}
        if item.get("status") == "CONTAINED" and item.get("containmentVerified"):
            return 200, row
        if item.get("mode") != "before" or not item.get("controlRunId"):
            return 409, {"errorCode": "RESPONSE_NOT_AVAILABLE", "message": "대응할 Before 실행이 아닙니다."}
        stage(run_id, "실행 세션 폐기 및 회원 보호 안내 등록", "RUNNING")
        code, result = call("POST", f"/control/v1/runs/{item['controlRunId']}/respond", control=True)
        if code != 200:
            stage(run_id, "실행 세션 폐기 및 회원 보호 안내 등록", "ERROR",
                  {"httpStatus": code, **error_info(result)})
            return code, result
        with LOCK:
            if STATE.get("pendingResponseRunId") == run_id:
                STATE["pendingResponseRunId"] = None
                save()
        stage(run_id, "실행 세션 폐기 및 회원 보호 안내 등록", "BLOCKED", {
            "result": result.get("result"),
            "protectionNoticeCreated": result.get("protectionNoticeCreated"),
        })
        shell = PRIVATE_SESSIONS.get(run_id)
        verified = False
        if shell:
            checks = []
            for label, method, path, body in (
                ("이전 세션 재조회 거부 검증", "GET", "records", None),
                ("이전 세션 재전송 거부 검증", "POST", "exfiltrate", {"transferId": "REPLAY-" + run_id}),
            ):
                retry_code, retry = call(method, f"/lab-shell/v1/sessions/{shell}/{path}", body)
                denied = retry_code == 403 and retry.get("errorCode") in {"SHELL_SESSION_REVOKED", "RUN_CONTAINED"}
                checks.append(denied)
                stage(run_id, label, "BLOCKED" if denied else "ERROR",
                      {"httpStatus": retry_code, "errorCode": retry.get("errorCode"), "sameBeforeSession": True})
            verified = all(checks)
        else:
            stage(run_id, "이전 세션 재접근 검증", "ERROR", {"message": "이전 버전 실행은 비공개 세션이 없어 재검증 불가 · 새 Before 필요"})
        patch_run(run_id, status="CONTAINED", containmentVerified=verified,
                  summary="세션 폐기 · 재조회/재전송 403 확인" if verified else "세션 폐기 완료 · 재접근 거부는 미검증")
        archive(run_id)
        return 200, detail(run_id)
    finally:
        ACTION_LOCK.release()


def reset_demo(confirmation):
    if confirmation != "RESET_HAEON_DEMO":
        return 400, {"errorCode": "RESET_CONFIRMATION_REQUIRED", "message": "초기화 확인이 필요합니다."}
    if not ACTION_LOCK.acquire(False):
        return 409, {"errorCode": "SCENARIO_BUSY", "message": "다른 시나리오 작업이 끝난 뒤 초기화하세요."}
    try:
        with LOCK:
            if any(run.get("status") == "RUNNING" for run in STATE["runs"]):
                return 409, {"errorCode": "RUN_IN_PROGRESS", "message": "진행 중인 실행이 끝난 뒤 초기화하세요."}
        code, result = call("POST", "/control/v1/reset", control=True)
        if code != 200 or result.get("result") != "RESET":
            return (code if code != 200 else 502), {
                "errorCode": result.get("errorCode", "UPSTREAM_RESET_FAILED"),
                "message": result.get("message", "지원 서비스 초기화를 확인하지 못했습니다."),
            }
        with LOCK:
            count = len(STATE["runs"])
            STATE["runs"] = []
            STATE["pendingResponseRunId"] = None
            STATE.pop("card03", None)
            PRIVATE_SESSIONS.clear()
            if PRIVATE_FILE.exists():
                PRIVATE_FILE.write_text("{}", encoding="utf-8")
            try:
                save()
            except OSError:
                return 500, {"errorCode": "CONSOLE_RESET_SAVE_FAILED",
                             "message": "실습 상태는 초기화됐지만 콘솔 이력 저장에 실패했습니다. 저장소 상태를 확인하세요."}
        return 200, {"result": "RESET", "consoleRunsDeleted": count,
                     "runsDeleted": result.get("runsDeleted", 0),
                     "protectionNoticesDeleted": result.get("protectionNoticesDeleted", 0)}
    finally:
        ACTION_LOCK.release()


def create_run(mode):
    if not isinstance(mode, str) or mode not in {"baseline", "before", "after"}:
        return 400, {"errorCode": "INVALID_MODE", "message": "지원하지 않는 실행 모드입니다."}
    if not ACTION_LOCK.acquire(False):
        return 409, {"errorCode": "SCENARIO_BUSY", "message": "다른 시나리오가 시작 중입니다."}
    try:
        with LOCK:
            active = next((r for r in STATE["runs"] if r.get("status") == "RUNNING"), None)
            if active:
                return 409, {"errorCode": "SCENARIO_BUSY",
                             "message": "진행 중인 시나리오가 끝날 때까지 기다리세요.",
                             "runId": active["runId"]}
            pending = STATE.get("pendingResponseRunId")
            if mode in {"before", "after"} and pending:
                return 409, {"errorCode": "RESPONSE_REQUIRED",
                             "message": "Before 실행 대응을 먼저 완료하세요.", "runId": pending}
            if mode == "after":
                previous = next((r for r in STATE["runs"] if r.get("mode") == "before"), None)
                if not previous or not previous.get("containmentVerified"):
                    return 409, {"errorCode": "VERIFIED_BEFORE_REQUIRED",
                                 "message": "새 Before 실행과 같은 세션 재접근 거부 검증을 먼저 완료하세요."}
        control_id = None
        if mode in {"before", "after"}:
            code, result = call("POST", "/control/v1/runs", {
                "mode": mode, "merchantNo": "HAEON-MART", "memberNo": "HC-MEMBER-001",
            }, control=True)
            if code != 200 or not result.get("runId"):
                return 502, {"errorCode": "RUN_CREATE_FAILED",
                             "message": result.get("message", "실행을 생성하지 못했습니다.")}
            control_id = result["runId"]
        run_id = control_id or (
            "HAEON-BASELINE-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
            + "-" + uuid.uuid4().hex[:4].upper())
        row = {
            "runId": run_id, "mode": mode, "status": "RUNNING",
            "summary": "정상 진단 진행 중" if mode == "baseline" else "시나리오 실행 준비 중",
            "createdAt": now(), "updatedAt": now(), "controlRunId": control_id, "stages": [],
        }
        with LOCK:
            if mode == "after":
                previous = next((r for r in STATE["runs"] if r.get("mode") == "before"), None)
                row["beforeRunId"] = previous["runId"] if previous else None
            if mode == "before":
                baseline = next((r for r in STATE["runs"] if r.get("mode") == "baseline" and r.get("status") == "COMPLETED"), None)
                row["baselineRunId"] = baseline["runId"] if baseline else None
            STATE["runs"].insert(0, row)
            STATE["runs"] = STATE["runs"][:40]
            if mode == "before":
                STATE["pendingResponseRunId"] = run_id
            save()
        if control_id:
            stage(run_id, "시나리오 실행 ID 발급", "SUCCESS", {"mode": mode})
        threading.Thread(target=execute, args=(run_id, mode), daemon=True).start()
        return 202, {"runId": run_id, "mode": mode, "status": "RUNNING"}
    finally:
        ACTION_LOCK.release()


def comparison_evidence(run):
    if not run:
        return None
    stages = run.get("stages") or []
    details = [item.get("detail") or {} for item in stages]
    record_count = next((detail.get("recordCount") for detail in details
                         if detail.get("recordCount") is not None), None)
    receiver_status = next((detail.get("receiverStatus") for detail in details
                            if detail.get("receiverStatus")), None)
    session_created = any(item.get("label") == "제한된 모의 웹 세션 생성"
                          and item.get("status") in ("SUCCESS", "ALERT") for item in stages)
    diagnostic_completed = any(item.get("label") == "등록 대상 연결 진단"
                               and item.get("status") == "SUCCESS" for item in stages)
    return {
        "runId": run.get("runId"),
        "status": run.get("status"),
        "sessionCreated": session_created,
        "recordCount": record_count,
        "receiverStatus": receiver_status,
        "diagnosticCompleted": diagnostic_completed,
        "normalAfterCompleted": any(item.get("label") == "After 정상 진단 재검증" and item.get("status") == "SUCCESS" for item in stages),
    }


def overview():
    with LOCK:
        runs = [{k: r.get(k) for k in ("runId", "mode", "status", "summary", "createdAt", "beforeRunId", "baselineRunId")}
                for r in STATE["runs"][:40]]
        pending = STATE.get("pendingResponseRunId")
        latest_baseline = next((record for record in STATE["runs"]
                                if record.get("mode") == "baseline"), None)
        latest_before = next((record for record in STATE["runs"]
                              if record.get("mode") == "before"), None)
        matched_after = next((
            record for record in STATE["runs"]
            if record.get("mode") == "after" and latest_before
            and record.get("beforeRunId") == latest_before.get("runId")
        ), None)
        comparison = {
            "baseline": comparison_evidence(latest_baseline),
            "before": comparison_evidence(latest_before),
            "after": comparison_evidence(matched_after),
        }
    health_code, health = call("GET", "/actuator/health", timeout=2)
    connected = health_code == 200 and health.get("status") == "UP"
    return {
        "targetConnected": connected,
        "scenarios": [
            {"id": "haeon-diagnostic-api", "name": "해온카드 진단 API", "status": "READY", "target": "haeon.localhost:8090"},
            {"id": "bookwave", "name": "북웨이브 자체 시나리오", "status": "PLANNED", "target": "별도 시나리오"},
            {"id": "mock-pg", "name": "PG 연동 시나리오", "status": "PLANNED", "target": "독립 연동 시나리오"},
        ],
        "runs": runs, "pendingResponseRunId": pending, "comparison": comparison,
    }


def card03_compare():
    if not ACTION_LOCK.acquire(False):
        return 409, {"errorCode": "SCENARIO_BUSY"}
    try:
        with LOCK:
            if any(r.get("status") == "RUNNING" for r in STATE["runs"]) or STATE.get("pendingResponseRunId"):
                return 409, {"errorCode": "SCENARIO_BUSY", "message": "주 시나리오의 실행과 대응을 먼저 마치세요."}
        code, result = call("POST", "/control/v1/card03/compare", control=True, timeout=35)
        if code != 200:
            return code, result
        with LOCK:
            STATE.setdefault("card03", []).insert(0, result)
            STATE["card03"] = STATE["card03"][:20]
            save()
        try:
            EXPORT.mkdir(parents=True, exist_ok=True)
            (EXPORT / (result["comparisonId"] + ".json")).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError:
            result["evidenceWarning"] = "증거 파일 저장 실패"
        return 200, result
    finally:
        ACTION_LOCK.release()


def terminal_records(run_id):
    """Fixed synthetic-data read for the separate terminal UI; never expose tokens."""
    if not isinstance(run_id, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,100}", run_id):
        return 400, {"errorCode": "INVALID_RUN_ID"}
    if not ACTION_LOCK.acquire(False):
        return 409, {"errorCode": "SCENARIO_BUSY"}
    try:
        with LOCK:
            run = find_run(run_id)
            if not run or run.get("mode") != "before":
                return 404, {"errorCode": "BEFORE_RUN_NOT_FOUND"}
            if run.get("status") == "RUNNING":
                return 409, {"errorCode": "RUN_IN_PROGRESS"}
            token = PRIVATE_SESSIONS.get(run_id)
        if not token:
            return 409, {"errorCode": "SESSION_NOT_AVAILABLE", "message": "해당 실행의 모의 세션이 없습니다. 새 Before 실행이 필요합니다."}
        code, value = call("GET", f"/lab-shell/v1/sessions/{token}/records")
        if code != 200:
            # A revoked session must be tested upstream, not simulated in the UI.
            allowed = {"SHELL_SESSION_REVOKED", "RUN_CONTAINED", "SHELL_SESSION_NOT_FOUND"}
            error = value.get("errorCode") if isinstance(value, dict) else None
            return code if code in {403, 404} and error in allowed else 502, {
                "errorCode": error if error in allowed else "RECORDS_UPSTREAM_UNAVAILABLE",
                "message": "자료 접근이 거부되었습니다." if error in allowed else "합성자료 응답을 확인하지 못했습니다.",
            }
        rows = value.get("records") if isinstance(value, dict) else None
        valid = (isinstance(rows, list) and len(rows) <= 50 and value.get("simulation") is True
                 and value.get("runId") == run_id and value.get("recordCount") == len(rows))
        if not valid:
            return 502, {"errorCode": "INVALID_SYNTHETIC_RESPONSE"}
        safe = []
        for row in rows:
            if (not isinstance(row, dict) or row.get("memberNo") != "HC-MEMBER-001"
                or not re.fullmatch(r"SUP-[0-9-]{1,24}", str(row.get("supportRef", "")))
                or not re.fullmatch(r"LAB-TXN-[0-9]{1,8}", str(row.get("transactionRef", "")))
                or not re.fullmatch(r"[0-9]{4}", str(row.get("cardLast4", "")))
                or type(row.get("amount")) not in (int, float) or not 0 <= row["amount"] <= 100000000
                or not isinstance(row.get("occurredAt"), str) or len(row["occurredAt"]) > 40):
                return 502, {"errorCode": "INVALID_SYNTHETIC_RESPONSE"}
            safe.append({key: row[key] for key in ("supportRef", "memberNo", "cardLast4", "transactionRef", "amount", "occurredAt")})
        return 200, {"runId": run_id, "simulation": True, "recordCount": len(safe), "records": safe,
                     "source": "live-lab-records-query", "queriedAt": now()}
    finally:
        ACTION_LOCK.release()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def log_message(self, fmt, *args):
        print(f"[attack-console] {self.address_string()} {fmt % args}", flush=True)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
            "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        super().end_headers()

    def send_json(self, status, value):
        raw = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def same_origin(self):
        origin, host = self.headers.get("Origin"), self.headers.get("Host", "")
        return not origin or origin.split("://", 1)[-1].rstrip("/") == host

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            return self.send_json(200, {"status": "UP", "service": "haeon-attack-console"})
        if path == "/api/overview":
            return self.send_json(200, overview())
        if path == "/api/card03":
            with LOCK:
                return self.send_json(200, {"runs": STATE.get("card03", [])})
        if path == "/api/evidence":
            with LOCK:
                return self.send_json(200, {"exportedAt": now(), "scope": "synthetic-filming-lab", "runs": STATE["runs"], "card03": STATE.get("card03", [])})
        if path == "/api/runs":
            with LOCK:
                return self.send_json(200, {"runs": STATE["runs"][:40]})
        match = re.fullmatch(r"/api/runs/([A-Za-z0-9-]{1,100})", path)
        if match:
            value = detail(match.group(1))
            return self.send_json(200, value) if value else self.send_json(404, {"errorCode": "RUN_NOT_FOUND"})
        return super().do_GET()

    def do_POST(self):
        if not self.same_origin():
            return self.send_json(403, {"errorCode": "ORIGIN_REJECTED"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > 16384:
                raise ValueError()
            body = json.loads(self.rfile.read(length).decode()) if length else {}
            if not isinstance(body, dict):
                raise ValueError()
        except (ValueError, UnicodeDecodeError):
            return self.send_json(400, {"errorCode": "INVALID_JSON"})
        if self.path == "/api/runs":
            code, value = create_run(body.get("mode"))
            return self.send_json(code, value)
        if self.path == "/api/terminal/records":
            code, value = terminal_records(body.get("runId"))
            return self.send_json(code, value)
        if self.path == "/api/card03/compare":
            code, value = card03_compare()
            return self.send_json(code, value)
        if self.path == "/api/demo/reset":
            code, value = reset_demo(body.get("confirmation"))
            return self.send_json(code, value)
        match = re.fullmatch(r"/api/runs/([A-Za-z0-9-]{1,100})/respond",
                             self.path.split("?", 1)[0])
        if match:
            code, value = respond(match.group(1))
            return self.send_json(code, value)
        return self.send_json(404, {"errorCode": "NOT_FOUND"})


if __name__ == "__main__":
    # A restarted process has no worker for previously RUNNING records.
    # Preserve its pending response and evidence, but never claim completion.
    for record in STATE["runs"]:
        if record.get("status") == "RUNNING":
            record.update(status="ERROR", summary="콘솔 재시작으로 실행 중단 · 대응 후 다시 검증하세요", updatedAt=now())
            record.setdefault("stages", []).append({"at":now(), "label":"콘솔 재시작으로 실행 중단", "status":"ERROR"})
    save()
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
