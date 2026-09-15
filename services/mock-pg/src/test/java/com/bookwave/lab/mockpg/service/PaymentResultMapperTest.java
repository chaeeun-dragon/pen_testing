package com.bookwave.lab.mockpg.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.bookwave.lab.mockpg.api.AuthorizationResult;
import com.bookwave.lab.mockpg.api.Decision;
import com.bookwave.lab.mockpg.api.PaymentRequest;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class PaymentResultMapperTest {

    private final PaymentResultMapper mapper = new PaymentResultMapper();

    @Test
    void mapsApprovedCardResponseWithoutExposingRemainingLimit() {
        PaymentRequest request = request("BW-ORDER-APPROVED", "BW-REQ-APPROVED");
        AuthorizationResult authorization = new AuthorizationResult(
                request.correlationId(), 11L, "AUTH-HC-001", Decision.APPROVED,
                10000L, 90000L, "APPROVED");

        var result = mapper.toPaymentResult(request, authorization, "PAY-LAB-001", "PG-LAB-001");

        assertThat(result.correlationId()).isEqualTo(request.correlationId());
        assertThat(result.orderNo()).isEqualTo(request.orderNo());
        assertThat(result.paymentId()).isEqualTo("PAY-LAB-001");
        assertThat(result.pgTid()).isEqualTo("PG-LAB-001");
        assertThat(result.decision()).isEqualTo(Decision.APPROVED);
        assertThat(result.approvedAmount()).isEqualTo(10000L);
        assertThat(result.authorizationNo()).isEqualTo("AUTH-HC-001");
        assertThat(result.reasonCode()).isEqualTo("APPROVED");
    }

    @Test
    void mapsDeclinedCardResponseAndKeepsZeroApprovedAmount() {
        PaymentRequest request = request("BW-ORDER-DECLINED", "BW-REQ-DECLINED");
        AuthorizationResult authorization = new AuthorizationResult(
                request.correlationId(), 12L, "AUTH-HC-002", Decision.DECLINED,
                0L, 0L, "LIMIT_EXCEEDED");

        var result = mapper.toPaymentResult(request, authorization, "PAY-LAB-002", "PG-LAB-002");

        assertThat(result.decision()).isEqualTo(Decision.DECLINED);
        assertThat(result.approvedAmount()).isZero();
        assertThat(result.authorizationNo()).isEqualTo("AUTH-HC-002");
        assertThat(result.reasonCode()).isEqualTo("LIMIT_EXCEEDED");
    }

    private PaymentRequest request(String orderNo, String requestId) {
        return new PaymentRequest(
                "corr-" + UUID.randomUUID().toString().replace("-", "").substring(0, 12),
                orderNo,
                requestId,
                10000L,
                "KRW",
                "card-token-lab-001");
    }
}
