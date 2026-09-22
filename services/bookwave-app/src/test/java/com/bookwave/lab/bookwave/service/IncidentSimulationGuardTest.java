package com.bookwave.lab.bookwave.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bookwave.lab.bookwave.config.IncidentSimulationProperties;
import com.bookwave.lab.bookwave.error.BookwaveException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class IncidentSimulationGuardTest {

    @Test
    void disabledByDefaultRejectsAnySimulationRun() {
        IncidentSimulationGuard guard = new IncidentSimulationGuard(new IncidentSimulationProperties(false, "lab-control"));

        assertThatThrownBy(() -> guard.requireEnabled("INCIDENT-SIM-20260916T000000Z"))
                .isInstanceOfSatisfying(BookwaveException.class, error -> {
                    assertThat(error.status()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(error.errorCode()).isEqualTo("INCIDENT_SIMULATION_DISABLED");
                });
    }

    @Test
    void enabledModeStillRequiresSyntheticRunId() {
        IncidentSimulationGuard guard = new IncidentSimulationGuard(new IncidentSimulationProperties(true, "lab-control"));

        assertThatThrownBy(() -> guard.requireEnabled("invalid-run-id"))
                .isInstanceOfSatisfying(BookwaveException.class, error -> {
                    assertThat(error.status()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(error.errorCode()).isEqualTo("INVALID_SIMULATION_RUN_ID");
                });
    }

    @Test
    void enabledModeAcceptsSyntheticIncidentRunId() {
        IncidentSimulationGuard guard = new IncidentSimulationGuard(new IncidentSimulationProperties(true, "lab-control"));

        guard.requireEnabled("INCIDENT-SIM-20260916T000000Z");
    }

    @Test
    void enabledModeRequiresConfiguredControlToken() {
        IncidentSimulationGuard guard = new IncidentSimulationGuard(new IncidentSimulationProperties(true, ""));

        assertThatThrownBy(() -> guard.requireAuthorized("INCIDENT-SIM-20260916T000000Z", "lab-control"))
                .isInstanceOfSatisfying(BookwaveException.class, error -> {
                    assertThat(error.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
                    assertThat(error.errorCode()).isEqualTo("INCIDENT_SIMULATION_NOT_CONFIGURED");
                });
    }

    @Test
    void enabledModeRejectsWrongControlToken() {
        IncidentSimulationGuard guard = new IncidentSimulationGuard(new IncidentSimulationProperties(true, "lab-control"));

        assertThatThrownBy(() -> guard.requireAuthorized("INCIDENT-SIM-20260916T000000Z", "wrong-token"))
                .isInstanceOfSatisfying(BookwaveException.class, error -> {
                    assertThat(error.status()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(error.errorCode()).isEqualTo("INCIDENT_SIMULATION_NOT_AUTHORIZED");
                });
    }

    @Test
    void enabledModeAcceptsConfiguredControlToken() {
        IncidentSimulationGuard guard = new IncidentSimulationGuard(new IncidentSimulationProperties(true, "lab-control"));

        guard.requireAuthorized("INCIDENT-SIM-20260916T000000Z", "lab-control");
    }
}
