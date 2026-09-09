package com.bookwave.lab.mockpg.api;

public record PaymentResult(
        String correlationId,
        String orderNo,
        String paymentId,
        String pgTid,
        Decision decision,
        long approvedAmount,
        String authorizationNo,
        String reasonCode
) {
}
