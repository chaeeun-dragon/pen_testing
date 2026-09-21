package com.bookwave.lab.support;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class MerchantViewConfig implements WebMvcConfigurer {
    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addViewController("/merchant").setViewName("forward:/merchant.html");
        registry.addViewController("/merchant/").setViewName("forward:/merchant.html");
    }
}
