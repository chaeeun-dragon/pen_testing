package com.bookwave.lab.mockpg.service;

import com.bookwave.lab.mockpg.api.AuthorizationRequest;
import com.bookwave.lab.mockpg.api.PaymentRequest;
import com.bookwave.lab.mockpg.config.MockPgProperties;
import java.time.Instant;
import org.springframework.stereotype.Component;

/**
 * 북웨이브 결제 요청을 해온카드 승인 요청으로 변환하는 경계 어댑터다.
 *
 * 팀장님 카드 API를 연결할 때는 이 매퍼를 새 DTO 매퍼로 교체하고,
 * 북웨이브의 외부 요청 형식과 멱등·추적 규칙은 유지한다.
 */
@Component
public class CardAuthorizationMapper {

    public AuthorizationRequest toCardAuthorization(PaymentRequest request,
                                                     MockPgProperties properties,
                                                     String requestFingerprint,
                                                     Instant requestedAt) {
        return new AuthorizationRequest(
                request.correlationId(),
                properties.merchantNo(),
                request.merchantRequestId(),
                request.paymentMethodToken(),
                request.amount(),
                request.currency(),
                requestFingerprint,
                requestedAt);
    }
}
