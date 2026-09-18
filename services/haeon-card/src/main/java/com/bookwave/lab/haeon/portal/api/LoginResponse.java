package com.bookwave.lab.haeon.portal.api;

import java.time.Instant;

public record LoginResponse(
        String sessionToken,
        Instant expiresAt,
        MemberResponse member
) {
}
