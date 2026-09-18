package com.bookwave.lab.haeon.config;

import org.apache.catalina.connector.Connector;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 회원 포털 전용 커넥터를 추가한다.
 *
 * <p>승인 API(server.port)는 카드 내부망 전용으로 남고, 회원이 브라우저로 여는 포털만
 * 별도 포트로 공개한다. 포트별 경로 제한은 {@link PortConfinementFilter}가 강제한다.
 */
@Configuration
public class PortalConnectorConfig {

    @Bean
    public WebServerFactoryCustomizer<TomcatServletWebServerFactory> portalConnector(PortalProperties properties) {
        return factory -> {
            Connector connector = new Connector(TomcatServletWebServerFactory.DEFAULT_PROTOCOL);
            connector.setPort(properties.port());
            connector.setProperty("bindOnInit", "false");
            factory.addAdditionalTomcatConnectors(connector);
        };
    }
}
