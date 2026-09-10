package com.bookwave.lab.haeon;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class HaeonCardApplication {

    public static void main(String[] args) {
        SpringApplication.run(HaeonCardApplication.class, args);
    }
}
