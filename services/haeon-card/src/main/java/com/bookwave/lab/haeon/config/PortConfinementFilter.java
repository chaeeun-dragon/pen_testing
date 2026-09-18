package com.bookwave.lab.haeon.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 포트별로 노출 경로를 가른다.
 *
 * <ul>
 *   <li>승인 포트(server.port): {@code /internal/**}, {@code /actuator/**}만 응답한다.</li>
 *   <li>포털 포트: {@code /internal/**}을 제외한 회원 화면·조회 API만 응답한다.</li>
 * </ul>
 *
 * <p>포털 포트가 호스트에 공개되어도 가맹점 승인 API는 그 포트로 도달하지 못한다.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class PortConfinementFilter extends OncePerRequestFilter {
    private static final String INTERNAL_PREFIX = "/internal";
    private static final String ACTUATOR_PREFIX = "/actuator";

    private final PortalProperties properties;

    public PortConfinementFilter(PortalProperties properties) {
        this.properties = properties;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String path = request.getRequestURI();
        boolean internalPath = path.equals(INTERNAL_PREFIX) || path.startsWith(INTERNAL_PREFIX + "/");
        boolean actuatorPath = path.equals(ACTUATOR_PREFIX) || path.startsWith(ACTUATOR_PREFIX + "/");
        boolean portalPort = request.getLocalPort() == properties.port();

        boolean allowed = actuatorPath || (portalPort ? !internalPath : internalPath);
        if (allowed) {
            chain.doFilter(request, response);
            return;
        }
        notFound(response, portalPort);
    }

    private void notFound(HttpServletResponse response, boolean portalPort) throws IOException {
        response.setStatus(HttpStatus.NOT_FOUND.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        String correlationId = portalPort ? "portal" : "unknown";
        response.getWriter().write("{\"correlationId\":\"" + correlationId
                + "\",\"errorCode\":\"NOT_FOUND\",\"message\":\"요청한 경로를 찾을 수 없습니다.\",\"retryable\":false}");
    }
}
