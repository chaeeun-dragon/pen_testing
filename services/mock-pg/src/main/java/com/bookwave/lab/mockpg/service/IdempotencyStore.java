package com.bookwave.lab.mockpg.service;

import com.bookwave.lab.mockpg.api.PaymentResult;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import org.springframework.stereotype.Component;

@Component
public class IdempotencyStore {
    private final ConcurrentHashMap<String, CompletableFuture<StoredPayment>> values = new ConcurrentHashMap<>();

    /**
     * Holds the first request's result in a future so concurrent retries share it atomically.
     */
    public Claim claim(String key) {
        CompletableFuture<StoredPayment> candidate = new CompletableFuture<>();
        CompletableFuture<StoredPayment> existing = values.putIfAbsent(key, candidate);
        return existing == null ? new Claim(true, candidate) : new Claim(false, existing);
    }

    public StoredPayment await(Claim claim) {
        try {
            return claim.completion().get();
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("진행 중인 멱등 PG 결과를 기다리다 인터럽트되었습니다.", ex);
        } catch (ExecutionException ex) {
            if (ex.getCause() instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            throw new IllegalStateException("진행 중인 멱등 PG 결과를 읽지 못했습니다.", ex.getCause());
        }
    }

    public void complete(Claim claim, StoredPayment value) {
        requireOwner(claim);
        claim.completion().complete(value);
    }

    public void fail(String key, Claim claim, RuntimeException failure) {
        requireOwner(claim);
        claim.completion().completeExceptionally(failure);
        values.remove(key, claim.completion());
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
