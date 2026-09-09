package com.bookwave.lab.bookwave;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class BookwaveApplication {

    public static void main(String[] args) {
        SpringApplication.run(BookwaveApplication.class, args);
    }
}
