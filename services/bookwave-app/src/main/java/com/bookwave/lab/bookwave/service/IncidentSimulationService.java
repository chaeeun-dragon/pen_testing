package com.bookwave.lab.bookwave.service;

import com.bookwave.lab.bookwave.api.IncidentSimulationEvent;
import com.bookwave.lab.bookwave.api.IncidentSimulationResponse;
import com.bookwave.lab.bookwave.error.BookwaveException;
import java.util.List;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Emits a deliberately fixed set of synthetic incident observations. It has no database client,
 * no payment service dependency, and no Mock PG or Haeon Card client dependency.
 */
@Service
public class IncidentSimulationService {
    public static final String SCENARIO_ID = "PAYMENT_SERVER_INCIDENT_V1";
    private static final Logger log = LoggerFactory.getLogger(IncidentSimulationService.class);
    private static final Pattern CORRELATION_ID = Pattern.compile("[A-Za-z0-9_-]{8,80}");
    private static final List<IncidentSimulationEvent> FIXED_EVENTS = List.of(
            new IncidentSimulationEvent("S1", "incident_simulation_started", "RECORDED"),
            new IncidentSimulationEvent("S1", "simulated_payment_server_access_detected", "ALERT"),
            new IncidentSimulationEvent("S2", "simulated_synthetic_data_access_blocked", "BLOCKED"),
            new IncidentSimulationEvent("S4", "incident_simulation_completed", "PASS"));

    private final IncidentSimulationGuard guard;

    public IncidentSimulationService(IncidentSimulationGuard guard) {
        this.guard = guard;
    }

    public IncidentSimulationResponse simulate(String runId, String correlationId, String accessToken) {
        validateCorrelationId(correlationId);
        guard.requireAuthorized(runId, accessToken);

        log.info("event=incident_simulation_started scenarioId={} runId={} simulation=true "
                        + "route=dedicated_lab_control_plane",
                SCENARIO_ID, runId);
        log.warn("event=simulated_payment_server_access_detected scenarioId={} runId={} simulation=true "
                        + "result=ALERT observation=fixed_synthetic_signal",
                SCENARIO_ID, runId);
        log.info("event=simulated_synthetic_data_access_blocked scenarioId={} runId={} simulation=true "
                        + "result=BLOCKED dataClass=synthetic_reference",
                SCENARIO_ID, runId);
        log.info("event=incident_simulation_completed scenarioId={} runId={} simulation=true "
                        + "result=PASS mockPgCalled=false haeonCardCalled=false",
                SCENARIO_ID, runId);

        return new IncidentSimulationResponse(
                SCENARIO_ID,
                runId,
                correlationId,
                true,
                "BLOCKED",
                false,
                false,
                FIXED_EVENTS);
    }

    private void validateCorrelationId(String correlationId) {
        if (correlationId == null || !CORRELATION_ID.matcher(correlationId).matches()) {
            throw new BookwaveException(HttpStatus.BAD_REQUEST, "INVALID_CORRELATION_ID",
                    "correlationId는 8~80자의 ASCII 식별자여야 합니다.", false);
        }
    }
}
