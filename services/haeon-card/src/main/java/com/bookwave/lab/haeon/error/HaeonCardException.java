package com.bookwave.lab.haeon.error;

import org.springframework.http.HttpStatus;

public class HaeonCardException extends RuntimeException {
    private final HttpStatus status;
    private final String errorCode;
    private final String correlationId;
    private final boolean retryable;

    public HaeonCardException(HttpStatus status, String errorCode, String message,
                              String correlationId, boolean retryable) {
        super(message);
        this.status = status;
        this.errorCode = errorCode;
        this.correlationId = correlationId;
        this.retryable = retryable;
    }

    public HttpStatus status() {
        return status;
    }

    public String errorCode() {
        return errorCode;
    }

    public String correlationId() {
        return correlationId;
    }

    public boolean retryable() {
        return retryable;
    }
}
