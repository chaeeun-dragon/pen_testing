package com.bookwave.lab.haeon.config;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class PortConfinementFilterTest {
    private static final int APPROVAL_PORT = 8084;
    private static final int PORTAL_PORT = 8085;

    private final PortConfinementFilter filter =
            new PortConfinementFilter(new PortalProperties(PORTAL_PORT, 30, 20, 100));

    @Test
    void portalPortDoesNotExposeTheMerchantApprovalApi() throws Exception {
        MockHttpServletResponse response = call(PORTAL_PORT, "POST", "/internal/v1/authorizations");

        assertThat(response.getStatus()).isEqualTo(404);
        assertThat(response.getContentAsString()).contains("NOT_FOUND");
        assertThat(response.getContentAsString()).contains("\"correlationId\":\"portal\"");
    }

    @Test
    void approvalPortDoesNotExposeTheMemberPortal() throws Exception {
        MockHttpServletResponse portalResponse = call(APPROVAL_PORT, "GET", "/portal/v1/me/cards");
        assertThat(portalResponse.getStatus()).isEqualTo(404);
        assertThat(portalResponse.getContentAsString()).contains("\"correlationId\":\"unknown\"");
        assertThat(call(APPROVAL_PORT, "GET", "/").getStatus()).isEqualTo(404);
    }

    @Test
    void eachPortServesItsOwnSurface() throws Exception {
        assertThat(call(APPROVAL_PORT, "POST", "/internal/v1/authorizations").getStatus()).isEqualTo(200);
        assertThat(call(PORTAL_PORT, "GET", "/portal/v1/me/cards").getStatus()).isEqualTo(200);
        assertThat(call(PORTAL_PORT, "GET", "/").getStatus()).isEqualTo(200);
    }

    @Test
    void healthChecksStayAvailableOnBothPorts() throws Exception {
        assertThat(call(APPROVAL_PORT, "GET", "/actuator/health").getStatus()).isEqualTo(200);
        assertThat(call(PORTAL_PORT, "GET", "/actuator/health").getStatus()).isEqualTo(200);
    }

    @Test
    void doesNotTreatALookalikePathAsInternal() throws Exception {
        assertThat(call(PORTAL_PORT, "GET", "/internally-public").getStatus()).isEqualTo(200);
        assertThat(call(APPROVAL_PORT, "GET", "/internally-public").getStatus()).isEqualTo(404);
    }

    private MockHttpServletResponse call(int localPort, String method, String path) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        request.setLocalPort(localPort);
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, passThrough());
        return response;
    }

    private MockFilterChain passThrough() {
        return new MockFilterChain() {
            @Override
            public void doFilter(jakarta.servlet.ServletRequest request, jakarta.servlet.ServletResponse response) {
                ((HttpServletResponse) response).setStatus(200);
                assertThat(request).isInstanceOf(HttpServletRequest.class);
            }
        };
    }
}
