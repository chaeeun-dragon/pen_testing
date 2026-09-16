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
        IncidentSimulationGuard guard = new IncidentSimulationGuard(new IncidentSimulationProperties(false));

        assertThatThrownBy(() -> guard.requireEnabled("INCIDENT-SIM-20260916T000000Z"))
                .isInstanceOfSatisfying(BookwaveException.class, error -> {
                    assertThat(error.status()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(error.errorCode()).isEqualTo("INCIDENT_SIMULATION_DISABLED");
                });
    }

    @Test
    void enabledModeStillRequiresSyntheticRunId() {
        IncidentSimulationGuard guard = new IncidentSimulationGuard(new IncidentSimulationProperties(true));

        assertThatThrownBy(() -> guard.requireEnabled("CARD03-BEFORE-20260916"))
                .isInstanceOfSatisfying(BookwaveException.class, error -> {
                    assertThat(error.status()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(error.errorCode()).isEqualTo("INVALID_SIMULATION_RUN_ID");
                });
    }

    @Test
    void enabledModeAcceptsSyntheticIncidentRunId() {
        IncidentSimulationGuard guard = new IncidentSimulationGuard(new IncidentSimulationProperties(true));

        guard.requireEnabled("INCIDENT-SIM-20260916T000000Z");
    }
}
