package com.datacompress.monitor.controller;

import com.datacompress.monitor.domain.AlarmRecord;
import com.datacompress.monitor.service.AlarmService;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/alarms")
public class AlarmController {
    private final AlarmService service;
    public AlarmController(AlarmService service) { this.service = service; }

    @GetMapping
    public List<AlarmRecord> list(@RequestParam(value = "level", required = false) String level,
                                  @RequestParam(value = "status", required = false) String status) {
        return service.list(level, status);
    }

    @PostMapping("/{id}/resolve")
    public AlarmRecord resolve(@PathVariable("id") String id,
                               @RequestBody(required = false) Map<String,String> body) {
        return service.resolve(id, body == null ? "" : body.getOrDefault("note", ""));
    }
}
