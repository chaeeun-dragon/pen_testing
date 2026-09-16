package com.bookwave.lab.bookwave.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.bookwave.lab.bookwave.api.IncidentSimulationResponse;
import com.bookwave.lab.bookwave.config.IncidentSimulationProperties;
import org.junit.jupiter.api.Test;

class IncidentSimulationServiceTest {

    @Test
    void emitsOnlyTheFixedBlockedSyntheticScenario() {
        IncidentSimulationGuard guard = new IncidentSimulationGuard(
                new IncidentSimulationProperties(true, "lab-control"));
        IncidentSimulationService service = new IncidentSimulationService(guard);

        IncidentSimulationResponse response = service.simulate(
                "INCIDENT-SIM-20260916T000000Z", "corr-sim-20260916-0001", "lab-control");

        assertThat(response.scenarioId()).isEqualTo(IncidentSimulationService.SCENARIO_ID);
        assertThat(response.simulation()).isTrue();
        assertThat(response.outcome()).isEqualTo("BLOCKED");
        assertThat(response.mockPgCalled()).isFalse();
        assertThat(response.haeonCardCalled()).isFalse();
        assertThat(response.events()).extracting(event -> event.event()).containsExactly(
                "incident_simulation_started",
                "simulated_payment_server_access_detected",
                "simulated_synthetic_data_access_attempted",
                "incident_simulation_alert_raised",
                "simulated_synthetic_data_access_blocked",
                "incident_simulation_additional_verification_passed",
                "incident_simulation_completed");
        assertThat(response.events()).extracting(event -> event.result()).containsExactly(
                "RECORDED", "OBSERVED", "OBSERVED", "ALERT", "BLOCKED", "PASS", "PASS");
    }
}
