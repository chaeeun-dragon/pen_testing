package com.bookwave.lab.haeon.repository;

import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class CardRepository {
    private final JdbcTemplate jdbc;

    public CardRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Card> findByToken(String cardToken) {
        return jdbc.query(
                "SELECT card_id, member_id, card_token, status, status_version "
                        + "FROM cards WHERE card_token = ?",
                rs -> {
                    if (!rs.next()) {
                        return Optional.empty();
                    }
                    return Optional.of(new Card(
                            rs.getLong("card_id"),
                            rs.getLong("member_id"),
                            rs.getString("card_token"),
                            rs.getString("status"),
                            rs.getLong("status_version")));
                }, cardToken);
    }

    public record Card(long cardId, long memberId, String cardToken, String status, long statusVersion) {
    }
}
