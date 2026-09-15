package com.bookwave.lab.mockpg.service;

import com.bookwave.lab.mockpg.api.AuthorizationResult;
import com.bookwave.lab.mockpg.api.PaymentRequest;
import com.bookwave.lab.mockpg.api.PaymentResult;
import org.springframework.stereotype.Component;

/**
 * 카드 승인 응답을 북웨이브 결제 응답으로 바꾸는 경계 매퍼다.
 *
 * 카드사 API가 바뀌더라도 CardAuthorizationGateway가
 * AuthorizationResult로 변환하면 북웨이브의 외부 계약은 유지된다.
 */
@Component
public class PaymentResultMapper {

    public PaymentResult toPaymentResult(PaymentRequest request,
                                         AuthorizationResult authorization,
                                         String paymentId,
                                         String pgTid) {
        return new PaymentResult(
                request.correlationId(),
                request.orderNo(),
                paymentId,
                pgTid,
                authorization.decision(),
                authorization.approvedAmount(),
                authorization.authorizationNo(),
                authorization.reasonCode());
    }
}
