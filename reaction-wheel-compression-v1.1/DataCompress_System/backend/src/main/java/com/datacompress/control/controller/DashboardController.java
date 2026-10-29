package com.datacompress.control.controller;

import com.datacompress.control.service.*;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {
    private final TransferTaskService tasks;
    private final DataSourceService sources;
    private final NetworkTelemetryService network;
    private final AlarmService alarms;

    public DashboardController(TransferTaskService tasks, DataSourceService sources,
                               NetworkTelemetryService network, AlarmService alarms) {
        this.tasks = tasks;
        this.sources = sources;
        this.network = network;
        this.alarms = alarms;
    }

    @GetMapping
    public Map<String,Object> snapshot() {
        Map<String,Object> result = new LinkedHashMap<>();
        result.put("network", network.current());
        result.put("sourceCount", sources.list().size());
        result.put("onlineSourceCount", sources.list().stream().filter(s -> s.online()).count());
        result.put("queueSize", tasks.queueSize());
        result.put("queuedBytes", tasks.queuedBytes());
        result.put("completedCount", tasks.completedCount());
        result.put("failedCount", tasks.failedCount());
        result.put("openAlarmCount", alarms.openCount());
        return result;
    }
}
