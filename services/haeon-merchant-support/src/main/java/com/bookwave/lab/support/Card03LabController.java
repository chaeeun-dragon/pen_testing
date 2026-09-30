package com.bookwave.lab.support;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/** Fixed synthetic experiment, not the production approval or Mock PG route.
 * Both workers use real, separate MySQL transactions. The Before barrier deliberately
 * reproduces the stale-read interleaving; After uses InnoDB SELECT ... FOR UPDATE.
 */
@RestController
public class Card03LabController {
    private final JdbcTemplate jdbc;
    private final PlatformTransactionManager manager;
    private final String control;

    public Card03LabController(JdbcTemplate jdbc, PlatformTransactionManager manager,
                              @Value("${lab.control-token}") String control) {
        this.jdbc = jdbc;
        this.manager = manager;
        this.control = control;
    }

    @PostMapping("/control/v1/card03/compare")
    public synchronized Map<String, Object> compare(
            @RequestHeader(value="X-Lab-Control-Token", required=false) String token) throws Exception {
        if (token == null || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), control.getBytes(StandardCharsets.UTF_8)))
            throw new LabSupportController.LabException(HttpStatus.FORBIDDEN, "CONTROL_TOKEN_REQUIRED", "실습 제어 토큰이 필요합니다.");
        String id = "CARD03-" + UUID.randomUUID().toString().substring(0, 18);
        Map<String, Object> before = concurrent(id + "-B", false);
        Map<String, Object> after = concurrent(id + "-A", true);
        String normal = id + "-N";
        jdbc.update("INSERT INTO lab_card03_limits(run_id,limit_amount,used_amount) VALUES(?,100000,0)", normal);
        var approved = approve(normal, "NORMAL-1", 20000, true, null);
        var retry = approve(normal, "NORMAL-1", 20000, true, null);
        var conflict = approve(normal, "NORMAL-1", 30000, true, null);
        var declined = approve(normal, "NORMAL-2", 90000, true, null);
        long normalUsed = used(normal);
        boolean regression = "APPROVED".equals(approved.get("result"))
                && Boolean.TRUE.equals(retry.get("idempotentReplay"))
                && "KEY_CONFLICT".equals(conflict.get("result"))
                && "DECLINED".equals(declined.get("result")) && normalUsed == 20000;
        boolean pass = ((Number)before.get("approvedCount")).intValue() == 2
                && ((Number)before.get("usedAmount")).longValue() == 120000
                && ((Number)after.get("approvedCount")).intValue() == 1
                && ((Number)after.get("usedAmount")).longValue() == 60000 && regression;
        return Map.of("comparisonId", id, "createdAt", Instant.now().toString(),
                "scope", "ISOLATED_MYSQL_LAB_NOT_CORE_OR_PG", "simulation", true,
                "before", before, "after", after, "verified", pass,
                "regression", Map.of("normalApproval", approved.get("result"), "retry", retry,
                        "keyConflict", conflict.get("result"), "overLimit", declined.get("result"),
                        "usedAmount", normalUsed, "passed", regression));
    }

    private Map<String, Object> concurrent(String run, boolean locked) throws Exception {
        jdbc.update("INSERT INTO lab_card03_limits(run_id,limit_amount,used_amount) VALUES(?,100000,0)", run);
        CyclicBarrier simultaneousStart = new CyclicBarrier(2);
        CyclicBarrier sameOldRead = locked ? null : new CyclicBarrier(2);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first = pool.submit(() -> { simultaneousStart.await(5, TimeUnit.SECONDS); return approve(run, "TX-1", 60000, locked, sameOldRead); });
            var second = pool.submit(() -> { simultaneousStart.await(5, TimeUnit.SECONDS); return approve(run, "TX-2", 60000, locked, sameOldRead); });
            var attempts = List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));
            var ledger = jdbc.queryForList("SELECT request_id AS requestId,amount,observed_used AS observedUsed,result,created_at AS createdAt FROM lab_card03_approvals WHERE run_id=? ORDER BY request_id", run);
            long approvedCount = ledger.stream().filter(row -> "APPROVED".equals(row.get("result"))).count();
            long sum = ledger.stream().filter(row -> "APPROVED".equals(row.get("result"))).mapToLong(row -> ((Number)row.get("amount")).longValue()).sum();
            return Map.of("runId", run, "limitAmount", 100000, "requestAmount", 60000,
                    "usedAmount", used(run), "approvedAmount", sum, "approvedCount", approvedCount,
                    "lock", locked ? "SELECT_FOR_UPDATE" : "STALE_READ_BARRIER", "attempts", attempts, "ledger", ledger);
        }
    }

    private Map<String, Object> approve(String run, String request, long amount, boolean locked, CyclicBarrier barrier) {
        TransactionTemplate tx = new TransactionTemplate(manager);
        tx.setTimeout(8);
        return tx.execute(status -> {
            var balance = jdbc.queryForMap("SELECT limit_amount,used_amount FROM lab_card03_limits WHERE run_id=?" + (locked ? " FOR UPDATE" : ""), run);
            long old = ((Number)balance.get("used_amount")).longValue();
            long limit = ((Number)balance.get("limit_amount")).longValue();
            var existing = jdbc.queryForList("SELECT amount,result FROM lab_card03_approvals WHERE run_id=? AND request_id=?", run, request);
            if (!existing.isEmpty()) {
                boolean same = ((Number)existing.get(0).get("amount")).longValue() == amount;
                return Map.of("requestId", request, "result", same ? existing.get(0).get("result") : "KEY_CONFLICT", "idempotentReplay", same);
            }
            String readAt = Instant.now().toString();
            if (barrier != null) {
                try { barrier.await(5, TimeUnit.SECONDS); }
                catch (InterruptedException ex) { Thread.currentThread().interrupt(); throw new IllegalStateException("CARD03_INTERRUPTED", ex); }
                catch (Exception ex) { throw new IllegalStateException("CARD03_BARRIER_FAILED", ex); }
            }
            boolean accepted = old + amount <= limit;
            if (accepted) jdbc.update("UPDATE lab_card03_limits SET used_amount=used_amount+? WHERE run_id=?", amount, run);
            String result = accepted ? "APPROVED" : "DECLINED";
            jdbc.update("INSERT INTO lab_card03_approvals(run_id,request_id,amount,observed_used,result) VALUES(?,?,?,?,?)", run, request, amount, old, result);
            return Map.of("requestId", request, "amount", amount, "observedUsed", old, "observedRemaining", limit-old,
                    "readAt", readAt, "decidedAt", Instant.now().toString(), "result", result);
        });
    }

    private long used(String run) {
        return jdbc.queryForObject("SELECT used_amount FROM lab_card03_limits WHERE run_id=?", Long.class, run);
    }
}
