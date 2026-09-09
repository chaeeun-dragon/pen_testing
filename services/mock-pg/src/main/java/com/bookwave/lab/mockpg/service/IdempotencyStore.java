package com.bookwave.lab.mockpg.service;

import com.bookwave.lab.mockpg.api.PaymentResult;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

@Component
public class IdempotencyStore {
    private final ConcurrentHashMap<String, StoredPayment> values = new ConcurrentHashMap<>();

    public Optional<StoredPayment> find(String key) {
        return Optional.ofNullable(values.get(key));
    }

    public void put(String key, StoredPayment value) {
        values.putIfAbsent(key, value);
    }

    public record StoredPayment(String requestFingerprint, PaymentResult result) {
    }
}
