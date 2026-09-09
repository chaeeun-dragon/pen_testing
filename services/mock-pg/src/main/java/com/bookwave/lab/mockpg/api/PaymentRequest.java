package com.bookwave.lab.mockpg.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;

public record PaymentRequest(
        @NotBlank
        @Pattern(regexp = "^[A-Za-z0-9_-]{8,80}$")
        String correlationId,

        @NotBlank
        @Pattern(regexp = "^[A-Za-z0-9_-]{1,80}$")
        String orderNo,

        @NotBlank
        @Pattern(regexp = "^[A-Za-z0-9_-]{1,80}$")
        String merchantRequestId,

        @Positive
        long amount,

        @NotBlank
        @Pattern(regexp = "^KRW$")
        String currency,

        @NotBlank
        @Pattern(regexp = "^card-token-lab-[A-Za-z0-9_-]+$")
        String paymentMethodToken
) {
}
