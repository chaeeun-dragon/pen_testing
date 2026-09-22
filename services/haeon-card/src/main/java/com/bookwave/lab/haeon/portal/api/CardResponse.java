package com.bookwave.lab.haeon.portal.api;

/**
 * 마이페이지 카드 한도 조회 응답이다.
 *
 * <p>{@code card_limits.version}은 내부 동시성 제어 값이므로 회원 응답에 넣지 않는다.
 */
public record CardResponse(
        String maskedNumber,
        String cardName,
        String brand,
        String cardType,
        int paymentDay,
        String benefitSummary,
        boolean primary,
        String status,
        long limitAmount,
        long usedAmount,
        long remainingAmount
) {
}
