package com.bookwave.lab.bookwave.api;

import com.bookwave.lab.bookwave.service.IncidentSimulationService;
import com.bookwave.lab.bookwave.error.BookwaveException;
import org.springframework.http.HttpStatus;
import org.slf4j.MDC;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Separate lab control-plane endpoint. It is not a payment route and does not accept a payment
 * body, merchant identity, card token, command, or arbitrary event content.
 */
@RestController
@RequestMapping("/internal/v1/lab/incident-simulations")
public class IncidentSimulationController {
    private final IncidentSimulationService incidentSimulationService;

    public IncidentSimulationController(IncidentSimulationService incidentSimulationService) {
        this.incidentSimulationService = incidentSimulationService;
    }

    @PostMapping("/payment-server")
    public ResponseEntity<IncidentSimulationResponse> simulatePaymentServerIncident(
            @RequestHeader("X-Correlation-Id") String correlationId,
            @RequestHeader("X-Lab-Run-Id") String runId,
            @RequestHeader("X-Lab-Simulation-Token") String accessToken,
            @RequestBody(required = false) String body) {
        if (body != null && !body.isBlank()) {
            throw new BookwaveException(HttpStatus.BAD_REQUEST, "SIMULATION_BODY_NOT_ALLOWED",
                    "시뮬레이션 경로는 요청 본문을 받지 않습니다.", false);
        }
        try (MDC.MDCCloseable ignored = MDC.putCloseable("correlationId", correlationId)) {
            return ResponseEntity.ok(incidentSimulationService.simulate(runId, correlationId, accessToken));
        }
    }
}
