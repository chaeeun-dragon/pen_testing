package com.bookwave.lab.bookwave.service;

import com.bookwave.lab.bookwave.api.OrderStatus;
import com.bookwave.lab.bookwave.api.PaymentResult;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import org.springframework.stereotype.Component;

@Component
public class PaymentStore {
    private final ConcurrentHashMap<String, CompletableFuture<StoredPayment>> payments = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, OrderStatus> orders = new ConcurrentHashMap<>();

    /**
     * Atomically reserves an idempotency key.  A non-owner waits for the owner's exact result
     * instead of independently calling Mock PG.
     */
    public Claim claim(String merchantRequestId) {
        CompletableFuture<StoredPayment> candidate = new CompletableFuture<>();
        CompletableFuture<StoredPayment> existing = payments.putIfAbsent(merchantRequestId, candidate);
        return existing == null ? new Claim(true, candidate) : new Claim(false, existing);
    }

    public StoredPayment await(Claim claim) {
        try {
            return claim.completion().get();
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("진행 중인 멱등 결제 결과를 기다리다 인터럽트되었습니다.", ex);
        } catch (ExecutionException ex) {
            if (ex.getCause() instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            throw new IllegalStateException("진행 중인 멱등 결제 결과를 읽지 못했습니다.", ex.getCause());
        }
    }

    public void complete(Claim claim, StoredPayment payment) {
        requireOwner(claim);
        claim.completion().complete(payment);
    }

    public void fail(String merchantRequestId, Claim claim, RuntimeException failure) {
        requireOwner(claim);
        claim.completion().completeExceptionally(failure);
        payments.remove(merchantRequestId, claim.completion());
    }

    public void markOrder(String orderNo, OrderStatus status) {
        orders.put(orderNo, status);
    }

    public OrderStatus orderStatus(String orderNo) {
        return orders.get(orderNo);
    }

    private void requireOwner(Claim claim) {
        if (!claim.owner()) {
            throw new IllegalArgumentException("멱등키 선점 요청만 결과를 확정할 수 있습니다.");
        }
    }

    public record Claim(boolean owner, CompletableFuture<StoredPayment> completion) {
    }

    public record StoredPayment(String requestFingerprint, PaymentResult result) {
    }
}
