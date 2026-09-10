package com.bookwave.lab.haeon.service;

import com.bookwave.lab.haeon.api.AuthorizationRequest;
import com.bookwave.lab.haeon.api.AuthorizationResponse;
import com.bookwave.lab.haeon.api.Decision;
import com.bookwave.lab.haeon.config.HaeonCardProperties;
import com.bookwave.lab.haeon.error.HaeonCardException;
import com.bookwave.lab.haeon.lab.BeforeBarrier;
import com.bookwave.lab.haeon.repository.AuthorizationRepository;
import com.bookwave.lab.haeon.repository.AuthorizationRepository.ExistingAuthorization;
import com.bookwave.lab.haeon.repository.CardLimitRepository;
import com.bookwave.lab.haeon.repository.CardLimitRepository.CardLimit;
import com.bookwave.lab.haeon.repository.CardRepository;
import com.bookwave.lab.haeon.repository.CardRepository.Card;
import com.bookwave.lab.haeon.repository.MerchantRepository;
import com.bookwave.lab.haeon.repository.MerchantRepository.Merchant;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ApprovalService {
    private static final Logger log = LoggerFactory.getLogger(ApprovalService.class);

    private final MerchantRepository merchantRepository;
    private final CardRepository cardRepository;
    private final CardLimitRepository cardLimitRepository;
    private final AuthorizationRepository authorizationRepository;
    private final HaeonCardProperties properties;
    private final BeforeBarrier beforeBarrier;

    public ApprovalService(MerchantRepository merchantRepository,
                           CardRepository cardRepository,
                           CardLimitRepository cardLimitRepository,
                           AuthorizationRepository authorizationRepository,
                           HaeonCardProperties properties,
                           BeforeBarrier beforeBarrier) {
        this.merchantRepository = merchantRepository;
        this.cardRepository = cardRepository;
        this.cardLimitRepository = cardLimitRepository;
        this.authorizationRepository = authorizationRepository;
        this.properties = properties;
        this.beforeBarrier = beforeBarrier;
    }

    @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 10, rollbackFor = Exception.class)
    public AuthorizationResponse authorize(AuthorizationRequest request, String correlationHeader,
                                            String idempotencyKey, String authorizationHeader) {
        validateHeaders(request, correlationHeader, idempotencyKey);
        validateCurrency(request, correlationHeader);
        String merchantNo = resolveMerchantNo(request, authorizationHeader, correlationHeader);
        log.info("event=auth_received merchantRequestId={} amount={} synthetic=true",
                request.merchantRequestId(), request.amount());

        Merchant merchant = merchantRepository.findActiveByMerchantNo(merchantNo)
                .orElseThrow(() -> error(HttpStatus.FORBIDDEN, "MERCHANT_NOT_ALLOWED",
                        "허용된 합성 가맹점이 아닙니다.", correlationHeader, false));

        ExistingAuthorization existing = authorizationRepository
                .findExisting(merchant.merchantId(), request.merchantRequestId())
                .orElse(null);
        if (existing != null) {
            if (!Objects.equals(existing.requestFingerprint(), request.requestFingerprint())) {
                throw error(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT",
                        "같은 요청 키에 다른 결제 내용이 사용되었습니다.", correlationHeader, false);
            }
            if (!"APPROVED".equals(existing.status()) && !"DECLINED".equals(existing.status())) {
                throw error(HttpStatus.CONFLICT, "DUPLICATE_REQUEST",
                        "같은 요청이 아직 확정되지 않았습니다.", correlationHeader, true);
            }
            return replay(existing, request.correlationId());
        }

        Card card = cardRepository.findByToken(request.cardToken())
                .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "CARD_NOT_FOUND",
                        "합성 카드 토큰을 찾을 수 없습니다.", correlationHeader, false));
        BigDecimal amount = BigDecimal.valueOf(request.amount());
        String authNo = "AUTH-HC-" + shortId();
        String txAttemptId = UUID.randomUUID().toString();
        long authId;
        try {
            authId = authorizationRepository.insertRequested(
                    merchant.merchantId(), card.cardId(), request.merchantRequestId(),
                    request.requestFingerprint(), amount, request.currency(), request.correlationId(),
                    request.requestedAt(), properties.instanceId(), txAttemptId, authNo);
        } catch (DuplicateKeyException ex) {
            // 두 요청이 동시에 같은 멱등키를 처음 보낸 경우, DB의 UNIQUE 키를 최종 조정자로 사용한다.
            ExistingAuthorization raced = authorizationRepository
                    .findExisting(merchant.merchantId(), request.merchantRequestId())
                    .orElseThrow(() -> error(HttpStatus.INTERNAL_SERVER_ERROR,
                            "IDEMPOTENCY_LOOKUP_FAILED", "중복 요청의 기존 결과를 찾지 못했습니다.",
                            correlationHeader, true));
            if (!Objects.equals(raced.requestFingerprint(), request.requestFingerprint())) {
                throw error(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT",
                        "같은 요청 키에 다른 결제 내용이 사용되었습니다.", correlationHeader, false);
            }
            if ("APPROVED".equals(raced.status()) || "DECLINED".equals(raced.status())) {
                return replay(raced, request.correlationId());
            }
            throw error(HttpStatus.CONFLICT, "DUPLICATE_REQUEST",
                    "같은 요청이 아직 확정되지 않았습니다.", correlationHeader, true);
        }

        boolean before = beforeBarrier.enabled();
        long lockStarted = System.nanoTime();
        CardLimit cardLimit = (before
                ? cardLimitRepository.findSnapshot(card.cardId())
                : cardLimitRepository.findForUpdate(card.cardId()))
                .orElseThrow(() -> error(HttpStatus.INTERNAL_SERVER_ERROR, "CARD_LIMIT_NOT_FOUND",
                        "카드 한도 행을 찾을 수 없습니다.", correlationHeader, false));
        Long lockElapsedMs = before ? null : Math.max(0, (System.nanoTime() - lockStarted) / 1_000_000);
        Instant lockAcquiredAt = before ? null : Instant.now();
        BigDecimal remaining = cardLimit.limitAmount().subtract(cardLimit.usedAmount());
        log.info("event=limit_read cardId={} readUsedAmount={} readLimitVersion={} mode={}",
                card.cardId(), cardLimit.usedAmount(), cardLimit.version(), readMode(before));

        Decision decision;
        String reasonCode;
        boolean approved = "NORMAL".equals(card.status()) && amount.compareTo(remaining) <= 0;
        if (before) {
            try {
                beforeBarrier.awaitAfterRead();
                log.info("event=before_barrier_released cardId={} merchantRequestId={}",
                        card.cardId(), request.merchantRequestId());
            } catch (IllegalStateException ex) {
                throw error(HttpStatus.SERVICE_UNAVAILABLE, "BEFORE_BARRIER_TIMEOUT",
                        "Before 재현 장벽의 짝 요청이 제한 시간 안에 도착하지 않았습니다.",
                        correlationHeader, true);
            }
        }
        if (approved) {
            decision = Decision.APPROVED;
            reasonCode = "APPROVED";
            if (cardLimitRepository.increaseUsedAmount(card.cardId(), amount) != 1) {
                throw error(HttpStatus.INTERNAL_SERVER_ERROR, "LIMIT_UPDATE_FAILED",
                        "카드 한도를 갱신하지 못했습니다.", correlationHeader, true);
            }
        } else {
            decision = Decision.DECLINED;
            reasonCode = "NORMAL".equals(card.status()) ? "LIMIT_EXCEEDED" : "CARD_BLOCKED";
        }

        Instant decidedAt = Instant.now();
        if (authorizationRepository.finalizeDecision(
                authId, cardLimit.version(), cardLimit.usedAmount(), card.statusVersion(),
                lockElapsedMs, lockAcquiredAt, decision == Decision.APPROVED ? "APPROVED" : "DECLINED",
                reasonCode, decidedAt) != 1) {
            throw error(HttpStatus.INTERNAL_SERVER_ERROR, "AUTHORIZATION_UPDATE_FAILED",
                    "승인 요청 상태를 확정하지 못했습니다.", correlationHeader, true);
        }

        if (approved && authorizationRepository.insertTransaction(authId, amount, decidedAt) != 1) {
            throw error(HttpStatus.INTERNAL_SERVER_ERROR, "TRANSACTION_INSERT_FAILED",
                    "승인 거래를 기록하지 못했습니다.", correlationHeader, true);
        }

        String detailsJson = detailsJson(cardLimit, lockElapsedMs);
        if (authorizationRepository.insertAudit(
                authId, merchant.merchantId(), decision.name(), approved ? 1 : 0,
                request.merchantRequestId(), request.correlationId(), request.requestFingerprint(),
                detailsJson, decidedAt) != 1) {
            throw error(HttpStatus.INTERNAL_SERVER_ERROR, "AUDIT_INSERT_FAILED",
                    "승인 감사 기록을 저장하지 못했습니다.", correlationHeader, true);
        }

        log.info("event=auth_committed authId={} merchantRequestId={} decision={} amount={} synthetic=true",
                authId, request.merchantRequestId(), decision, approved ? request.amount() : 0);

        long remainingLimit = remaining.subtract(approved ? amount : BigDecimal.ZERO).longValueExact();
        return new AuthorizationResponse(request.correlationId(), authId, authNo, decision,
                approved ? request.amount() : 0, remainingLimit, reasonCode);
    }

    private AuthorizationResponse replay(ExistingAuthorization existing, String correlationId) {
        Decision decision = "APPROVED".equals(existing.decisionCode())
                ? Decision.APPROVED : Decision.DECLINED;
        long approvedAmount = decision == Decision.APPROVED ? existing.amount().longValueExact() : 0;
        return new AuthorizationResponse(correlationId, existing.authId(), existing.authorizationNo(),
                decision, approvedAmount, null, existing.decisionCode());
    }

    private String resolveMerchantNo(AuthorizationRequest request, String authorizationHeader,
                                     String correlationId) {
        if (authorizationHeader == null || authorizationHeader.isBlank()) {
            return request.merchantNo();
        }
        String expected = "Bearer " + properties.merchantToken();
        if (!Objects.equals(expected, authorizationHeader)) {
            throw error(HttpStatus.FORBIDDEN, "MERCHANT_NOT_ALLOWED",
                    "합성 가맹점 인증이 올바르지 않습니다.", correlationId, false);
        }
        return properties.merchantNo();
    }

    private void validateHeaders(AuthorizationRequest request, String correlationHeader,
                                 String idempotencyKey) {
        if (!Objects.equals(request.correlationId(), correlationHeader)) {
            throw error(HttpStatus.BAD_REQUEST, "INVALID_CORRELATION_ID",
                    "헤더와 본문의 correlationId가 다릅니다.", correlationHeader, false);
        }
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw error(HttpStatus.BAD_REQUEST, "MISSING_IDEMPOTENCY_KEY",
                    "Idempotency-Key가 필요합니다.", correlationHeader, false);
        }
        if (!Objects.equals(request.merchantRequestId(), idempotencyKey)) {
            throw error(HttpStatus.BAD_REQUEST, "INVALID_IDEMPOTENCY_KEY",
                    "Idempotency-Key와 merchantRequestId가 다릅니다.", correlationHeader, false);
        }
    }

    private void validateCurrency(AuthorizationRequest request, String correlationId) {
        if (!"KRW".equals(request.currency())) {
            throw error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "현재 실습은 KRW만 지원합니다.", correlationId, false);
        }
    }

    private String detailsJson(CardLimit cardLimit, Long lockElapsedMs) {
        String profile = properties.labProfile() == null ? "normal" : properties.labProfile();
        String instanceId = properties.instanceId() == null ? "haeon-card-1" : properties.instanceId();
        return String.format(Locale.ROOT,
                "{\"profile\":\"%s\",\"instanceId\":\"%s\",\"readUsedAmount\":%s,"
                        + "\"readLimitVersion\":%d,\"lockQueryElapsedMs\":%s}",
                jsonSafe(profile), jsonSafe(instanceId), cardLimit.usedAmount(),
                cardLimit.version(), lockElapsedMs == null ? "null" : lockElapsedMs);
    }

    private String readMode(boolean before) {
        if (before) {
            return "before";
        }
        return "after".equalsIgnoreCase(properties.labProfile()) ? "after" : "normal";
    }

    private HaeonCardException error(HttpStatus status, String code, String message,
                                     String correlationId, boolean retryable) {
        return new HaeonCardException(status, code, message, correlationId, retryable);
    }

    private String shortId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 16);
    }

    private String jsonSafe(String value) {
        return value.replace("\\", "_").replace("\"", "'");
    }
}
