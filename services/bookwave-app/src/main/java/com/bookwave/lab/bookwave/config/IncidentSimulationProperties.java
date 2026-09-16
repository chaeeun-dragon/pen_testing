package com.bookwave.lab.bookwave.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Opt-in only setting for the future, synthetic payment-server incident simulation.
 * This setting must never change the normal payment route by itself.
 */
@ConfigurationProperties(prefix = "bookwave.incident-simulation")
public record IncidentSimulationProperties(boolean enabled, String accessToken) {
}
