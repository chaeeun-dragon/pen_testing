package com.bookwave.lab.haeon.portal.service;

import com.bookwave.lab.haeon.config.PortalProperties;
import com.bookwave.lab.haeon.error.HaeonCardException;
import com.bookwave.lab.haeon.portal.api.CardListResponse;
import com.bookwave.lab.haeon.portal.api.CardResponse;
import com.bookwave.lab.haeon.portal.api.LoginRequest;
import com.bookwave.lab.haeon.portal.api.LoginResponse;
import com.bookwave.lab.haeon.portal.api.MemberResponse;
import com.bookwave.lab.haeon.portal.api.TransactionListResponse;
import com.bookwave.lab.haeon.portal.api.TransactionResponse;
import com.bookwave.lab.haeon.portal.api.ProtectionNoticeListResponse;
import com.bookwave.lab.haeon.portal.api.ProtectionNoticeResponse;
import com.bookwave.lab.haeon.portal.repository.MemberRepository;
import com.bookwave.lab.haeon.portal.repository.MemberRepository.Member;
import com.bookwave.lab.haeon.portal.repository.MemberRepository.MemberCredential;
import com.bookwave.lab.haeon.portal.repository.MemberSessionRepository;
import com.bookwave.lab.haeon.portal.repository.PortalQueryRepository;
import com.bookwave.lab.haeon.portal.repository.PortalQueryRepository.MemberCard;
import com.bookwave.lab.haeon.portal.repository.PortalQueryRepository.MemberTransaction;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 해온카드 회원 포털 조회 서비스다.
 *
 * <p>조회 대상 회원은 항상 세션 토큰에서 나온다. 요청 본문이나 질의 문자열로 회원·카드를
 * 지정할 수 없으므로, 로그인한 회원에 연결된 카드와 그 카드의 승인 내역만 응답한다.
 */
@Service
public class PortalService {
    private static final Logger log = LoggerFactory.getLogger(PortalService.class);
    private static final String BEARER_PREFIX = "Bearer ";

    private final MemberRepository memberRepository;
    private final MemberSessionRepository sessionRepository;
    private final PortalQueryRepository queryRepository;
    private final PasswordHasher passwordHasher;
    private final PortalProperties properties;
    private final SecureRandom random = new SecureRandom();

    public PortalService(MemberRepository memberRepository,
                         MemberSessionRepository sessionRepository,
                         PortalQueryRepository queryRepository,
                         PasswordHasher passwordHasher,
                         PortalProperties properties) {
        this.memberRepository = memberRepository;
        this.sessionRepository = sessionRepository;
        this.queryRepository = queryRepository;
        this.passwordHasher = passwordHasher;
        this.properties = properties;
    }

    @Transactional
    public LoginResponse login(LoginRequest request) {
        MemberCredential credential = memberRepository.findCredentialByLoginId(request.loginId())
                .orElse(null);
        if (credential == null
                || !passwordHasher.matches(credential.passwordSalt(), credential.passwordHash(),
                        request.password())) {
            // 존재하지 않는 아이디와 틀린 비밀번호를 같은 응답으로 돌려 계정 존재 여부를 흘리지 않는다.
            log.info("event=portal_login_failed loginId={}", request.loginId());
            throw new HaeonCardException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS",
                    "아이디 또는 비밀번호가 올바르지 않습니다.", "portal", false);
        }

