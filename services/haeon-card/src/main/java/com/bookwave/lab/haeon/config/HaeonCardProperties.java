package com.bookwave.lab.haeon.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "haeon-card")
public record HaeonCardProperties(
        String instanceId,
        String merchantNo,
        String merchantToken
) {
}
