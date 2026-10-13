package com.datacompress.monitor;
import com.datacompress.monitor.domain.*;
import com.datacompress.monitor.service.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.scheduling.annotation.Scheduled;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
@RestController
@RequestMapping("/api/monitor")
public class MonitorApi {
    private final DataSourceService sources;
    private final AlarmService alarms;
    private final Map<String,NetworkTelemetryService> channels = new ConcurrentHashMap<>();
    public MonitorApi(DataSourceService sources, AlarmService alarms, NetworkTelemetryService primary) {
        this.sources=sources; this.alarms=alarms;
        channels.put("primary", primary);
        sources.list().forEach(s -> channel(s.id()));
    }
    private NetworkTelemetryService channel(String id) {
        if(id==null || id.isBlank()) throw new IllegalArgumentException("数据源标识不能为空");
        return channels.computeIfAbsent(id, key -> new NetworkTelemetryService(7200,false,10000,32));
    }
    @Scheduled(fixedDelay=500)
    public void tick() {
        channels.forEach((id,c) -> {
            if(!id.equals("primary")) c.sample();
            if(!c.isTelemetryFresh() && c.current().externallyMeasured()) {
                alarms.raise(AlarmLevel.WARNING,AlarmType.DISCONNECTED,id,null,"遥测已超过 10 秒未更新","检查采样端与上报链路");
            }
        });
    }
    @GetMapping public List<Map<String,Object>> snapshot() {
        sources.list().forEach(s -> channel(s.id()));
        return channels.entrySet().stream().sorted(Map.Entry.comparingByKey()).map(e -> {
            Map<String,Object> row=new LinkedHashMap<>();
            row.put("sourceId",e.getKey());row.put("current",e.getValue().current());
            row.put("status",e.getValue().status());row.put("demo",e.getValue().isSimulationEnabled());
            return row;
        }).toList();
    }
    @GetMapping("/{sourceId}/history") public List<NetworkSample> history(@PathVariable String sourceId, @RequestParam(defaultValue="120") int limit) {
        return channel(sourceId).history(limit);
    }
    @PostMapping("/{sourceId}/telemetry") public NetworkSample ingest(@PathVariable String sourceId,@RequestBody NetworkSample input) {
        if(!Double.isFinite(input.throughputKbps()) || input.throughputKbps()<0 || !Double.isFinite(input.rttMillis()) || input.rttMillis()<0
            || !Double.isFinite(input.jitterMillis()) || input.jitterMillis()<0 || !Double.isFinite(input.packetLossPercent())
            || input.packetLossPercent()<0 || input.packetLossPercent()>100) throw new IllegalArgumentException("遥测数值无效");
        NetworkTelemetryService c=channel(sourceId);c.ingest(input);
        if(c.current().quality()==NetworkQuality.DISCONNECTED || c.current().quality()==NetworkQuality.CONGESTED || input.packetLossPercent()>3) {
            alarms.raise(c.current().quality()==NetworkQuality.DISCONNECTED?AlarmLevel.CRITICAL:AlarmLevel.WARNING,
                c.current().quality()==NetworkQuality.DISCONNECTED?AlarmType.DISCONNECTED:AlarmType.LOW_BANDWIDTH,
                sourceId,null,"链路质量异常："+c.current().quality(),"检查带宽、丢包及链路状态");
        }
        return c.current();
    }
    @PostMapping("/{sourceId}/demo") public Map<String,Object> demo(@PathVariable String sourceId,@RequestParam boolean enabled) {
        NetworkTelemetryService c=channel(sourceId);c.setSimulationEnabled(enabled);c.sample();
        return Map.of("sourceId",sourceId,"demo",enabled);
    }

    @ExceptionHandler(IllegalArgumentException.class) public org.springframework.http.ResponseEntity<Map<String,String>> invalid(IllegalArgumentException problem) { return org.springframework.http.ResponseEntity.badRequest().body(Map.of("error","MONITOR_SAMPLE_INVALID","message",String.valueOf(problem.getMessage()))); }
}
