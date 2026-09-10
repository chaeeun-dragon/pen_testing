package com.bookwave.lab.haeon.repository;

import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class AuthorizationRepository {
    private final JdbcTemplate jdbc;

    public AuthorizationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<ExistingAuthorization> findExisting(long merchantId, String merchantRequestId) {
        return jdbc.query(
                "SELECT auth_id, auth_no, status, decision_code, amount, request_fingerprint "
                        + "FROM authorization_requests WHERE merchant_id = ? AND merchant_request_id = ?",
                rs -> {
                    if (!rs.next()) {
                        return Optional.empty();
                    }
                    return Optional.of(new ExistingAuthorization(
                            rs.getLong("auth_id"),
                            rs.getString("auth_no"),
                            rs.getString("status"),
                            rs.getString("decision_code"),
                            rs.getBigDecimal("amount"),
                            rs.getString("request_fingerprint")));
                }, merchantId, merchantRequestId);
    }

    public long insertRequested(long merchantId, long cardId, String merchantRequestId,
                                String requestFingerprint, BigDecimal amount, String currency,
                                String correlationId, Instant requestedAt, String instanceId,
                                String txAttemptId, String authNo) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO authorization_requests "
                            + "(auth_no, merchant_id, merchant_request_id, request_fingerprint, card_id, "
                            + "channel, currency, amount, isolation_level, instance_id, tx_attempt_id, "
                            + "status, correlation_id, requested_at) "
                            + "VALUES (?, ?, ?, ?, ?, 'CARD', ?, ?, 'READ-COMMITTED', ?, ?, 'REQUESTED', ?, ?)",
                    new String[]{"auth_id"});
            ps.setString(1, authNo);
            ps.setLong(2, merchantId);
            ps.setString(3, merchantRequestId);
            ps.setString(4, requestFingerprint);
            ps.setLong(5, cardId);
            ps.setString(6, currency);
            ps.setBigDecimal(7, amount);
            ps.setString(8, instanceId);
            ps.setString(9, txAttemptId);
            ps.setString(10, correlationId);
            ps.setTimestamp(11, Timestamp.from(requestedAt));
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("승인 요청 PK를 생성하지 못했습니다.");
        }
        return key.longValue();
    }

    public int finalizeDecision(long authId, long readLimitVersion, BigDecimal readUsedAmount,
                                long readCardStatusVersion, Long lockQueryElapsedMs,
                                Instant lockAcquiredAt, String status, String decisionCode,
                                Instant decidedAt) {
        return jdbc.update(
                "UPDATE authorization_requests SET read_limit_version = ?, read_used_amount = ?, "
                        + "read_card_status_version = ?, lock_query_elapsed_ms = ?, lock_acquired_at = ?, "
                        + "status = ?, decision_code = ?, decided_at = ? WHERE auth_id = ?",
                readLimitVersion, readUsedAmount, readCardStatusVersion, lockQueryElapsedMs,
                lockAcquiredAt == null ? null : Timestamp.from(lockAcquiredAt),
                status, decisionCode, Timestamp.from(decidedAt), authId);
    }

    public int insertTransaction(long authId, BigDecimal amount, Instant approvedAt) {
        return jdbc.update(
                "INSERT INTO card_transactions (txn_no, auth_id, amount, status, approved_at) "
                        + "VALUES (?, ?, ?, 'APPROVED', ?)",
                "TXN-HC-" + shortId(), authId, amount, Timestamp.from(approvedAt));
    }

    public int insertAudit(long authId, long merchantId, String result, int rowCount,
                           String merchantRequestId, String correlationId, String payloadHash,
                           String detailsJson, Instant occurredAt) {
        return jdbc.update(
                "INSERT INTO audit_events "
                        + "(event_uuid, auth_id, event_type, actor_type, actor_id, action, result, row_count, "
                        + "business_ref, correlation_id, payload_hash, details_json, occurred_at) "
                        + "VALUES (?, ?, 'AUTH_COMMITTED', 'MERCHANT', ?, 'AUTHORIZE', ?, ?, ?, ?, ?, ?, ?)",
                UUID.randomUUID().toString(), authId, merchantId, result, rowCount,
                merchantRequestId, correlationId, payloadHash, detailsJson, Timestamp.from(occurredAt));
    }

    private String shortId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 16);
    }

    public record ExistingAuthorization(long authId, String authorizationNo, String status,
                                        String decisionCode, BigDecimal amount,
                                        String requestFingerprint) {
    }
}