        Instant now = Instant.now();
        sessionRepository.deleteExpiredBefore(now.minus(Duration.ofDays(1)));
        Instant expiresAt = now.plus(Duration.ofMinutes(Math.max(1, properties.sessionTtlMinutes())));
        String token = newToken();
        sessionRepository.insert(passwordHasher.hashToken(token), credential.member().memberId(), now, expiresAt);
        log.info("event=portal_login memberNo={}", credential.member().memberNo());
        return new LoginResponse(token, expiresAt, memberResponse(credential.member()));
    }

    @Transactional
    public void logout(String authorizationHeader) {
        String token = bearerToken(authorizationHeader);
        if (token != null) {
            sessionRepository.revoke(passwordHasher.hashToken(token), Instant.now());
        }
    }

    public Member requireMember(String authorizationHeader) {
        String token = bearerToken(authorizationHeader);
        if (token == null) {
            throw unauthenticated("로그인이 필요합니다.");
        }
        Long memberId = sessionRepository
                .findMemberIdByActiveToken(passwordHasher.hashToken(token), Instant.now())
                .orElseThrow(() -> unauthenticated("로그인 세션이 만료되었습니다. 다시 로그인해 주세요."));
        return memberRepository.findById(memberId)
                .orElseThrow(() -> unauthenticated("회원 정보를 찾을 수 없습니다."));
    }

    public MemberResponse me(Member member) {
        return memberResponse(member);
    }

    public CardListResponse cards(Member member) {
        List<MemberCard> cards = queryRepository.findCardsByMember(member.memberId());
        List<CardResponse> body = cards.stream().map(this::toCardResponse).toList();
        long totalLimit = body.stream().mapToLong(CardResponse::limitAmount).sum();
        long totalUsed = body.stream().mapToLong(CardResponse::usedAmount).sum();
        return new CardListResponse(memberResponse(member, cards.size()), body,
                totalLimit, totalUsed, totalLimit - totalUsed);
    }

    public TransactionListResponse transactions(Member member, Integer requestedLimit) {
        int limit = resolveLimit(requestedLimit);
        List<MemberTransaction> rows = queryRepository.findTransactionsByMember(member.memberId(), limit);
        List<TransactionResponse> body = rows.stream().map(this::toTransactionResponse).toList();
        int approvedCount = (int) body.stream().filter(t -> "APPROVED".equals(t.status())).count();
        long approvedAmount = body.stream()
                .filter(t -> "APPROVED".equals(t.status()))
                .mapToLong(TransactionResponse::amount)
                .sum();
        return new TransactionListResponse(memberResponse(member), body,
                approvedCount, approvedAmount, body.size() - approvedCount);
    }

    /** 가상 침해 대응에서 생성한 본인 대상 보호 안내만 조회한다. */
    public ProtectionNoticeListResponse protectionNotices(Member member) {
        List<Map<String, Object>> rows = queryRepository.jdbc().queryForList(
                "SELECT notice_id, run_id, notice_type, message, created_at, acknowledged_at "
                        + "FROM lab_protection_notices WHERE member_no = ? ORDER BY created_at DESC",
                member.memberNo());
        List<ProtectionNoticeResponse> notices = rows.stream().map(row -> {
            Instant created = toInstant(row.get("created_at"));
            Instant acknowledged = toInstant(row.get("acknowledged_at"));
            return new ProtectionNoticeResponse(
                    ((Number) row.get("notice_id")).longValue(),
                    (String) row.get("run_id"), (String) row.get("notice_type"),
                    (String) row.get("message"), created, acknowledged, acknowledged != null);
        }).toList();
        return new ProtectionNoticeListResponse(notices);
    }

    @Transactional
    public ProtectionNoticeResponse acknowledgeProtectionNotice(Member member, long noticeId) {
        int changed = queryRepository.jdbc().update(
                "UPDATE lab_protection_notices SET acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP(6)) "
                        + "WHERE notice_id = ? AND member_no = ?", noticeId, member.memberNo());
        if (changed == 0) {
            throw new HaeonCardException(HttpStatus.NOT_FOUND, "NOTICE_NOT_FOUND",
                    "본인에게 발급된 보호 안내를 찾을 수 없습니다.", "portal", false);
        }
        Map<String, Object> row = queryRepository.jdbc().queryForMap(
                "SELECT notice_id, run_id, notice_type, message, created_at, acknowledged_at "
                        + "FROM lab_protection_notices WHERE notice_id = ? AND member_no = ?", noticeId, member.memberNo());
        Instant created = toInstant(row.get("created_at"));
        Instant acknowledged = toInstant(row.get("acknowledged_at"));
        return new ProtectionNoticeResponse(((Number) row.get("notice_id")).longValue(),
                (String) row.get("run_id"), (String) row.get("notice_type"), (String) row.get("message"),
                created, acknowledged, true);
    }

    private Instant toInstant(Object value) {
        if (value == null) return null;
        if (value instanceof java.sql.Timestamp timestamp) return timestamp.toInstant();
        if (value instanceof java.time.LocalDateTime local) return local.toInstant(java.time.ZoneOffset.UTC);
        if (value instanceof Instant instant) return instant;
        return Instant.parse(value.toString().replace(' ', 'T') + (value.toString().contains("Z") ? "" : "Z"));
    }

    private int resolveLimit(Integer requestedLimit) {
        if (requestedLimit == null) {
            return properties.transactionPageSize();
        }
        if (requestedLimit < 1) {
            throw new HaeonCardException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "조회 건수는 1 이상이어야 합니다.", "portal", false);
        }
        return Math.min(requestedLimit, properties.transactionMaxPageSize());
    }

    private CardResponse toCardResponse(MemberCard card) {
        long limit = amount(card.limitAmount());
        long used = amount(card.usedAmount());
        return new CardResponse(
                "**** **** **** " + card.cardLast4(),
                card.cardName(), card.brand(), card.cardType(), card.paymentDay(),
                card.benefitSummary(), card.primary(), card.status(),
                limit, used, Math.max(0, limit - used));
    }

    private TransactionResponse toTransactionResponse(MemberTransaction row) {
        return new TransactionResponse(
                row.authorizationNo(), row.occurredAt(), row.merchantName(), row.cardName(),
                "**** " + row.cardLast4(), amount(row.amount()), row.status(), row.decisionCode());
    }

    private MemberResponse memberResponse(Member member) {
        return memberResponse(member, queryRepository.countCardsByMember(member.memberId()));
    }

    private MemberResponse memberResponse(Member member, int cardCount) {
        return new MemberResponse(member.memberNo(), member.displayName(), member.joinedAt(), cardCount);
    }

    private long amount(BigDecimal value) {
        return value == null ? 0L : value.setScale(0, RoundingMode.DOWN).longValueExact();
    }

    private HaeonCardException unauthenticated(String message) {
        return new HaeonCardException(HttpStatus.UNAUTHORIZED, "SESSION_REQUIRED", message, "portal", false);
    }

    private String bearerToken(String authorizationHeader) {
        if (authorizationHeader == null || !authorizationHeader.startsWith(BEARER_PREFIX)) {
            return null;
        }
        String token = authorizationHeader.substring(BEARER_PREFIX.length()).trim();
        return token.isEmpty() ? null : token;
    }

    private String newToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
