package com.bookwave.lab.bookwave.service;

import com.bookwave.lab.bookwave.api.OrderStatus;
import com.bookwave.lab.bookwave.api.PaymentResult;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

@Component
public class PaymentStore {
    private final ConcurrentHashMap<String, StoredPayment> payments = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, OrderStatus> orders = new ConcurrentHashMap<>();

    public Optional<StoredPayment> findPayment(String merchantRequestId) {
        return Optional.ofNullable(payments.get(merchantRequestId));
    }

    public void putPayment(String merchantRequestId, StoredPayment payment) {
        payments.putIfAbsent(merchantRequestId, payment);
    }

    public void markOrder(String orderNo, OrderStatus status) {
        orders.put(orderNo, status);
    }

    public OrderStatus orderStatus(String orderNo) {
        return orders.get(orderNo);
    }

    public record StoredPayment(String requestFingerprint, PaymentResult result) {
    }
}
