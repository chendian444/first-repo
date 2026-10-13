package com.datacompress.monitor.service;

import com.datacompress.monitor.domain.DataSourceInfo;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class DataSourceService {
    private final Map<String, DataSourceInfo> sources = new ConcurrentHashMap<>();

    public DataSourceService() {
        save(new DataSourceInfo("sensor-line-01", "产线传感器", "SENSOR",
                "mqtt://edge-gateway/line1", "GW-L1", "设备监测",
                true, Instant.now(), 0L, 100));
        save(new DataSourceInfo("camera-yard-01", "厂区摄像头", "CAMERA",
                "rtsp://camera/yard1", "CAM-Y1", "视频巡检",
                true, Instant.now(), 0L, 1000));
        save(new DataSourceInfo("log-center", "日志系统", "LOG_SYSTEM",
                "http://log-center/api", "LOG-01", "运行审计",
                true, Instant.now(), 0L, 1000));
    }

    public List<DataSourceInfo> list() {
        return sources.values().stream()
                .sorted(Comparator.comparing(DataSourceInfo::name))
                .toList();
    }

    public DataSourceInfo get(String id) {
        return Optional.ofNullable(sources.get(id))
                .orElseThrow(() -> new IllegalArgumentException("数据源不存在: " + id));
    }

    public DataSourceInfo save(DataSourceInfo input) {
        String id = input.id() == null || input.id().isBlank()
                ? UUID.randomUUID().toString()
                : input.id();
        DataSourceInfo value = new DataSourceInfo(
                id, input.name(), input.type(), input.endpoint(),
                input.deviceCode(), input.businessScene(), input.online(),
                input.lastReportTime() == null ? Instant.now() : input.lastReportTime(),
                input.cumulativeBytes(), input.collectionPeriodMs());
        sources.put(id, value);
        return value;
    }

    public void addBytes(String id, long bytes) {
        sources.computeIfPresent(id, (key, old) -> new DataSourceInfo(
                old.id(), old.name(), old.type(), old.endpoint(), old.deviceCode(),
                old.businessScene(), true, Instant.now(),
                old.cumulativeBytes() + Math.max(0L, bytes), old.collectionPeriodMs()));
    }
}
