package com.bookwave.lab.support;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/** 가상 부트캠프 실습용 가맹점 진단·모의 웹쉘 API. 임의 OS 명령은 실행하지 않는다. */
@RestController
public class LabSupportController {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final String controlToken;
    private final String receiverUrl;
    private final SecureRandom random = new SecureRandom();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();

    public LabSupportController(JdbcTemplate jdbc, ObjectMapper mapper,
                                @Value("${lab.control-token}") String controlToken,
                                @Value("${lab.receiver-url}") String receiverUrl) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.controlToken = controlToken;
        this.receiverUrl = receiverUrl;
    }

    @PostMapping("/merchant/v1/sessions")
    public ResponseEntity<?> merchantLogin(@RequestBody LoginRequest request) {
        if (request.loginId() == null || request.password() == null) return error(HttpStatus.BAD_REQUEST, "INVALID_LOGIN", "아이디와 비밀번호를 입력해 주세요.");
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT merchant_no, password_salt, password_hash FROM lab_merchant_accounts "
                        + "WHERE login_id=? AND status='ACTIVE'", request.loginId());
        if (rows.isEmpty() || !hash(request.password(), (String) rows.get(0).get("password_salt"))
                .equals(rows.get(0).get("password_hash"))) {
            return error(HttpStatus.UNAUTHORIZED, "INVALID_MERCHANT_CREDENTIALS", "가맹점 인증에 실패했습니다.");
        }
        String token = token();
        String merchantNo = (String) rows.get(0).get("merchant_no");
        Instant expires = Instant.now().plusSeconds(1800);
        jdbc.update("INSERT INTO lab_merchant_sessions(token_hash,merchant_no,expires_at) VALUES(?,?,?)",
                hashToken(token), merchantNo, Timestamp.from(expires));
        return ResponseEntity.ok(Map.of("sessionToken", token, "merchantNo", merchantNo, "expiresAt", expires));
    }

    @DeleteMapping("/merchant/v1/sessions")
    public ResponseEntity<Void> merchantLogout(@RequestHeader(value = "Authorization", required = false) String auth) {
        if (auth != null && auth.startsWith("Bearer ")) {
            jdbc.update("DELETE FROM lab_merchant_sessions WHERE token_hash=?", hashToken(auth.substring(7).trim()));
        }
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/merchant/v1/diagnostic-targets")
    public ResponseEntity<?> targets(@RequestHeader(value = "Authorization", required = false) String auth) {
        String merchant = merchant(auth);
        if (merchant == null) return error(HttpStatus.UNAUTHORIZED, "MERCHANT_SESSION_REQUIRED", "가맹점 로그인이 필요합니다.");
        return ResponseEntity.ok(jdbc.queryForList("SELECT target_id AS targetId, display_name AS displayName, endpoint_key AS endpointKey FROM lab_diagnostic_targets WHERE merchant_no=? AND status='ACTIVE'", merchant));
    }

    @PostMapping("/merchant/v1/diagnostics/connectivity")
    public synchronized ResponseEntity<?> diagnose(@RequestHeader(value = "Authorization", required = false) String auth,
                                      @RequestBody DiagnosticRequest request) {
        String merchant = merchant(auth);
        if (merchant == null) return error(HttpStatus.UNAUTHORIZED, "MERCHANT_SESSION_REQUIRED", "가맹점 로그인이 필요합니다.");
        Map<String, Object> target;
        try {
            target = jdbc.queryForMap("SELECT target_id, endpoint_key FROM lab_diagnostic_targets WHERE target_id=? AND merchant_no=? AND status='ACTIVE'", request.targetId(), merchant);
        } catch (EmptyResultDataAccessException ex) {
            return error(HttpStatus.NOT_FOUND, "DIAGNOSTIC_TARGET_NOT_FOUND", "등록된 진단 대상이 아닙니다.");
        }
        if (request.runId() == null || request.runId().isBlank()) {
            if (!normalOption(request.option())) {
                return error(HttpStatus.BAD_REQUEST, "DIAGNOSTIC_INPUT_BLOCKED", "허용되지 않은 점검 항목입니다.");
            }
            return connectivity(target, null);
        }
        Map<String, Object> run;
        try {
            run = jdbc.queryForMap("SELECT run_id, mode, merchant_no, member_no, status FROM lab_runs WHERE run_id=? AND merchant_no=?", request.runId(), merchant);
        } catch (EmptyResultDataAccessException ex) {
            return error(HttpStatus.NOT_FOUND, "RUN_NOT_FOUND", "실행 ID를 찾을 수 없습니다.");
        }
        if ("CONTAINED".equals(run.get("status"))) return error(HttpStatus.FORBIDDEN, "RUN_CONTAINED", "대응으로 차단된 실행입니다.");
        jdbc.update("UPDATE lab_runs SET status='ACTIVE' WHERE run_id=?", request.runId());
        String corr = request.runId() + "-CORR";
        event(request.runId(), corr, "diagnostic_request_received", "OBSERVED", Map.of("targetId", request.targetId()));
        if (normalOption(request.option())) {
            return connectivity(target, request.runId());
        }
        if (!"before".equals(run.get("mode")) || !"status;LAB_SHELL".equals(request.option())) {
            event(request.runId(), corr, "diagnostic_injection_blocked", "BLOCKED", Map.of("control", "allow-list"));
            jdbc.update("UPDATE lab_runs SET status='CLOSED', alert_status='BLOCKED' WHERE run_id=?", request.runId());
            return error(HttpStatus.FORBIDDEN, "DIAGNOSTIC_INPUT_BLOCKED", "허용 목록에 없는 진단 옵션이 차단되었습니다.");
        }
        String session = token();
        jdbc.update("INSERT INTO lab_shell_sessions(session_id,run_id,merchant_no,active,created_at) VALUES(?,?,?,?,?)", session, request.runId(), merchant, true, Timestamp.from(Instant.now()));
        event(request.runId(), corr, "simulated_command_injection_observed", "ALERT", Map.of("action", "lab_shell_session_created"));
        event(request.runId(), corr, "lab_shell_session_created", "ALERT", Map.of("sessionId", "redacted"));
        jdbc.update("UPDATE lab_runs SET alert_status='ALERT' WHERE run_id=?", request.runId());
        return ResponseEntity.ok(Map.of("result", "ALERT", "runId", request.runId(), "correlationId", corr, "shellSessionToken", session, "simulation", true, "warning", "제한된 가상 세션이 생성되었습니다."));
    }

    @PostMapping("/control/v1/runs")
    public synchronized ResponseEntity<?> createRun(@RequestHeader(value = "X-Lab-Control-Token", required = false) String token,
                                       @RequestBody RunRequest request) {
        requireControl(token);
        if (!("before".equals(request.mode()) || "after".equals(request.mode()))) return error(HttpStatus.BAD_REQUEST, "INVALID_MODE", "mode는 before 또는 after여야 합니다.");
        if (!("HC-MEMBER-001".equals(request.memberNo()) || "HC-MEMBER-002".equals(request.memberNo()))) return error(HttpStatus.BAD_REQUEST, "INVALID_MEMBER", "합성 회원만 대상이 될 수 있습니다.");
        if (!"HAEON-MART".equals(request.merchantNo())) return error(HttpStatus.BAD_REQUEST, "INVALID_MERCHANT", "등록된 가맹점만 실행할 수 있습니다.");
        Integer active = jdbc.queryForObject("SELECT COUNT(*) FROM lab_runs WHERE status IN ('CREATED','ACTIVE')", Integer.class);
        if (active != null && active > 0) return error(HttpStatus.CONFLICT, "ACTIVE_RUN_EXISTS", "진행 중인 실행의 대응 또는 종료를 먼저 완료하세요.");
        String run = "HAEON-DIAG-" + Instant.now().toString().replaceAll("[^0-9]", "").substring(0, 14) + "-" + random.nextInt(1000, 9999);
        jdbc.update("INSERT INTO lab_runs(run_id,mode,merchant_no,member_no,status,alert_status,created_at) VALUES(?,?,?,?,?,?,?)", run, request.mode(), request.merchantNo(), request.memberNo(), "CREATED", "NONE", Timestamp.from(Instant.now()));
        event(run, run + "-CORR", "run_created", "RECORDED", Map.of("mode", request.mode()));
        return ResponseEntity.ok(Map.of("runId", run, "mode", request.mode(), "merchantNo", request.merchantNo(), "memberNo", request.memberNo(), "simulation", true));
    }

    @GetMapping("/control/v1/runs/{runId}")
    public ResponseEntity<?> run(@RequestHeader(value = "X-Lab-Control-Token", required = false) String token, @PathVariable String runId) {
        requireControl(token);
        try {
            return ResponseEntity.ok(jdbc.queryForMap("SELECT run_id AS runId, mode, merchant_no AS merchantNo, member_no AS memberNo, status, alert_status AS alertStatus, created_at AS createdAt, responded_at AS respondedAt FROM lab_runs WHERE run_id=?", runId));
        } catch (EmptyResultDataAccessException ex) { return error(HttpStatus.NOT_FOUND, "RUN_NOT_FOUND", "실행 ID를 찾을 수 없습니다."); }
    }

    @GetMapping("/control/v1/runs/{runId}/events")
    public ResponseEntity<?> events(@RequestHeader(value = "X-Lab-Control-Token", required = false) String token, @PathVariable String runId) {
        requireControl(token);
        return ResponseEntity.ok(jdbc.queryForList("SELECT event_id AS eventId, correlation_id AS correlationId, event_type AS eventType, result, detail_json AS detail, occurred_at AS occurredAt FROM lab_events WHERE run_id=? ORDER BY event_id", runId));
    }

    @PostMapping("/control/v1/reset")
    public synchronized ResponseEntity<?> reset(@RequestHeader(value = "X-Lab-Control-Token", required = false) String token) {
        requireControl(token);
        int transfers = jdbc.update("DELETE FROM lab_exfil_records");
        int events = jdbc.update("DELETE FROM lab_events");
        int sessions = jdbc.update("DELETE FROM lab_shell_sessions");
        int notices = jdbc.update("DELETE FROM lab_protection_notices");
        int runs = jdbc.update("DELETE FROM lab_runs");
        jdbc.update("DELETE FROM lab_merchant_sessions");
        return ResponseEntity.ok(Map.of("result", "RESET", "runsDeleted", runs, "eventsDeleted", events,
                "sessionsDeleted", sessions, "transfersDeleted", transfers, "protectionNoticesDeleted", notices));
    }

    @PostMapping("/control/v1/runs/{runId}/respond")
    public synchronized ResponseEntity<?> respond(@RequestHeader(value = "X-Lab-Control-Token", required = false) String token, @PathVariable String runId) {
        requireControl(token);
        Map<String, Object> run;
        try { run = jdbc.queryForMap("SELECT run_id, member_no, status FROM lab_runs WHERE run_id=?", runId); }
        catch (EmptyResultDataAccessException ex) { return error(HttpStatus.NOT_FOUND, "RUN_NOT_FOUND", "실행 ID를 찾을 수 없습니다."); }
        // These operations share the controller monitor with diagnosis/read/transfer. A response
        // waits for an in-flight bounded HTTP transfer before revoking every session (one replica).
        int changed = jdbc.update("UPDATE lab_runs SET status='CONTAINED', alert_status='BLOCKED', responded_at=? WHERE run_id=? AND status<>'CONTAINED'", Timestamp.from(Instant.now()), runId);
        int revoked = jdbc.update("UPDATE lab_shell_sessions SET active=0, revoked_at=? WHERE run_id=? AND active=1", Timestamp.from(Instant.now()), runId);
        boolean accessed = jdbc.queryForObject("SELECT COUNT(*) FROM lab_events WHERE run_id=? AND event_type='synthetic_records_accessed' AND JSON_EXTRACT(detail_json,'$.recordCount')>0", Integer.class, runId) > 0;
        boolean received = jdbc.queryForObject("SELECT COUNT(*) FROM lab_exfil_records WHERE run_id=? AND receiver_status='RECEIVED' AND record_count>0", Integer.class, runId) > 0;
        if (accessed || received) jdbc.update("INSERT IGNORE INTO lab_protection_notices(member_no,run_id,notice_type,message,created_at) VALUES(?,?,?,?,?)", run.get("member_no"), runId, "ADDITIONAL_VERIFICATION", "결제 지원 자료의 비정상 접근이 확인되어 추가 확인이 필요합니다. 안내 확인 후에도 보호 검토는 계속됩니다. 카드 이용과 로그인은 정상적으로 가능합니다.", Timestamp.from(Instant.now()));
        if (changed > 0) event(runId, runId + "-CORR", "incident_response_contained", "BLOCKED", Map.of("revokedSessions", revoked, "recordsAccessed", accessed, "exfiltrationConfirmed", received));
        return ResponseEntity.ok(Map.of("runId", runId, "result", "BLOCKED", "protectionNoticeCreated", accessed || received, "exfiltrationConfirmed", received, "simulation", true));
    }

    @GetMapping("/lab-shell/v1/sessions/{sessionId}")
    public synchronized ResponseEntity<?> shell(@PathVariable String sessionId) {
        activeShell(sessionId);
        try { return ResponseEntity.ok(jdbc.queryForMap("SELECT session_id AS sessionId, run_id AS runId, merchant_no AS merchantNo, active, created_at AS createdAt, revoked_at AS revokedAt FROM lab_shell_sessions WHERE session_id=?", sessionId)); }
        catch (EmptyResultDataAccessException ex) { return error(HttpStatus.NOT_FOUND, "SHELL_SESSION_NOT_FOUND", "모의 세션을 찾을 수 없습니다."); }
    }

    @GetMapping("/lab-shell/v1/sessions/{sessionId}/records")
    public synchronized ResponseEntity<?> records(@PathVariable String sessionId) {
        Map<String, Object> shell = activeShell(sessionId);
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT support_ref AS supportRef, member_no AS memberNo, card_last4 AS cardLast4, transaction_ref AS transactionRef, amount, occurred_at AS occurredAt FROM lab_sensitive_records WHERE member_no=(SELECT member_no FROM lab_runs WHERE run_id=?) ORDER BY record_id", shell.get("run_id"));
        event((String) shell.get("run_id"), shell.get("run_id") + "-CORR", "synthetic_records_accessed", "ALERT", Map.of("recordCount", rows.size(), "memberNo", rows.isEmpty() ? "NONE" : rows.get(0).get("memberNo")));
        return ResponseEntity.ok(Map.of("runId", shell.get("run_id"), "recordCount", rows.size(), "records", rows, "simulation", true));
    }

    @PostMapping("/lab-shell/v1/sessions/{sessionId}/exfiltrate")
    public synchronized ResponseEntity<?> exfiltrate(@PathVariable String sessionId, @RequestBody TransferRequest request) throws Exception {
        Map<String, Object> shell = activeShell(sessionId);
        String runId = (String) shell.get("run_id");
        String transfer = request.transferId() == null || request.transferId().isBlank() ? "TRANSFER-" + UUID.randomUUID() : request.transferId();
        if (!transfer.matches("[A-Za-z0-9-]{1,80}")) return error(HttpStatus.BAD_REQUEST, "INVALID_TRANSFER_ID", "전송 ID 형식이 올바르지 않습니다.");
        List<Map<String, Object>> existing = jdbc.queryForList("SELECT run_id AS runId, transfer_id AS transferId, record_count AS recordCount, receiver_status AS receiverStatus, payload_sha256 AS payloadSha256 FROM lab_exfil_records WHERE transfer_id=?", transfer);
        if (!existing.isEmpty()) {
            if (!runId.equals(existing.get(0).get("runId"))) return error(HttpStatus.CONFLICT, "TRANSFER_ID_CONFLICT", "다른 실행에 사용된 전송 ID입니다.");
            if ("RECEIVED".equals(existing.get(0).get("receiverStatus"))) return ResponseEntity.ok(existing.get(0));
        }
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT support_ref AS supportRef, member_no AS memberNo, card_last4 AS cardLast4, transaction_ref AS transactionRef, amount, occurred_at AS occurredAt FROM lab_sensitive_records WHERE member_no=(SELECT member_no FROM lab_runs WHERE run_id=?) ORDER BY record_id", runId);
        event(runId, runId + "-CORR", "synthetic_records_accessed", "ALERT", Map.of("recordCount", rows.size(), "source", "transfer", "memberNo", rows.isEmpty() ? "NONE" : rows.get(0).get("memberNo")));
        String json = mapper.writeValueAsString(Map.of("transferId", transfer, "runId", runId, "records", rows, "simulation", true));
        String sha = hashToken(json);
        String status = "FAILED";
        try {
            HttpRequest httpRequest = HttpRequest.newBuilder(URI.create(receiverUrl)).timeout(Duration.ofSeconds(3)).header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(json)).build();
            HttpResponse<String> response = http.send(httpRequest, HttpResponse.BodyHandlers.ofString());
            var receipt = mapper.readTree(response.body());
            boolean verified = response.statusCode() == 200 && "RECEIVED".equals(receipt.path("status").asText())
                    && transfer.equals(receipt.path("transferId").asText()) && runId.equals(receipt.path("runId").asText())
                    && sha.equals(receipt.path("sha256").asText()) && rows.size() == receipt.path("recordCount").asInt(-1);
            status = verified ? "RECEIVED" : "REJECTED";
        } catch (InterruptedException ex) { Thread.currentThread().interrupt(); }
        catch (Exception ex) { /* Record the failed attempt and allow an idempotent retry. */ }
        jdbc.update("INSERT INTO lab_exfil_records(transfer_id,run_id,record_count,payload_sha256,receiver_status,received_at) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE receiver_status=VALUES(receiver_status), received_at=VALUES(received_at)", transfer, runId, rows.size(), sha, status, "RECEIVED".equals(status) ? Timestamp.from(Instant.now()) : null);
        event(runId, runId + "-CORR", "synthetic_records_exfiltration_attempted", "RECEIVED".equals(status) ? "ALERT" : "ERROR", Map.of("transferId", transfer, "recordCount", rows.size(), "receiverStatus", status, "payloadSha256", sha));
        return ResponseEntity.status("RECEIVED".equals(status) ? HttpStatus.OK : HttpStatus.BAD_GATEWAY).body(Map.of("transferId", transfer, "runId", runId, "recordCount", rows.size(), "payloadSha256", sha, "receiverStatus", status, "simulation", true));
    }

    private boolean normalOption(String option) { return option == null || "status".equals(option); }

    private ResponseEntity<?> connectivity(Map<String, Object> target, String runId) {
        long start = System.nanoTime();
        boolean success = false;
        try {
            // Only the configured internal receiver is reachable; user input is never a URL.
            URI endpoint = URI.create(receiverUrl).resolve("/health");
            var response = http.send(HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(3)).GET().build(), HttpResponse.BodyHandlers.ofString());
            success = response.statusCode() == 200 && "UP".equals(mapper.readTree(response.body()).path("status").asText());
        } catch (InterruptedException ex) { Thread.currentThread().interrupt(); }
        catch (Exception ex) { /* Connectivity failure is an observed result, never a success. */ }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        if (runId != null) event(runId, runId + "-CORR", "diagnostic_completed", success ? "PASS" : "ERROR", Map.of("latencyMs", elapsed));
        return ResponseEntity.status(success ? HttpStatus.OK : HttpStatus.BAD_GATEWAY).body(Map.of("result", success ? "SUCCESS" : "FAILED", "targetId", target.get("target_id"), "latencyMs", elapsed, "message", success ? "등록된 대상에 연결했습니다." : "진단 대상에 연결하지 못했습니다. 잠시 후 다시 점검해 주세요."));
    }

    private Map<String, Object> activeShell(String sessionId) {
        try {
            Map<String, Object> row = jdbc.queryForMap("SELECT session_id, run_id, active FROM lab_shell_sessions WHERE session_id=?", sessionId);
            Object active = row.get("active");
            if (!(Boolean.TRUE.equals(active) || Integer.valueOf(1).equals(active))) throw new LabException(HttpStatus.FORBIDDEN, "SHELL_SESSION_REVOKED", "폐기된 모의 세션입니다.");
            Map<String, Object> run = jdbc.queryForMap("SELECT status FROM lab_runs WHERE run_id=?", row.get("run_id"));
            if ("CONTAINED".equals(run.get("status"))) throw new LabException(HttpStatus.FORBIDDEN, "RUN_CONTAINED", "대응으로 차단된 실행입니다.");
            return row;
        } catch (EmptyResultDataAccessException ex) { throw new LabException(HttpStatus.NOT_FOUND, "SHELL_SESSION_NOT_FOUND", "모의 세션을 찾을 수 없습니다."); }
    }

    private String merchant(String auth) {
        if (auth == null || !auth.startsWith("Bearer ")) return null;
        try { return jdbc.queryForObject("SELECT merchant_no FROM lab_merchant_sessions WHERE token_hash=? AND expires_at>?", String.class, hashToken(auth.substring(7).trim()), Timestamp.from(Instant.now())); }
        catch (Exception ex) { return null; }
    }

    private void requireControl(String token) { if (token == null || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), controlToken.getBytes(StandardCharsets.UTF_8))) throw new LabException(HttpStatus.FORBIDDEN, "CONTROL_TOKEN_REQUIRED", "실습 제어 토큰이 필요합니다."); }
    private void event(String run, String corr, String type, String result, Map<String, ?> detail) {
        try { jdbc.update("INSERT INTO lab_events(run_id,correlation_id,event_type,result,detail_json,occurred_at) VALUES(?,?,?,?,?,?)", run, corr, type, result, mapper.writeValueAsString(detail), Timestamp.from(Instant.now())); }
        catch (Exception ex) { throw new LabException(HttpStatus.INTERNAL_SERVER_ERROR, "EVENT_WRITE_FAILED", "실습 이벤트를 기록하지 못했습니다."); }
    }
    private String token() { byte[] b = new byte[24]; random.nextBytes(b); return Base64.getUrlEncoder().withoutPadding().encodeToString(b); }
    private String hash(String password, String salt) { return hashToken(salt + password); }
    private String hashToken(String value) { try { return String.format("%064x", new BigInteger(1, MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)))); } catch (Exception ex) { throw new IllegalStateException(ex); } }
    private ResponseEntity<Map<String, String>> error(HttpStatus status, String code, String message) { return ResponseEntity.status(status).body(Map.of("errorCode", code, "message", message, "simulation", "true")); }

    public record LoginRequest(String loginId, String password) { }
    public record DiagnosticRequest(String targetId, String option, String runId) { }
    public record RunRequest(String mode, String merchantNo, String memberNo) { }
    public record TransferRequest(String transferId) { }
    static final class LabException extends RuntimeException { final HttpStatus status; final String code; LabException(HttpStatus s, String c, String m) { super(m); status=s; code=c; } }
}
