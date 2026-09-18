package com.bookwave.lab.haeon.portal.api;

import java.time.Instant;

public record TransactionResponse(
        String authorizationNo,
        Instant occurredAt,
        String merchantName,
        String cardName,
        String maskedNumber,
        long amount,
        String status,
        String reasonCode
) {
}
