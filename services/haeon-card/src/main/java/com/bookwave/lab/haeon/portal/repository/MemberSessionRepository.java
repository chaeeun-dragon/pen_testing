package com.bookwave.lab.haeon.portal.repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class MemberSessionRepository {
    private final JdbcTemplate jdbc;

    public MemberSessionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(String tokenHash, long memberId, Instant issuedAt, Instant expiresAt) {
        jdbc.update("INSERT INTO member_sessions (token_hash, member_id, issued_at, expires_at) "
                        + "VALUES (?, ?, ?, ?)",
                tokenHash, memberId, Timestamp.from(issuedAt), Timestamp.from(expiresAt));
    }

    /** 유효한 세션의 회원 ID만 돌려준다. 만료·로그아웃 세션은 없는 것으로 취급한다. */
    public Optional<Long> findMemberIdByActiveToken(String tokenHash, Instant now) {
        return jdbc.query(
                "SELECT member_id FROM member_sessions "
                        + "WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
                rs -> rs.next() ? Optional.of(rs.getLong("member_id")) : Optional.<Long>empty(),
                tokenHash, Timestamp.from(now));
    }

    public int revoke(String tokenHash, Instant now) {
        return jdbc.update("UPDATE member_sessions SET revoked_at = ? "
                        + "WHERE token_hash = ? AND revoked_at IS NULL",
                Timestamp.from(now), tokenHash);
    }

    /** 만료된 지 오래된 세션 행을 지운다. 로그인 때마다 가볍게 호출한다. */
    public int deleteExpiredBefore(Instant threshold) {
        return jdbc.update("DELETE FROM member_sessions WHERE expires_at < ?", Timestamp.from(threshold));
    }
}
