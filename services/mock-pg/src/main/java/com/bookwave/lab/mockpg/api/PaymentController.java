package com.bookwave.lab.mockpg.api;

import com.bookwave.lab.mockpg.service.MockPgService;
import jakarta.validation.Valid;
import org.slf4j.MDC;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/v1/pg")
public class PaymentController {

    private final MockPgService mockPgService;

    public PaymentController(MockPgService mockPgService) {
        this.mockPgService = mockPgService;
    }

    @PostMapping("/charges")
    public ResponseEntity<PaymentResult> charge(
            @RequestHeader("X-Correlation-Id") String correlationId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody PaymentRequest request) {
        try (MDC.MDCCloseable ignored = MDC.putCloseable("correlationId", correlationId)) {
            return ResponseEntity.ok(mockPgService.charge(request, correlationId, idempotencyKey));
        }
    }

    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("{\"status\":\"UP\",\"service\":\"mock-pg\"}");
    }
}
