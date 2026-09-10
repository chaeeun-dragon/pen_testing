package com.bookwave.lab.haeon.api;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.Instant;

public record AuthorizationRequest(
        @NotBlank @Size(max = 80) @Pattern(regexp = "[A-Za-z0-9_-]{8,80}") String correlationId,
        @NotBlank @Size(max = 40) @Pattern(regexp = "[A-Za-z0-9_-]{1,40}") String merchantNo,
        @NotBlank @Size(max = 80) @Pattern(regexp = "[A-Za-z0-9_-]+") String merchantRequestId,
        @NotBlank @Size(max = 80) @Pattern(regexp = "card-token-lab-[A-Za-z0-9_-]+") String cardToken,
        @NotNull @Positive @Max(100000) Long amount,
        @NotBlank @Pattern(regexp = "[A-Z]{3}") String currency,
        @NotBlank @Pattern(regexp = "[0-9a-fA-F]{64}") String requestFingerprint,
        @NotNull Instant requestedAt
) {
}
