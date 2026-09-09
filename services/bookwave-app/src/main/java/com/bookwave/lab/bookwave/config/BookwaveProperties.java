package com.bookwave.lab.bookwave.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "bookwave")
public record BookwaveProperties(
        String mockPgBaseUrl,
        long connectTimeoutMs,
        long readTimeoutMs,
        String labProfile
) {
}
