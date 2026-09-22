package com.bookwave.lab.haeon.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import com.bookwave.lab.haeon.api.AuthorizationRequest;
import com.bookwave.lab.haeon.config.HaeonCardProperties;
import com.bookwave.lab.haeon.error.HaeonCardException;
import com.bookwave.lab.haeon.repository.AuthorizationRepository;
import com.bookwave.lab.haeon.repository.CardLimitRepository;
import com.bookwave.lab.haeon.repository.CardRepository;
import com.bookwave.lab.haeon.repository.MerchantRepository;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class ApprovalServiceAuthenticationTest {

    @Test
    void rejectsMissingBearerInsteadOfTrustingBodyMerchantNo() {
        MerchantRepository merchantRepository = mock(MerchantRepository.class);
        HaeonCardProperties properties = new HaeonCardProperties(
                "haeon-card-test", "BOOKWAVE-LAB", "lab-merchant-bookwave");
        ApprovalService service = new ApprovalService(
                merchantRepository,
                mock(CardRepository.class),
                mock(CardLimitRepository.class),
                mock(AuthorizationRepository.class),
                properties);
        AuthorizationRequest request = new AuthorizationRequest(
                "corr-auth-0001", "ATTACKER-MERCHANT", "request-auth-0001", "card-token-lab-001",
                1_000L, "KRW", "0".repeat(64), Instant.parse("2026-09-15T00:00:00Z"));

        assertThatThrownBy(() -> service.authorize(
                request, request.correlationId(), request.merchantRequestId(), null))
                .isInstanceOfSatisfying(HaeonCardException.class, exception -> {
                    org.assertj.core.api.Assertions.assertThat(exception.status()).isEqualTo(HttpStatus.FORBIDDEN);
                    org.assertj.core.api.Assertions.assertThat(exception.errorCode()).isEqualTo("MERCHANT_NOT_ALLOWED");
                });
        verifyNoInteractions(merchantRepository);
    }

    @Test
    void usesConfiguredMerchantForAValidBearerNotTheBodyMerchantNo() {
        MerchantRepository merchantRepository = mock(MerchantRepository.class);
        HaeonCardProperties properties = new HaeonCardProperties(
                "haeon-card-test", "BOOKWAVE-LAB", "lab-merchant-bookwave");
        ApprovalService service = new ApprovalService(
                merchantRepository,
                mock(CardRepository.class),
                mock(CardLimitRepository.class),
                mock(AuthorizationRepository.class),
                properties);
        AuthorizationRequest request = new AuthorizationRequest(
                "corr-auth-0002", "ATTACKER-MERCHANT", "request-auth-0002", "card-token-lab-001",
                1_000L, "KRW", "1".repeat(64), Instant.parse("2026-09-15T00:00:00Z"));
        org.mockito.Mockito.when(merchantRepository.findActiveByMerchantNo("BOOKWAVE-LAB"))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.authorize(
                request, request.correlationId(), request.merchantRequestId(), "Bearer lab-merchant-bookwave"))
                .isInstanceOf(HaeonCardException.class);

        org.mockito.Mockito.verify(merchantRepository).findActiveByMerchantNo("BOOKWAVE-LAB");
        org.mockito.Mockito.verify(merchantRepository, org.mockito.Mockito.never())
                .findActiveByMerchantNo("ATTACKER-MERCHANT");
    }
}
