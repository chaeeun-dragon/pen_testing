package com.bookwave.lab.bookwave.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.bookwave.lab.bookwave.api.Decision;
import com.bookwave.lab.bookwave.api.PaymentResult;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class PaymentStoreConcurrencyTest {

    @Test
    void exactlyOneConcurrentRequestOwnsTheIdempotencyKey() throws Exception {
        PaymentStore store = new PaymentStore();
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Callable<PaymentStore.Claim> claim = () -> {
                ready.countDown();
                assertThat(start.await(2, TimeUnit.SECONDS)).isTrue();
                return store.claim("request-concurrent-0001");
            };
            Future<PaymentStore.Claim> first = executor.submit(claim);
            Future<PaymentStore.Claim> second = executor.submit(claim);
            assertThat(ready.await(2, TimeUnit.SECONDS)).isTrue();
            start.countDown();

            List<PaymentStore.Claim> claims = List.of(first.get(2, TimeUnit.SECONDS), second.get(2, TimeUnit.SECONDS));
            assertThat(claims).filteredOn(PaymentStore.Claim::owner).hasSize(1);

            PaymentStore.StoredPayment payment = new PaymentStore.StoredPayment("fingerprint",
                    new PaymentResult("corr-concurrent-0001", "order-concurrent-0001", "PAY-ONE", "PG-ONE",
                            Decision.APPROVED, 1_000, "AUTH-ONE", "APPROVED"));
            store.complete(claims.stream().filter(PaymentStore.Claim::owner).findFirst().orElseThrow(), payment);

            assertThat(claims).allSatisfy(candidate -> assertThat(store.await(candidate)).isEqualTo(payment));
        } finally {
            executor.shutdownNow();
        }
    }
}
