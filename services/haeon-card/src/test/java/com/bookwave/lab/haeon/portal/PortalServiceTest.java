package com.bookwave.lab.haeon.portal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.bookwave.lab.haeon.config.PortalProperties;
import com.bookwave.lab.haeon.error.HaeonCardException;
import com.bookwave.lab.haeon.portal.api.CardListResponse;
import com.bookwave.lab.haeon.portal.api.LoginRequest;
import com.bookwave.lab.haeon.portal.api.LoginResponse;
import com.bookwave.lab.haeon.portal.api.TransactionListResponse;
import com.bookwave.lab.haeon.portal.repository.MemberRepository;
import com.bookwave.lab.haeon.portal.repository.MemberRepository.Member;
import com.bookwave.lab.haeon.portal.repository.MemberRepository.MemberCredential;
import com.bookwave.lab.haeon.portal.repository.MemberSessionRepository;
import com.bookwave.lab.haeon.portal.repository.PortalQueryRepository;
import com.bookwave.lab.haeon.portal.repository.PortalQueryRepository.MemberCard;
import com.bookwave.lab.haeon.portal.repository.PortalQueryRepository.MemberTransaction;
import com.bookwave.lab.haeon.portal.service.PasswordHasher;
import com.bookwave.lab.haeon.portal.service.PortalService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class PortalServiceTest {
    private static final String SALT = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    private static final String PASSWORD = "Haeon!2026";
    private static final Instant JOINED = Instant.parse("2026-01-02T00:00:00Z");

    private final MemberRepository memberRepository = mock(MemberRepository.class);
    private final MemberSessionRepository sessionRepository = mock(MemberSessionRepository.class);
    private final PortalQueryRepository queryRepository = mock(PortalQueryRepository.class);
    private final PasswordHasher passwordHasher = new PasswordHasher();
    private final PortalProperties properties = new PortalProperties(8085, 30, 20, 100);
    private final PortalService service = new PortalService(
            memberRepository, sessionRepository, queryRepository, passwordHasher, properties);

    private final Member memberOne = new Member(1L, "HC-MEMBER-001", "김해온", JOINED);

    @Test
    void issuesSessionTokenForCorrectPasswordAndStoresOnlyItsHash() {
        when(memberRepository.findCredentialByLoginId("haeon01")).thenReturn(Optional.of(
                new MemberCredential(memberOne, SALT, passwordHasher.hash(SALT, PASSWORD))));
        when(queryRepository.countCardsByMember(1L)).thenReturn(3);

        LoginResponse response = service.login(new LoginRequest("haeon01", PASSWORD));

        assertThat(response.sessionToken()).isNotBlank();
        assertThat(response.member().memberNo()).isEqualTo("HC-MEMBER-001");
        assertThat(response.member().cardCount()).isEqualTo(3);
        verify(sessionRepository).insert(eq(passwordHasher.hashToken(response.sessionToken())),
                eq(1L), any(Instant.class), any(Instant.class));
        verify(sessionRepository, never()).insert(eq(response.sessionToken()), anyLong(),
                any(Instant.class), any(Instant.class));
    }

    @Test
    void rejectsWrongPasswordWithoutRevealingWhetherTheAccountExists() {
        when(memberRepository.findCredentialByLoginId("haeon01")).thenReturn(Optional.of(
                new MemberCredential(memberOne, SALT, passwordHasher.hash(SALT, PASSWORD))));
        when(memberRepository.findCredentialByLoginId("nobody")).thenReturn(Optional.empty());

        HaeonCardException wrongPassword = catchPortalException("haeon01", "wrong-password");
        HaeonCardException unknownId = catchPortalException("nobody", PASSWORD);

        assertThat(wrongPassword.status()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(wrongPassword.errorCode()).isEqualTo(unknownId.errorCode()).isEqualTo("INVALID_CREDENTIALS");
        assertThat(wrongPassword.getMessage()).isEqualTo(unknownId.getMessage());
        verify(sessionRepository, never()).insert(anyString(), anyLong(), any(Instant.class), any(Instant.class));
    }

    @Test
    void requiresAnActiveSessionBeforeAnyQuery() {
        when(sessionRepository.findMemberIdByActiveToken(anyString(), any(Instant.class)))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.requireMember(null))
                .isInstanceOfSatisfying(HaeonCardException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo("SESSION_REQUIRED"));
        assertThatThrownBy(() -> service.requireMember("Bearer expired-token"))
                .isInstanceOfSatisfying(HaeonCardException.class,
                        ex -> assertThat(ex.status()).isEqualTo(HttpStatus.UNAUTHORIZED));
        verify(queryRepository, never()).findCardsByMember(anyLong());
        verify(queryRepository, never()).findTransactionsByMember(anyLong(), anyInt());
    }

    @Test
    void scopesCardsAndTransactionsToTheSessionMember() {
        when(queryRepository.findCardsByMember(1L)).thenReturn(List.of(
                card("0001", "해온 플러스", true, 100_000, 30_000),
                card("0002", "해온 데일리", false, 3_000_000, 220_000)));
        when(queryRepository.countCardsByMember(1L)).thenReturn(2);
        when(queryRepository.findTransactionsByMember(1L, 20)).thenReturn(List.of(
                transaction("AUTH-HC-0001", "APPROVED", "APPROVED", 30_000),
                transaction("AUTH-HC-0002", "DECLINED", "LIMIT_EXCEEDED", 900_000)));

        CardListResponse cards = service.cards(memberOne);
        TransactionListResponse transactions = service.transactions(memberOne, null);

        assertThat(cards.cards()).extracting("maskedNumber")
                .containsExactly("**** **** **** 0001", "**** **** **** 0002");
        assertThat(cards.cards().get(0).remainingAmount()).isEqualTo(70_000);
        assertThat(cards.totalLimitAmount()).isEqualTo(3_100_000);
        assertThat(cards.totalUsedAmount()).isEqualTo(250_000);
        assertThat(cards.totalRemainingAmount()).isEqualTo(2_850_000);
        assertThat(transactions.approvedCount()).isEqualTo(1);
        assertThat(transactions.approvedAmount()).isEqualTo(30_000);
        assertThat(transactions.declinedCount()).isEqualTo(1);
        verify(queryRepository).findCardsByMember(1L);
        verify(queryRepository).findTransactionsByMember(1L, 20);
        verify(queryRepository, never()).findCardsByMember(2L);
        verify(queryRepository, never()).findTransactionsByMember(2L, 20);
    }

    @Test
    void capsTheRequestedTransactionPageSize() {
        when(queryRepository.countCardsByMember(1L)).thenReturn(0);
        when(queryRepository.findTransactionsByMember(anyLong(), anyInt())).thenReturn(List.of());

        service.transactions(memberOne, 5_000);

        verify(queryRepository).findTransactionsByMember(1L, 100);
    }

    private HaeonCardException catchPortalException(String loginId, String password) {
        try {
            service.login(new LoginRequest(loginId, password));
        } catch (HaeonCardException ex) {
            return ex;
        }
        throw new AssertionError("로그인이 실패해야 합니다: " + loginId);
    }

    private MemberCard card(String last4, String name, boolean primary, long limit, long used) {
        return new MemberCard(1L, last4, name, "Mastercard", "신용", 25, "혜택 요약", primary, "NORMAL",
                BigDecimal.valueOf(limit), BigDecimal.valueOf(used));
    }

    private MemberTransaction transaction(String authNo, String status, String decisionCode, long amount) {
        return new MemberTransaction(authNo, JOINED, "북웨이브", "해온 플러스", "0001",
                BigDecimal.valueOf(amount), status, decisionCode);
    }
}
