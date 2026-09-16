package com.bookwave.lab.bookwave.api;

import java.util.List;

/**
 * Explicitly labels the response as a synthetic lab result, never a payment or card decision.
 */
public record IncidentSimulationResponse(
        String scenarioId,
        String runId,
        String correlationId,
        boolean simulation,
        String outcome,
        boolean mockPgCalled,
        boolean haeonCardCalled,
        List<IncidentSimulationEvent> events
) {
}
