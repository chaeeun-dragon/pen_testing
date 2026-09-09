package com.bookwave.lab.mockpg.api;

import java.time.Instant;

public record AuthorizationRequest(
        String correlationId,
        String merchantNo,
        String merchantRequestId,
        String cardToken,
        long amount,
        String currency,
        String requestFingerprint,
        Instant requestedAt
) {
}
