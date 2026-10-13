package com.datacompress.monitor.controller;

import com.datacompress.monitor.domain.DataSourceInfo;
import com.datacompress.monitor.service.DataSourceService;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/sources")
public class DataSourceController {
    private final DataSourceService service;
    public DataSourceController(DataSourceService service) { this.service = service; }

    @GetMapping public List<DataSourceInfo> list() { return service.list(); }
    @PostMapping public DataSourceInfo save(@RequestBody DataSourceInfo source) {
        return service.save(source);
    }
}
