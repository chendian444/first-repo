package com.datacompress.control.controller;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SoftwareIdentityController {
    private final String softwareName;

    public SoftwareIdentityController(@Value("${spring.application.name}") String softwareName) {
        this.softwareName = softwareName;
    }

    @GetMapping("/api/software/identity")
    public Map<String, String> identity() {
        return Map.of("name", softwareName);
    }
}
