package com.bookwave.lab.haeon.portal.api;

import java.util.List;

public record TransactionListResponse(
        MemberResponse member,
        List<TransactionResponse> transactions,
        int approvedCount,
        long approvedAmount,
        int declinedCount
) {
}
