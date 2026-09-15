package com.bookwave.lab.mockpg.service;

import com.bookwave.lab.mockpg.api.AuthorizationResult;
import com.bookwave.lab.mockpg.api.PaymentRequest;
import com.bookwave.lab.mockpg.api.PaymentResult;
import com.bookwave.lab.mockpg.config.MockPgProperties;
import com.bookwave.lab.mockpg.error.MockPgException;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class MockPgService {
    private static final Logger log = LoggerFactory.getLogger(MockPgService.class);

    private final MockPgProperties properties;
    private final IdempotencyStore idempotencyStore;
    private final RequestFingerprint requestFingerprint;
    private final CardAuthorizationMapper cardAuthorizationMapper;
    private final CardAuthorizationGateway cardAuthorizationGateway;
    private final PaymentResultMapper paymentResultMapper;

    public MockPgService(MockPgProperties properties,
                         IdempotencyStore idempotencyStore,
                         RequestFingerprint requestFingerprint,
                         CardAuthorizationMapper cardAuthorizationMapper,
                         CardAuthorizationGateway cardAuthorizationGateway,
                         PaymentResultMapper paymentResultMapper) {
        this.properties = properties;
        this.idempotencyStore = idempotencyStore;
        this.requestFingerprint = requestFingerprint;
        this.cardAuthorizationMapper = cardAuthorizationMapper;
        this.cardAuthorizationGateway = cardAuthorizationGateway;
        this.paymentResultMapper = paymentResultMapper;
    }

    public PaymentResult charge(PaymentRequest request, String correlationHeader, String idempotencyKey) {
        validateHeaders(request, correlationHeader, idempotencyKey);
        String fingerprint = requestFingerprint.of(request);

        var previous = idempotencyStore.find(request.merchantRequestId());
        if (previous.isPresent()) {
            if (!previous.get().requestFingerprint().equals(fingerprint)) {
                throw new MockPgException(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT",
                        "같은 요청 키에 다른 결제 내용이 사용되었습니다.", false);
            }
            log.info("event=idempotent_replay merchantRequestId={} pgTid={}",
                    request.merchantRequestId(), previous.get().result().pgTid());
            return previous.get().result();
        }

        String pgTid = "PG-LAB-" + shortId();
        String paymentId = "PAY-LAB-" + shortId();
        AuthorizationResult authorization = requestAuthorization(request, fingerprint);
        PaymentResult result = paymentResultMapper.toPaymentResult(
                request, authorization, paymentId, pgTid);
        idempotencyStore.put(request.merchantRequestId(), new IdempotencyStore.StoredPayment(fingerprint, result));
        log.info("event=pg_charge_completed orderNo={} merchantRequestId={} pgTid={} decision={} amount={} synthetic=true",
                request.orderNo(), request.merchantRequestId(), pgTid, result.decision(), result.approvedAmount());
        return result;
    }

    private AuthorizationResult requestAuthorization(PaymentRequest request, String fingerprint) {
        var payload = cardAuthorizationMapper.toCardAuthorization(
                request, properties, fingerprint, Instant.now());
        return cardAuthorizationGateway.authorize(payload);
    }

    private void validateHeaders(PaymentRequest request, String correlationHeader, String idempotencyKey) {
        if (correlationHeader == null || !request.correlationId().equals(correlationHeader)) {
            throw new MockPgException(HttpStatus.BAD_REQUEST, "INVALID_CORRELATION_ID",
                    "헤더와 본문의 correlationId가 다릅니다.", false);
        }
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new MockPgException(HttpStatus.BAD_REQUEST, "MISSING_IDEMPOTENCY_KEY",
                    "Idempotency-Key가 필요합니다.", false);
        }
        if (!request.merchantRequestId().equals(idempotencyKey)) {
            throw new MockPgException(HttpStatus.BAD_REQUEST, "INVALID_IDEMPOTENCY_KEY",
                    "Idempotency-Key와 merchantRequestId가 다릅니다.", false);
        }
    }

    private String shortId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }
}
