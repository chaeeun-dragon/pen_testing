package com.bookwave.lab.mockpg.api;

public record AuthorizationResult(
        String correlationId,
        long authorizationId,
        String authorizationNo,
        Decision decision,
        long approvedAmount,
        Long remainingLimit,
        String reasonCode
) {
}
