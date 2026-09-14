package com.bookwave.lab.mockpg.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.bookwave.lab.mockpg.api.PaymentRequest;
import com.bookwave.lab.mockpg.config.MockPgProperties;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class CardAuthorizationMapperTest {

    private final CardAuthorizationMapper mapper = new CardAuthorizationMapper();
    private final MockPgProperties properties = new MockPgProperties(
            "http://haeon-card:8084",
            "BOOKWAVE-LAB",
            "lab-merchant-bookwave",
            2000,
            5000,
            "normal",
            false);

    @Test
    void mapsBookwavePaymentToCardAuthorizationContract() {
        PaymentRequest payment = new PaymentRequest(
                "corr-20260914-0001",
                "BW-ORDER-0001",
                "BW-REQ-0001",
                10000,
                "KRW",
                "card-token-lab-001");
        Instant requestedAt = Instant.parse("2026-09-14T05:00:00Z");

        var result = mapper.toCardAuthorization(
                payment,
                properties,
                "0".repeat(64),
                requestedAt);

        assertThat(result.correlationId()).isEqualTo(payment.correlationId());
        assertThat(result.merchantNo()).isEqualTo("BOOKWAVE-LAB");
        assertThat(result.merchantRequestId()).isEqualTo(payment.merchantRequestId());
        assertThat(result.cardToken()).isEqualTo(payment.paymentMethodToken());
        assertThat(result.amount()).isEqualTo(payment.amount());
        assertThat(result.currency()).isEqualTo("KRW");
        assertThat(result.requestFingerprint()).hasSize(64);
        assertThat(result.requestedAt()).isEqualTo(requestedAt);
    }
}
