package com.bookwave.lab.bookwave.error;

import com.bookwave.lab.bookwave.api.ErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class BookwaveExceptionHandler {

    @ExceptionHandler(BookwaveException.class)
    ResponseEntity<ErrorResponse> handle(BookwaveException ex, HttpServletRequest request) {
        return ResponseEntity.status(ex.status())
                .body(new ErrorResponse(correlationId(request), ex.errorCode(), ex.getMessage(), ex.retryable()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException ex, HttpServletRequest request) {
        return ResponseEntity.badRequest()
                .body(new ErrorResponse(correlationId(request), "INVALID_REQUEST", "필수값 또는 형식이 올바르지 않습니다.", false));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<ErrorResponse> handleConstraint(ConstraintViolationException ex, HttpServletRequest request) {
        return ResponseEntity.badRequest()
                .body(new ErrorResponse(correlationId(request), "INVALID_REQUEST", "필수값 또는 형식이 올바르지 않습니다.", false));
    }

    @ExceptionHandler(MissingRequestHeaderException.class)
    ResponseEntity<ErrorResponse> handleMissingHeader(MissingRequestHeaderException ex, HttpServletRequest request) {
        String code = "Idempotency-Key".equals(ex.getHeaderName())
                ? "MISSING_IDEMPOTENCY_KEY" : "INVALID_REQUEST";
        String message = "Idempotency-Key".equals(ex.getHeaderName())
                ? "Idempotency-Key가 필요합니다." : "필수 헤더가 없습니다.";
        return ResponseEntity.badRequest()
                .body(new ErrorResponse(correlationId(request), code, message, false));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorResponse> handleUnexpected(Exception ex, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ErrorResponse(correlationId(request), "INTERNAL_ERROR", "처리 중 알 수 없는 오류가 발생했습니다.", false));
    }

    private String correlationId(HttpServletRequest request) {
        String value = request.getHeader("X-Correlation-Id");
        return value == null || value.isBlank() ? "unknown" : value;
    }
}
