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
    private final HttpClient http = HttpClient.newHttpClient();

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
    public ResponseEntity<?> diagnose(@RequestHeader(value = "Authorization", required = false) String auth,
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
            if (request.option() != null && request.option().contains("LAB_SHELL")) {
                return error(HttpStatus.BAD_REQUEST, "RUN_REQUIRED", "실습 공격은 제어기에서 만든 실행 ID가 필요합니다.");
            }
            return ResponseEntity.ok(Map.of("result", "SUCCESS", "targetId", target.get("target_id"), "latencyMs", 24, "simulation", true, "message", "합성 진단 대상의 연결 상태가 정상입니다."));
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
        if (request.option() == null || !request.option().contains("LAB_SHELL")) {
            event(request.runId(), corr, "diagnostic_completed", "PASS", Map.of("mode", run.get("mode")));
            return ResponseEntity.ok(Map.of("result", "SUCCESS", "targetId", target.get("target_id"), "latencyMs", 24, "simulation", true));
        }
        if (!"before".equals(run.get("mode"))) {
            event(request.runId(), corr, "diagnostic_injection_blocked", "BLOCKED", Map.of("control", "allow-list"));
            jdbc.update("UPDATE lab_runs SET alert_status='BLOCKED' WHERE run_id=?", request.runId());
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
    public ResponseEntity<?> createRun(@RequestHeader(value = "X-Lab-Control-Token", required = false) String token,
                                       @RequestBody RunRequest request) {
        requireControl(token);
        if (!List.of("before", "after").contains(request.mode())) return error(HttpStatus.BAD_REQUEST, "INVALID_MODE", "mode는 before 또는 after여야 합니다.");
        if (!List.of("HC-MEMBER-001", "HC-MEMBER-002").contains(request.memberNo())) return error(HttpStatus.BAD_REQUEST, "INVALID_MEMBER", "합성 회원만 대상이 될 수 있습니다.");
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

    @PostMapping("/control/v1/runs/{runId}/respond")
    public ResponseEntity<?> respond(@RequestHeader(value = "X-Lab-Control-Token", required = false) String token, @PathVariable String runId) {
        requireControl(token);
        int changed = jdbc.update("UPDATE lab_runs SET status='CONTAINED', alert_status='BLOCKED', responded_at=? WHERE run_id=? AND status<>'CONTAINED'", Timestamp.from(Instant.now()), runId);
        jdbc.update("UPDATE lab_shell_sessions SET active=0, revoked_at=? WHERE run_id=? AND active=1", Timestamp.from(Instant.now()), runId);
        Map<String, Object> run;
        try { run = jdbc.queryForMap("SELECT run_id, member_no FROM lab_runs WHERE run_id=?", runId); }
        catch (EmptyResultDataAccessException ex) { return error(HttpStatus.NOT_FOUND, "RUN_NOT_FOUND", "실행 ID를 찾을 수 없습니다."); }
        jdbc.update("INSERT IGNORE INTO lab_protection_notices(member_no,run_id,notice_type,message,created_at) VALUES(?,?,?,?,?)", run.get("member_no"), runId, "ADDITIONAL_VERIFICATION", "합성 결제 지원 자료에 대한 보호 검토가 완료될 때까지 추가 확인이 필요합니다.", Timestamp.from(Instant.now()));
        event(runId, runId + "-CORR", "incident_response_contained", "BLOCKED", Map.of("changed", changed));
        return ResponseEntity.ok(Map.of("runId", runId, "result", "BLOCKED", "protectionNoticeCreated", true, "simulation", true));
    }

    @GetMapping("/lab-shell/v1/sessions/{sessionId}")
    public ResponseEntity<?> shell(@PathVariable String sessionId) {
        try { return ResponseEntity.ok(jdbc.queryForMap("SELECT session_id AS sessionId, run_id AS runId, merchant_no AS merchantNo, active, created_at AS createdAt, revoked_at AS revokedAt FROM lab_shell_sessions WHERE session_id=?", sessionId)); }
        catch (EmptyResultDataAccessException ex) { return error(HttpStatus.NOT_FOUND, "SHELL_SESSION_NOT_FOUND", "모의 세션을 찾을 수 없습니다."); }
    }

    @GetMapping("/lab-shell/v1/sessions/{sessionId}/records")
    public ResponseEntity<?> records(@PathVariable String sessionId) {
        Map<String, Object> shell = activeShell(sessionId);
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT support_ref AS supportRef, member_no AS memberNo, card_last4 AS cardLast4, transaction_ref AS transactionRef, amount, occurred_at AS occurredAt FROM lab_sensitive_records WHERE member_no=(SELECT member_no FROM lab_runs WHERE run_id=?) ORDER BY record_id", shell.get("run_id"));
        event((String) shell.get("run_id"), shell.get("run_id") + "-CORR", "synthetic_records_accessed", "ALERT", Map.of("recordCount", rows.size()));
        return ResponseEntity.ok(Map.of("runId", shell.get("run_id"), "recordCount", rows.size(), "records", rows, "simulation", true));
    }

    @PostMapping("/lab-shell/v1/sessions/{sessionId}/exfiltrate")
    public ResponseEntity<?> exfiltrate(@PathVariable String sessionId, @RequestBody TransferRequest request) throws Exception {
        Map<String, Object> shell = activeShell(sessionId);
        String runId = (String) shell.get("run_id");
        String transfer = request.transferId() == null || request.transferId().isBlank() ? "TRANSFER-" + UUID.randomUUID() : request.transferId();
        try { return ResponseEntity.ok(jdbc.queryForMap("SELECT transfer_id AS transferId, record_count AS recordCount, receiver_status AS receiverStatus, payload_sha256 AS payloadSha256 FROM lab_exfil_records WHERE transfer_id=?", transfer)); }
        catch (EmptyResultDataAccessException ignored) { }
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT support_ref AS supportRef, member_no AS memberNo, card_last4 AS cardLast4, transaction_ref AS transactionRef, amount, occurred_at AS occurredAt FROM lab_sensitive_records WHERE member_no=(SELECT member_no FROM lab_runs WHERE run_id=?) ORDER BY record_id", runId);
        String json = mapper.writeValueAsString(Map.of("transferId", transfer, "runId", runId, "records", rows, "simulation", true));
        String sha = hashToken(json);
        HttpRequest httpRequest = HttpRequest.newBuilder(URI.create(receiverUrl)).header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(json)).build();
        HttpResponse<String> response = http.send(httpRequest, HttpResponse.BodyHandlers.ofString());
        String status = response.statusCode() >= 200 && response.statusCode() < 300 ? "RECEIVED" : "REJECTED";
        jdbc.update("INSERT INTO lab_exfil_records(transfer_id,run_id,record_count,payload_sha256,receiver_status,received_at) VALUES(?,?,?,?,?,?)", transfer, runId, rows.size(), sha, status, Timestamp.from(Instant.now()));
        event(runId, runId + "-CORR", "synthetic_records_exfiltration_attempted", "RECEIVED".equals(status) ? "ALERT" : "BLOCKED", Map.of("transferId", transfer, "recordCount", rows.size()));
        return ResponseEntity.status("RECEIVED".equals(status) ? HttpStatus.OK : HttpStatus.BAD_GATEWAY).body(Map.of("transferId", transfer, "runId", runId, "recordCount", rows.size(), "payloadSha256", sha, "receiverStatus", status, "simulation", true));
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
