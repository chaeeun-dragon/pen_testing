package com.bookwave.lab.haeon.api;

public record ErrorResponse(
        String correlationId,
        String errorCode,
        String message,
        boolean retryable
) {
}
