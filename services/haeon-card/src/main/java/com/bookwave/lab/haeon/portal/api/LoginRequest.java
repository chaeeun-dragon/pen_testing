package com.bookwave.lab.haeon.portal.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record LoginRequest(
        @NotBlank @Size(max = 40) @Pattern(regexp = "[A-Za-z0-9_.-]{1,40}") String loginId,
        @NotBlank @Size(max = 100) String password
) {
}
