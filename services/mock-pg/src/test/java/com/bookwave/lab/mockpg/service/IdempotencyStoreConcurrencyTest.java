package com.bookwave.lab.mockpg.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.bookwave.lab.mockpg.api.Decision;
import com.bookwave.lab.mockpg.api.PaymentResult;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class IdempotencyStoreConcurrencyTest {

    @Test
    void exactlyOneConcurrentRequestOwnsTheIdempotencyKey() throws Exception {
        IdempotencyStore store = new IdempotencyStore();
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Callable<IdempotencyStore.Claim> claim = () -> {
                ready.countDown();
                assertThat(start.await(2, TimeUnit.SECONDS)).isTrue();
                return store.claim("request-concurrent-0001");
            };
            Future<IdempotencyStore.Claim> first = executor.submit(claim);
            Future<IdempotencyStore.Claim> second = executor.submit(claim);
            assertThat(ready.await(2, TimeUnit.SECONDS)).isTrue();
            start.countDown();

            List<IdempotencyStore.Claim> claims = List.of(first.get(2, TimeUnit.SECONDS), second.get(2, TimeUnit.SECONDS));
            assertThat(claims).filteredOn(IdempotencyStore.Claim::owner).hasSize(1);

            IdempotencyStore.StoredPayment payment = new IdempotencyStore.StoredPayment("fingerprint",
                    new PaymentResult("corr-concurrent-0001", "order-concurrent-0001", "PAY-ONE", "PG-ONE",
                            Decision.APPROVED, 1_000, "AUTH-ONE", "APPROVED"));
            store.complete(claims.stream().filter(IdempotencyStore.Claim::owner).findFirst().orElseThrow(), payment);

            assertThat(claims).allSatisfy(candidate -> assertThat(store.await(candidate)).isEqualTo(payment));
        } finally {
            executor.shutdownNow();
        }
    }
}
