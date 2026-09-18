package com.bookwave.lab.haeon.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 회원 포털의 확장자 없는 화면 주소를 정적 파일로 연결한다.
 *
 * <p>{@code /mypage}는 마이페이지 단독 화면이다. 랜딩({@code /})에는 회원 조회 영역을 두지 않고,
 * 로그인한 회원만 이 주소에서 카드 한도와 이용내역을 본다.
 */
@Configuration
public class PortalViewConfig implements WebMvcConfigurer {

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addViewController("/mypage").setViewName("forward:/mypage.html");
    }
}
