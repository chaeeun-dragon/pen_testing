package com.bookwave.lab.haeon.portal.api;

import com.bookwave.lab.haeon.portal.repository.MemberRepository.Member;
import com.bookwave.lab.haeon.portal.service.PortalService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 해온카드 회원 포털 API다. 포털 커넥터 포트에서만 응답한다.
 *
 * <p>결제 승인·거절·재조회는 {@code /internal/v1/authorizations}가 그대로 담당한다.
 * 이 컨트롤러는 조회만 하며 승인 상태를 바꾸지 않는다.
 */
@RestController
@RequestMapping("/portal/v1")
public class PortalController {
    private final PortalService portalService;

    public PortalController(PortalService portalService) {
        this.portalService = portalService;
    }

    @PostMapping("/sessions")
    public ResponseEntity<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        return ResponseEntity.ok(portalService.login(request));
    }

    @DeleteMapping("/sessions")
    public ResponseEntity<Void> logout(
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        portalService.logout(authorization);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me")
    public ResponseEntity<MemberResponse> me(
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        Member member = portalService.requireMember(authorization);
        return ResponseEntity.ok(portalService.me(member));
    }

    @GetMapping("/me/cards")
    public ResponseEntity<CardListResponse> cards(
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        Member member = portalService.requireMember(authorization);
        return ResponseEntity.ok(portalService.cards(member));
    }

    @GetMapping("/me/transactions")
    public ResponseEntity<TransactionListResponse> transactions(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestParam(value = "limit", required = false) Integer limit) {
        Member member = portalService.requireMember(authorization);
        return ResponseEntity.ok(portalService.transactions(member, limit));
    }

    @GetMapping("/me/protection-notices")
    public ResponseEntity<ProtectionNoticeListResponse> protectionNotices(
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        Member member = portalService.requireMember(authorization);
        return ResponseEntity.ok(portalService.protectionNotices(member));
    }

    @PostMapping("/me/protection-notices/{noticeId}/acknowledgement")
    public ResponseEntity<ProtectionNoticeResponse> acknowledgeProtectionNotice(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @org.springframework.web.bind.annotation.PathVariable long noticeId) {
        Member member = portalService.requireMember(authorization);
        return ResponseEntity.ok(portalService.acknowledgeProtectionNotice(member, noticeId));
    }
}
