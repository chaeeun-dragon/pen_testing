package com.bookwave.lab.mockpg.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.bookwave.lab.mockpg.api.PaymentRequest;
import org.junit.jupiter.api.Test;

class RequestFingerprintTest {
    private final RequestFingerprint fingerprint = new RequestFingerprint();

    @Test
    void samePaymentProducesSameFingerprint() {
        PaymentRequest request = new PaymentRequest(
                "corr-20260909-0001", "BW-ORDER-0001", "BW-REQ-0001", 10000, "KRW", "card-token-lab-001");
        assertThat(fingerprint.of(request)).isEqualTo(fingerprint.of(request));
    }

    @Test
    void amountChangeProducesDifferentFingerprint() {
        PaymentRequest one = new PaymentRequest(
                "corr-20260909-0001", "BW-ORDER-0001", "BW-REQ-0001", 10000, "KRW", "card-token-lab-001");
        PaymentRequest two = new PaymentRequest(
                "corr-20260909-0001", "BW-ORDER-0001", "BW-REQ-0001", 20000, "KRW", "card-token-lab-001");
        assertThat(fingerprint.of(one)).isNotEqualTo(fingerprint.of(two));
    }
}
