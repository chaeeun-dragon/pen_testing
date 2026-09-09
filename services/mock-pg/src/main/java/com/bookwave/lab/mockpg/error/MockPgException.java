package com.bookwave.lab.mockpg.error;

import org.springframework.http.HttpStatus;

public class MockPgException extends RuntimeException {
    private final HttpStatus status;
    private final String errorCode;
    private final boolean retryable;

    public MockPgException(HttpStatus status, String errorCode, String message, boolean retryable) {
        super(message);
        this.status = status;
        this.errorCode = errorCode;
        this.retryable = retryable;
    }

    public HttpStatus status() {
        return status;
    }

    public String errorCode() {
        return errorCode;
    }

    public boolean retryable() {
        return retryable;
    }
}
