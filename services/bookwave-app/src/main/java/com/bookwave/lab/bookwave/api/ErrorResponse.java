package com.bookwave.lab.bookwave.api;

public record ErrorResponse(
        String correlationId,
        String errorCode,
        String message,
        boolean retryable
) {
}
