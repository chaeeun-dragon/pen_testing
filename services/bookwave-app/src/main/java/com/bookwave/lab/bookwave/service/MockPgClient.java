package com.bookwave.lab.bookwave.service;

import com.bookwave.lab.bookwave.api.PaymentRequest;
import com.bookwave.lab.bookwave.api.PaymentResult;
import com.bookwave.lab.bookwave.error.BookwaveException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

@Component
public class MockPgClient {
    private final RestClient restClient;

    public MockPgClient(RestClient mockPgRestClient) {
        this.restClient = mockPgRestClient;
    }

    public PaymentResult charge(PaymentRequest request) {
        try {
            PaymentResult result = restClient.post()
                    .uri("/internal/v1/pg/charges")
                    .header("X-Correlation-Id", request.correlationId())
                    .header("Idempotency-Key", request.merchantRequestId())
                    .body(request)
                    .retrieve()
                    .body(PaymentResult.class);
            if (result == null) {
                throw new BookwaveException(HttpStatus.BAD_GATEWAY, "UPSTREAM_ERROR",
                        "Mock PG가 빈 응답을 반환했습니다.", true);
            }
            return result;
        } catch (ResourceAccessException ex) {
            throw new BookwaveException(HttpStatus.SERVICE_UNAVAILABLE, "UPSTREAM_UNAVAILABLE",
                    "Mock PG 서비스에 연결할 수 없습니다.", true);
        } catch (RestClientResponseException ex) {
            if (ex.getStatusCode().is4xxClientError()) {
                throw new BookwaveException(HttpStatus.BAD_GATEWAY, "UPSTREAM_ERROR",
                        "Mock PG가 결제 요청을 거절했습니다.", false);
            }
            throw new BookwaveException(HttpStatus.BAD_GATEWAY, "UPSTREAM_ERROR",
                    "Mock PG 응답을 처리할 수 없습니다.", true);
        }
    }
}
