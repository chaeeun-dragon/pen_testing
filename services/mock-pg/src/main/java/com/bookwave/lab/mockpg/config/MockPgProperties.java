package com.bookwave.lab.mockpg.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "mock-pg")
public record MockPgProperties(
        String haeonCardBaseUrl,
        String merchantNo,
        long connectTimeoutMs,
        long readTimeoutMs,
        String labProfile,
        boolean errorInjectionEnabled
) {
}
