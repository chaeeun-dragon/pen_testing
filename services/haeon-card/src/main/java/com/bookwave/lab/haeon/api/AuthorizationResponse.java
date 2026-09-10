package com.bookwave.lab.haeon.api;

public record AuthorizationResponse(
        String correlationId,
        long authorizationId,
        String authorizationNo,
        Decision decision,
        long approvedAmount,
        Long remainingLimit,
        String reasonCode
) {
}
