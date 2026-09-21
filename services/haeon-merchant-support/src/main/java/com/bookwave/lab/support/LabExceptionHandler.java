package com.bookwave.lab.support;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class LabExceptionHandler {
    @ExceptionHandler(LabSupportController.LabException.class)
    public ResponseEntity<Map<String, String>> handle(LabSupportController.LabException ex) {
        return ResponseEntity.status(ex.status).body(Map.of("errorCode", ex.code, "message", ex.getMessage(), "simulation", "true"));
    }
}
