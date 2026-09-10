package com.bookwave.lab.haeon.repository;

import java.math.BigDecimal;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class CardLimitRepository {
    private final JdbcTemplate jdbc;

    public CardLimitRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<CardLimit> findForUpdate(long cardId) {
        return find(cardId, true);
    }

    public Optional<CardLimit> findSnapshot(long cardId) {
        return find(cardId, false);
    }

    private Optional<CardLimit> find(long cardId, boolean lock) {
        String lockClause = lock ? " FOR UPDATE" : "";
        return jdbc.query(
                "SELECT card_id, limit_amount, used_amount, version "
                        + "FROM card_limits WHERE card_id = ?" + lockClause,
                rs -> {
                    if (!rs.next()) {
                        return Optional.empty();
                    }
                    return Optional.of(new CardLimit(
                            rs.getLong("card_id"),
                            rs.getBigDecimal("limit_amount"),
                            rs.getBigDecimal("used_amount"),
                            rs.getLong("version")));
                }, cardId);
    }

    public int increaseUsedAmount(long cardId, BigDecimal amount) {
        return jdbc.update(
                "UPDATE card_limits SET used_amount = used_amount + ?, version = version + 1 WHERE card_id = ?",
                amount, cardId);
    }

    public record CardLimit(long cardId, BigDecimal limitAmount, BigDecimal usedAmount, long version) {
    }
}
