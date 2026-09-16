package com.bookwave.lab.bookwave.api;

/**
 * A fixed, synthetic observation emitted by the dedicated lab simulation route.
 * It never represents a command, payload, customer record, or payment instruction.
 */
public record IncidentSimulationEvent(
        String stage,
        String event,
        String result
) {
}
