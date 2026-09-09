package com.bookwave.lab.bookwave.service;

import com.bookwave.lab.bookwave.api.OrderStatus;
import com.bookwave.lab.bookwave.api.Decision;
import com.bookwave.lab.bookwave.api.PaymentRequest;
import com.bookwave.lab.bookwave.api.PaymentResult;
import com.bookwave.lab.bookwave.error.BookwaveException;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class PaymentService {
    private static final Logger log = LoggerFactory.getLogger(PaymentService.class);

    private final MockPgClient mockPgClient;
    private final PaymentStore paymentStore;
    private final RequestFingerprint requestFingerprint;

    public PaymentService(MockPgClient mockPgClient,
                          PaymentStore paymentStore,
                          RequestFingerprint requestFingerprint) {
        this.mockPgClient = mockPgClient;
        this.paymentStore = paymentStore;
        this.requestFingerprint = requestFingerprint;
    }

    public PaymentResult pay(PaymentRequest request, String correlationHeader, String idempotencyKey) {
        validateHeaders(request, correlationHeader, idempotencyKey);
        String fingerprint = requestFingerprint.of(request);

        var previous = paymentStore.findPayment(request.merchantRequestId());
        if (previous.isPresent()) {
            if (!previous.get().requestFingerprint().equals(fingerprint)) {
                throw new BookwaveException(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT",
                        "같은 요청 키에 다른 주문 또는 금액이 사용되었습니다.", false);
            }
            log.info("event=payment_idempotent_replay orderNo={} merchantRequestId={} pgTid={}",
                    request.orderNo(), request.merchantRequestId(), previous.get().result().pgTid());
            return previous.get().result();
        }

        paymentStore.markOrder(request.orderNo(), OrderStatus.PAYMENT_PENDING);
        log.info("event=payment_requested orderNo={} merchantRequestId={} amount={} synthetic=true",
                request.orderNo(), request.merchantRequestId(), request.amount());

        PaymentResult result;
        try {
            result = mockPgClient.charge(request);
        } catch (BookwaveException ex) {
            paymentStore.markOrder(request.orderNo(), OrderStatus.PAYMENT_UNKNOWN);
            throw ex;
        }

        if (result.decision() == Decision.APPROVED) {
            paymentStore.markOrder(request.orderNo(), OrderStatus.PAID);
        } else if (result.decision() == Decision.DECLINED) {
            paymentStore.markOrder(request.orderNo(), OrderStatus.PAYMENT_DECLINED);
        }
        paymentStore.putPayment(request.merchantRequestId(), new PaymentStore.StoredPayment(fingerprint, result));
        log.info("event=payment_completed orderNo={} paymentId={} pgTid={} decision={} amount={} synthetic=true",
                result.orderNo(), result.paymentId(), result.pgTid(), result.decision(), result.approvedAmount());
        return result;
    }

    private void validateHeaders(PaymentRequest request, String correlationHeader, String idempotencyKey) {
        if (correlationHeader == null || !Objects.equals(request.correlationId(), correlationHeader)) {
            throw new BookwaveException(HttpStatus.BAD_REQUEST, "INVALID_CORRELATION_ID",
                    "헤더와 본문의 correlationId가 다릅니다.", false);
        }
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new BookwaveException(HttpStatus.BAD_REQUEST, "MISSING_IDEMPOTENCY_KEY",
                    "Idempotency-Key가 필요합니다.", false);
        }
        if (!Objects.equals(request.merchantRequestId(), idempotencyKey)) {
            throw new BookwaveException(HttpStatus.BAD_REQUEST, "INVALID_IDEMPOTENCY_KEY",
                    "Idempotency-Key와 merchantRequestId가 다릅니다.", false);
        }
    }
}
