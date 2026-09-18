package com.bookwave.lab.haeon.portal.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class MemberRepository {
    private final JdbcTemplate jdbc;

    public MemberRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<MemberCredential> findCredentialByLoginId(String loginId) {
        return jdbc.query(
                "SELECT member_id, member_no, display_name, created_at, password_salt, password_hash "
                        + "FROM card_members WHERE login_id = ?",
                rs -> rs.next()
                        ? Optional.of(new MemberCredential(member(rs),
                                rs.getString("password_salt"), rs.getString("password_hash")))
                        : Optional.empty(),
                loginId);
    }

    public Optional<Member> findById(long memberId) {
        return jdbc.query(
                "SELECT member_id, member_no, display_name, created_at FROM card_members WHERE member_id = ?",
                rs -> rs.next() ? Optional.of(member(rs)) : Optional.empty(),
                memberId);
    }

    private Member member(ResultSet rs) throws SQLException {
        return new Member(
                rs.getLong("member_id"),
                rs.getString("member_no"),
                rs.getString("display_name"),
                rs.getTimestamp("created_at").toInstant());
    }

    public record Member(long memberId, String memberNo, String displayName, Instant joinedAt) {
    }

    public record MemberCredential(Member member, String passwordSalt, String passwordHash) {
    }
}
