package com.bookwave.lab.haeon.portal.repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 마이페이지 조회 전용 저장소다.
 *
 * <p>모든 질의는 로그인 세션에서 얻은 {@code memberId}로 범위를 좁힌다. 카드 ID나 카드 토큰을
 * 요청에서 받아 조회 대상을 고르지 않는다.
 */
@Repository
public class PortalQueryRepository {
    private final JdbcTemplate jdbc;

    public PortalQueryRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** PortalService가 회원 세션 범위를 적용한 보호 안내를 조회할 때만 사용한다. */
    public JdbcTemplate jdbc() {
        return jdbc;
    }

    public List<MemberCard> findCardsByMember(long memberId) {
        return jdbc.query(
                "SELECT c.card_id, c.card_last4, c.card_name, c.brand, c.card_type, c.payment_day, "
                        + "c.benefit_summary, c.is_primary, c.status, "
                        + "l.limit_amount, l.used_amount "
                        + "FROM cards c JOIN card_limits l ON l.card_id = c.card_id "
                        + "WHERE c.member_id = ? "
                        + "ORDER BY c.is_primary DESC, c.card_id",
                (rs, rowNum) -> new MemberCard(
                        rs.getLong("card_id"),
                        rs.getString("card_last4"),
                        rs.getString("card_name"),
                        rs.getString("brand"),
                        rs.getString("card_type"),
                        rs.getInt("payment_day"),
                        rs.getString("benefit_summary"),
                        rs.getBoolean("is_primary"),
                        rs.getString("status"),
                        rs.getBigDecimal("limit_amount"),
                        rs.getBigDecimal("used_amount")),
                memberId);
    }

    public int countCardsByMember(long memberId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM cards WHERE member_id = ?", Integer.class, memberId);
        return count == null ? 0 : count;
    }

    public List<MemberTransaction> findTransactionsByMember(long memberId, int limit) {
        return jdbc.query(
                "SELECT a.auth_no, a.amount, a.status, a.decision_code, "
                        + "COALESCE(a.decided_at, a.requested_at) AS occurred_at, "
                        + "m.name AS merchant_name, c.card_name, c.card_last4 "
                        + "FROM authorization_requests a "
                        + "JOIN cards c ON c.card_id = a.card_id "
                        + "JOIN merchants m ON m.merchant_id = a.merchant_id "
                        + "WHERE c.member_id = ? AND a.status IN ('APPROVED', 'DECLINED') "
                        + "ORDER BY occurred_at DESC, a.auth_id DESC "
                        + "LIMIT ?",
                (rs, rowNum) -> new MemberTransaction(
                        rs.getString("auth_no"),
                        rs.getTimestamp("occurred_at").toInstant(),
                        rs.getString("merchant_name"),
                        rs.getString("card_name"),
                        rs.getString("card_last4"),
                        rs.getBigDecimal("amount"),
                        rs.getString("status"),
                        rs.getString("decision_code")),
                memberId, limit);
    }

    public record MemberCard(long cardId, String cardLast4, String cardName, String brand,
                             String cardType, int paymentDay, String benefitSummary, boolean primary,
                             String status, BigDecimal limitAmount, BigDecimal usedAmount) {
    }

    public record MemberTransaction(String authorizationNo, Instant occurredAt, String merchantName,
                                    String cardName, String cardLast4, BigDecimal amount,
                                    String status, String decisionCode) {
    }
}
