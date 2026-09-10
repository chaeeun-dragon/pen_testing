package com.bookwave.lab.haeon.repository;

import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class MerchantRepository {
    private final JdbcTemplate jdbc;

    public MerchantRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Merchant> findActiveByMerchantNo(String merchantNo) {
        return jdbc.query(
                "SELECT merchant_id, merchant_no, status FROM merchants WHERE merchant_no = ? AND status = 'ACTIVE'",
                rs -> {
                    if (!rs.next()) {
                        return Optional.empty();
                    }
                    return Optional.of(new Merchant(rs.getLong("merchant_id"),
                            rs.getString("merchant_no"), rs.getString("status")));
                }, merchantNo);
    }

    public record Merchant(long merchantId, String merchantNo, String status) {
    }
}
