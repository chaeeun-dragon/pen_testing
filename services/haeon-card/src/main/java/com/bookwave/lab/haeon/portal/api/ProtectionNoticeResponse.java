package com.bookwave.lab.haeon.portal.api;

import java.time.Instant;

public record ProtectionNoticeResponse(long noticeId, String runId, String noticeType,
                                       String message, Instant createdAt, Instant acknowledgedAt,
                                       boolean acknowledged) {
}
