package com.bookwave.lab.mockpg.service;

import com.bookwave.lab.mockpg.api.AuthorizationRequest;
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
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

@Service
public class MockPgService {
    private static final Logger log = LoggerFactory.getLogger(MockPgService.class);

    private final RestClient haeonCardClient;
    private final MockPgProperties properties;
    private final IdempotencyStore idempotencyStore;
    private final RequestFingerprint requestFingerprint;

    public MockPgService(RestClient haeonCardClient,
                         MockPgProperties properties,
                         IdempotencyStore idempotencyStore,
                         RequestFingerprint requestFingerprint) {
        this.haeonCardClient = haeonCardClient;
        this.properties = properties;
        this.idempotencyStore = idempotencyStore;
        this.requestFingerprint = requestFingerprint;
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
        PaymentResult result = new PaymentResult(
                request.correlationId(),
                request.orderNo(),
                paymentId,
                pgTid,
                authorization.decision(),
                authorization.approvedAmount(),
                authorization.authorizationNo(),
                authorization.reasonCode());
        idempotencyStore.put(request.merchantRequestId(), new IdempotencyStore.StoredPayment(fingerprint, result));
        log.info("event=pg_charge_completed orderNo={} merchantRequestId={} pgTid={} decision={} amount={} synthetic=true",
                request.orderNo(), request.merchantRequestId(), pgTid, result.decision(), result.approvedAmount());
        return result;
    }

    private AuthorizationResult requestAuthorization(PaymentRequest request, String fingerprint) {
        AuthorizationRequest payload = new AuthorizationRequest(
                request.correlationId(),
                properties.merchantNo(),
                request.merchantRequestId(),
                request.paymentMethodToken(),
                request.amount(),
                request.currency(),
                fingerprint,
                Instant.now());
        try {
            log.info("event=authorization_forward merchantNo={} merchantRequestId={} amount={} synthetic=true",
                    properties.merchantNo(), request.merchantRequestId(), request.amount());
            return haeonCardClient.post()
                    .uri("/internal/v1/authorizations")
                    .header("X-Correlation-Id", request.correlationId())
                    .header("Idempotency-Key", request.merchantRequestId())
                    .header("Authorization", "Bearer " + properties.merchantToken())
                    .body(payload)
                    .retrieve()
                    .body(AuthorizationResult.class);
        } catch (ResourceAccessException ex) {
            throw new MockPgException(HttpStatus.SERVICE_UNAVAILABLE, "UPSTREAM_UNAVAILABLE",
                    "해온카드 서비스에 연결할 수 없습니다.", true);
        } catch (RestClientResponseException ex) {
            if (ex.getStatusCode().is4xxClientError()) {
                throw new MockPgException(HttpStatus.BAD_GATEWAY, "UPSTREAM_ERROR",
                        "해온카드가 요청을 거절했습니다.", false);
            }
            throw new MockPgException(HttpStatus.BAD_GATEWAY, "UPSTREAM_ERROR",
                    "해온카드 응답을 처리할 수 없습니다.", true);
        }
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
