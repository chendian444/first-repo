package com.datacompress.control;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class DataCompressControlApplication {
    public static void main(String[] args) {
        SpringApplication.run(DataCompressControlApplication.class, args);
    }
}
