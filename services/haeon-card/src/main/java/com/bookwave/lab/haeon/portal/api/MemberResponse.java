package com.bookwave.lab.haeon.portal.api;

import java.time.Instant;

public record MemberResponse(
        String memberNo,
        String displayName,
        Instant joinedAt,
        int cardCount
) {
}
