package com.bookwave.lab.haeon.api;

import com.bookwave.lab.haeon.config.HaeonCardProperties;
import com.bookwave.lab.haeon.service.ApprovalService;
import jakarta.validation.Valid;
import java.util.Map;
import org.slf4j.MDC;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/v1")
public class AuthorizationController {
    private final ApprovalService approvalService;
    private final HaeonCardProperties properties;

    public AuthorizationController(ApprovalService approvalService, HaeonCardProperties properties) {
        this.approvalService = approvalService;
        this.properties = properties;
    }

    @PostMapping("/authorizations")
    public ResponseEntity<AuthorizationResponse> authorize(
            @RequestHeader("X-Correlation-Id") String correlationId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @Valid @RequestBody AuthorizationRequest request) {
        try (MDC.MDCCloseable ignored = MDC.putCloseable("correlationId", correlationId)) {
            return ResponseEntity.ok(approvalService.authorize(
                    request, correlationId, idempotencyKey, authorization));
        }
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        return ResponseEntity.ok(Map.of(
                "status", "UP",
                "service", "haeon-card",
                "profile", safeProfile(),
                "beforeBarrierEnabled", beforeBarrierActive()));
    }

    private String safeProfile() {
        return properties.labProfile() == null ? "normal" : properties.labProfile();
    }

    private boolean beforeBarrierActive() {
        return properties.beforeBarrierEnabled() && "before".equalsIgnoreCase(safeProfile());
    }
}
