package com.bookwave.lab.haeon.portal.api;

import java.util.List;

public record CardListResponse(
        MemberResponse member,
        List<CardResponse> cards,
        long totalLimitAmount,
        long totalUsedAmount,
        long totalRemainingAmount
) {
}
