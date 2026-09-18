package com.bookwave.lab.haeon.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 회원 포털(마이페이지) 설정이다. 포털은 승인 API와 다른 커넥터 포트를 사용한다.
 */
@ConfigurationProperties(prefix = "haeon-portal")
public record PortalProperties(
        int port,
        long sessionTtlMinutes,
        int transactionPageSize,
        int transactionMaxPageSize
) {
}
