package com.bookwave.lab.mockpg.service;

import com.bookwave.lab.mockpg.api.AuthorizationRequest;
import com.bookwave.lab.mockpg.api.AuthorizationResult;

/**
 * 카드 승인 시스템과 Mock PG 사이의 교체 가능한 경계다.
 *
 * 현재 구현은 Haeon 카드 API를 호출한다. 추후 팀장님 API를 받을 때는
 * 이 인터페이스 구현과 매핑 DTO만 추가하고 결제 서비스는 변경하지 않는다.
 */
public interface CardAuthorizationGateway {

    AuthorizationResult authorize(AuthorizationRequest request);
}
