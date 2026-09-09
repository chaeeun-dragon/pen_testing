package com.bookwave.lab.mockpg.api;

public record ErrorResponse(
        String correlationId,
        String errorCode,
        String message,
        boolean retryable
) {
}
