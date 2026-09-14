package com.bookwave.lab.mockpg.service;

import com.bookwave.lab.mockpg.api.AuthorizationRequest;
import com.bookwave.lab.mockpg.api.AuthorizationResult;
import com.bookwave.lab.mockpg.config.MockPgProperties;
import com.bookwave.lab.mockpg.error.MockPgException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/** 현재 로컬 합성 Haeon 카드 API용 게이트웨이 구현. */
@Component
public class HaeonCardAuthorizationClient implements CardAuthorizationGateway {
    private static final Logger log = LoggerFactory.getLogger(HaeonCardAuthorizationClient.class);

    private final RestClient haeonCardClient;
    private final MockPgProperties properties;

    public HaeonCardAuthorizationClient(RestClient haeonCardRestClient,
                                        MockPgProperties properties) {
        this.haeonCardClient = haeonCardRestClient;
        this.properties = properties;
    }

    @Override
    public AuthorizationResult authorize(AuthorizationRequest request) {
        try {
            log.info("event=authorization_forward merchantNo={} merchantRequestId={} amount={} synthetic=true",
                    request.merchantNo(), request.merchantRequestId(), request.amount());
            return haeonCardClient.post()
                    .uri("/internal/v1/authorizations")
                    .header("X-Correlation-Id", request.correlationId())
                    .header("Idempotency-Key", request.merchantRequestId())
                    .header("Authorization", "Bearer " + properties.merchantToken())
                    .body(request)
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
}
