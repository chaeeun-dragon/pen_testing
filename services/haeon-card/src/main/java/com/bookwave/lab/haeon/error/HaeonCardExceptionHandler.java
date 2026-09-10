package com.bookwave.lab.haeon.error;

import com.bookwave.lab.haeon.api.ErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.bind.MissingRequestHeaderException;

@RestControllerAdvice
public class HaeonCardExceptionHandler {

    @ExceptionHandler(HaeonCardException.class)
    public ResponseEntity<ErrorResponse> handleDomain(HaeonCardException ex) {
        return ResponseEntity.status(ex.status())
                .body(new ErrorResponse(ex.correlationId(), ex.errorCode(), ex.getMessage(), ex.retryable()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException ex,
                                                           HttpServletRequest request) {
        return ResponseEntity.badRequest()
                .body(new ErrorResponse(correlationId(request), "INVALID_REQUEST",
                        "필수값 또는 형식이 올바르지 않습니다.", false));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleUnreadable(HttpMessageNotReadableException ex,
                                                          HttpServletRequest request) {
        return ResponseEntity.badRequest()
                .body(new ErrorResponse(correlationId(request), "INVALID_REQUEST",
                        "요청 JSON을 읽을 수 없습니다.", false));
    }

    @ExceptionHandler(MissingRequestHeaderException.class)
    public ResponseEntity<ErrorResponse> handleMissingHeader(MissingRequestHeaderException ex,
                                                              HttpServletRequest request) {
        String code = "Idempotency-Key".equals(ex.getHeaderName())
                ? "MISSING_IDEMPOTENCY_KEY" : "INVALID_REQUEST";
        String message = "Idempotency-Key".equals(ex.getHeaderName())
                ? "Idempotency-Key가 필요합니다." : "필수 헤더가 없습니다.";
        return ResponseEntity.badRequest()
                .body(new ErrorResponse(correlationId(request), code, message, false));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception ex, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ErrorResponse(correlationId(request), "INTERNAL_ERROR",
                        "해온카드 내부 처리 중 오류가 발생했습니다.", false));
    }

    private String correlationId(HttpServletRequest request) {
        String value = request.getHeader("X-Correlation-Id");
        return value == null || value.isBlank() ? "unknown" : value;
    }
}
