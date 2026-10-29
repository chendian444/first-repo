package com.datacompress.control.controller;

import com.datacompress.control.service.WheelTelemetryService;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

@RestController
@RequestMapping("/api/wheel")
public class WheelTelemetryController {
    private final WheelTelemetryService service;
    public WheelTelemetryController(WheelTelemetryService service) { this.service = service; }
    @PostMapping(value="/frames", consumes=MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public Map<String, Object> frames(@RequestBody byte[] bytes,
            @RequestHeader(value="X-Wheel-Batch-Id", required=false) String batch,
            @RequestHeader(value="X-Wheel-Session", required=false) String session) {
        return service.ingest(bytes, batch, session);
    }
    @GetMapping("/status") public Map<String, Object> status() { return service.status(); }
    @GetMapping("/config") public WheelTelemetryService.Config config() { return service.config(); }
    @PutMapping("/config") public WheelTelemetryService.Config config(
            @RequestBody JsonNode value) {
        JsonNode period = value.get("periodMs"), mode = value.get("mode");
        if (period == null || !period.isIntegralNumber() || !period.canConvertToInt()
                || mode == null || !mode.isTextual())
            throw new IllegalArgumentException("需要字符串 mode 和整数 periodMs");
        return service.configure(new WheelTelemetryService.Config(mode.asText(), period.asInt()));
    }
    @GetMapping("/history") public List<WheelTelemetryService.Sample> history(
            @RequestParam(value="limit", defaultValue="200") int limit) { return service.history(limit); }
    @GetMapping("/export.csv") public ResponseEntity<String> csv() {
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION,
                "attachment; filename=wheel-telemetry.csv")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8)).body(service.csv());
    }
}
