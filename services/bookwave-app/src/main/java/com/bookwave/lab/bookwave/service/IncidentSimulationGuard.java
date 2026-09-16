package com.bookwave.lab.bookwave.service;

import com.bookwave.lab.bookwave.config.IncidentSimulationProperties;
import com.bookwave.lab.bookwave.error.BookwaveException;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Guard for a later lab-only incident-simulation route.
 *
 * <p>It does not create events, invoke Mock PG, or invoke Haeon Card. A future
 * simulation entry point must call this guard before it can perform any lab action.</p>
 */
@Service
public class IncidentSimulationGuard {
    private static final Pattern RUN_ID = Pattern.compile("INCIDENT-SIM-[A-Za-z0-9_-]{8,80}");

    private final IncidentSimulationProperties properties;

    public IncidentSimulationGuard(IncidentSimulationProperties properties) {
        this.properties = properties;
    }

    public void requireEnabled(String runId) {
        if (!properties.enabled()) {
            throw new BookwaveException(HttpStatus.FORBIDDEN, "INCIDENT_SIMULATION_DISABLED",
                    "결제 서버 침입 징후 시뮬레이션은 기본적으로 비활성화되어 있습니다.", false);
        }
        if (runId == null || !RUN_ID.matcher(runId).matches()) {
            throw new BookwaveException(HttpStatus.BAD_REQUEST, "INVALID_SIMULATION_RUN_ID",
                    "실행 ID는 INCIDENT-SIM- 접두사의 합성 실습 ID여야 합니다.", false);
        }
    }
}
