(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const statusNames = {RUNNING:"진행 중",ALERT:"탐지됨",CONTAINED:"대응 완료",BLOCKED:"차단됨",COMPLETED:"완료",ERROR:"확인 필요"};
  const stageNames = {RUNNING:"진행 중",SUCCESS:"완료",ALERT:"탐지",BLOCKED:"차단",SKIPPED:"미실행",ERROR:"오류"};
  let selectedBeforeId = "";
  let loading = false;
  let refreshQueued = false;

  function setText(id, value) { $(id).textContent = value == null ? "—" : String(value); }
  function shortId(id) { return id ? String(id) : "—"; }
  function formatTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("ko-KR", {month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"});
  }
  function setResult(id, value, tone) {
    const node = $(id);
    node.textContent = value;
    node.className = tone || "";
  }
  function stage(run, label) { return (run?.stages || []).find((item) => item.label === label); }
  function hasStatus(run, label, status) { return stage(run, label)?.status === status; }
  function setStatus(mode, run) {
    const node = $(mode + "Status");
    node.className = "status neutral";
    if (!run) { node.textContent = "미실행"; return; }
    node.textContent = mode === "before" && run.status === "CONTAINED" && hasStatus(run, "제한된 모의 웹 세션 생성", "ALERT")
      ? "탐지 · 대응 완료" : statusNames[run.status] || run.status || "확인 중";
    const tone = {RUNNING:"running",ALERT:"alert",CONTAINED:"blocked",BLOCKED:"blocked",ERROR:"error"}[run.status];
    if (tone) node.className = "status " + tone;
  }
  function renderStages(mode, detail) {
    const list = $(mode + "Stages");
    list.replaceChildren();
    const allStages = detail?.run?.stages || [];
    const items = allStages.slice(-5);
    const events = detail?.upstreamError ? "이벤트 갱신 실패" : `보안 이벤트 ${Array.isArray(detail?.events) ? detail.events.length : 0}건`;
    setText(mode + "StageCount", items.length ? `최근 ${items.length}개 / 전체 ${allStages.length}개 단계 · ${events}` : "0개 확인");
    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = mode === "before"
        ? "공격 콘솔에서 Before를 실행하면 실제 단계가 표시됩니다."
        : "대응을 마친 뒤 After를 실행하면 차단 근거가 표시됩니다.";
      list.append(empty);
      return;
    }
    items.forEach((item) => {
      const row = document.createElement("li");
      const label = document.createElement("span");
      const result = document.createElement("b");
      label.textContent = item.label || "실행 단계";
      result.textContent = stageNames[item.status] || item.status || "확인 중";
      result.className = ({ALERT:"alert",BLOCKED:"blocked",ERROR:"error"})[item.status] || "";
      row.append(label, result);
      list.append(row);
    });
  }
  function renderBefore(detail) {
    const run = detail?.run;
    setStatus("before", run);
    setText("beforeId", shortId(run?.runId));
    setText("beforeTime", formatTime(run?.createdAt));
    renderStages("before", detail);
    if (!run) {
      ["beforeInput","beforeSession","beforeRecords","beforeReceiver"].forEach((id) => setResult(id, "미실행", "muted"));
      return;
    }
    const running = run.status === "RUNNING";
    const request = stage(run, "진단 요청 전송");
    const recordCount = stage(run, "합성 지원 자료 조회")?.detail?.recordCount;
    const receiver = stage(run, "내부 수신기로 전송")?.detail?.receiverStatus;
    setResult("beforeInput", request?.status === "SUCCESS" ? "요청됨" : running ? "진행 중" : "확인 불가", request?.status === "SUCCESS" ? "" : "pending");
    setResult("beforeSession", hasStatus(run, "제한된 모의 웹 세션 생성", "ALERT") ? "생성 확인" : running ? "진행 중" : "확인 불가", hasStatus(run, "제한된 모의 웹 세션 생성", "ALERT") ? "" : "pending");
    setResult("beforeRecords", Number.isFinite(recordCount) ? `${recordCount}건` : running ? "조회 대기" : "확인 불가", Number.isFinite(recordCount) ? "" : "pending");
    setResult("beforeReceiver", receiver === "RECEIVED" ? "수신 확인" : running ? "전송 대기" : "확인 불가", receiver === "RECEIVED" ? "" : "pending");
  }
  function renderAfter(detail) {
    const run = detail?.run;
    setStatus("after", run);
    setText("afterId", shortId(run?.runId));
    setText("afterTime", formatTime(run?.createdAt));
    renderStages("after", detail);
    if (!run) {
      ["afterInput","afterSession","afterRecords","afterReceiver"].forEach((id) => setResult(id, "미실행", "muted"));
      return;
    }
    const blocked = run.status === "BLOCKED" && hasStatus(run, "비정상 진단 입력 탐지·차단", "BLOCKED");
    const httpStatus = stage(run, "비정상 진단 입력 탐지·차단")?.detail?.httpStatus;
    if (blocked) {
      setResult("afterInput", httpStatus === 403 ? "403 차단" : "입력 차단");
      setResult("afterSession", "미생성");
      setResult("afterRecords", "미실행");
      setResult("afterReceiver", "미실행");
      return;
    }
    const pending = run.status === "RUNNING";
    setResult("afterInput", pending ? "검증 중" : "확인 불가", "pending");
    ["afterSession","afterRecords","afterReceiver"].forEach((id) => setResult(id, pending ? "검증 대기" : "확인 불가", "pending"));
  }
  function renderResponse(before, pendingId) {
    const run = before?.run;
    const badge = $("responseStatus");
    badge.className = "";
    if (!run) {
      badge.textContent = "대기";
      setText("responseText", "Before 실행이 완료되면 공격 콘솔에서 같은 실행의 대응을 진행합니다.");
    } else if (run.status === "CONTAINED" && hasStatus(run, "실행 세션 폐기 및 회원 보호 안내 등록", "BLOCKED")) {
      badge.textContent = "완료";
      badge.className = "complete";
      setText("responseText", "선택한 Before 실행의 모의 세션 폐기와 보호 안내 등록 결과가 확인됐습니다. After는 별도 허용 목록 구성에서 검증합니다.");
    } else if (pendingId === run.runId && run.status !== "RUNNING") {
      badge.textContent = "대응 필요";
      badge.className = "attention";
      setText("responseText", "공격 콘솔에서 이 Before 실행을 선택하고 대응을 완료해야 After를 시작할 수 있습니다.");
    } else if (run.status === "RUNNING") {
      badge.textContent = "Before 진행 중";
      setText("responseText", "공격 흐름이 끝나면 이 실행의 대응 상태가 갱신됩니다.");
    } else {
      badge.textContent = "확인 필요";
      badge.className = "attention";
      setText("responseText", "선택한 Before 실행의 대응 완료 기록을 확인하지 못했습니다. 공격 콘솔의 상세 이력을 확인하세요.");
    }
  }
  function pairFor(runs, beforeId) {
    const beforeIndex = runs.findIndex((run) => run.runId === beforeId && run.mode === "before");
    if (beforeIndex < 0) return {before:null, after:null};
    const after = runs.find(run => run.mode === "after" && run.beforeRunId === beforeId) || null;
    return {before:runs[beforeIndex], after};
  }
  function updateSelector(runs) {
    const beforeRuns = runs.filter((run) => run.mode === "before");
    if (!beforeRuns.some((run) => run.runId === selectedBeforeId)) selectedBeforeId = beforeRuns[0]?.runId || "";
    const select = $("beforeSelect");
    const previousIds = Array.from(select.options, (option) => option.value).join("|");
    const currentIds = beforeRuns.map((run) => run.runId).join("|");
    if (previousIds !== currentIds || (!beforeRuns.length && select.options[0]?.textContent !== "Before 기록 없음")) {
      select.replaceChildren();
      if (!beforeRuns.length) {
        const option = document.createElement("option"); option.value = ""; option.textContent = "Before 기록 없음"; select.append(option);
      } else beforeRuns.forEach((run) => {
        const option = document.createElement("option");
        option.value = run.runId;
        option.textContent = `${formatTime(run.createdAt)} · ${run.runId}`;
        select.append(option);
      });
    }
    select.value = selectedBeforeId;
    select.disabled = !beforeRuns.length;
  }
  async function getJson(path) {
    const response = await fetch(path, {cache:"no-store"});
    if (!response.ok) throw new Error(`데이터 요청 실패 (${response.status})`);
    return response.json();
  }
  async function refresh() {
    if (loading) { refreshQueued = true; return; }
    loading = true;
    try {
      const overview = await getJson("/api/overview");
      const runs = Array.isArray(overview.runs) ? overview.runs : [];
      updateSelector(runs);
      const {before, after} = pairFor(runs, selectedBeforeId);
      const [beforeDetail, afterDetail] = await Promise.all([
        before ? getJson("/api/runs/" + encodeURIComponent(before.runId)) : Promise.resolve(null),
        after ? getJson("/api/runs/" + encodeURIComponent(after.runId)) : Promise.resolve(null),
      ]);
      renderBefore(beforeDetail);
      renderAfter(afterDetail);
      renderResponse(beforeDetail, overview.pendingResponseRunId);
      const connected = Boolean(overview.targetConnected);
      $("connection").textContent = connected ? "지원 서비스 연결됨 · 자동 갱신" : "지원 서비스 연결 확인 필요";
      $("connection").className = "connection " + (connected ? "ok" : "offline");
      setText("updatedAt", "마지막 갱신 · " + formatTime(new Date().toISOString()));
      setText("toolbarHint", !before ? "공격 콘솔에서 Before를 실행하면 비교가 시작됩니다." : !after ? "Before를 확인한 뒤 대응을 마치고 After를 실행하세요." : afterDetail?.run?.status === "BLOCKED" ? "Before 관측 결과와 After 선행 차단을 같은 실행 흐름으로 비교 중입니다." : "After 실행 결과를 확인 중입니다.");
      $("errorMessage").hidden = true;
      if (beforeDetail?.upstreamError || afterDetail?.upstreamError) {
        $("errorMessage").textContent = "일부 보안 이벤트를 갱신하지 못했습니다. 화면에는 확인된 실행 단계만 표시합니다.";
        $("errorMessage").hidden = false;
      }
    } catch (error) {
      $("connection").textContent = "연결 끊김 · 이전 결과 표시 중";
      $("connection").className = "connection offline";
      $("errorMessage").textContent = `결과를 갱신하지 못했습니다: ${error.message}`;
      $("errorMessage").hidden = false;
    } finally {
      loading = false;
      if (refreshQueued) { refreshQueued = false; refresh(); }
    }
  }

  $("beforeSelect").addEventListener("change", (event) => { selectedBeforeId = event.target.value; refresh(); });
  $("refreshButton").addEventListener("click", refresh);
  setInterval(() => { if (!document.hidden) refresh(); }, 2500);
  refresh();
})();
