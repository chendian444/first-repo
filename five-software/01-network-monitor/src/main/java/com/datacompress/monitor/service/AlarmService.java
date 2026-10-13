package com.datacompress.monitor.service;

import com.datacompress.monitor.domain.*;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class AlarmService {
    private final Map<String, AlarmRecord> alarms = new ConcurrentHashMap<>();
    private final Map<String, Long> cooldown = new ConcurrentHashMap<>();
    private static final long NETWORK_ALARM_COOLDOWN_MS = 60_000L;

    public AlarmRecord raise(AlarmLevel level, AlarmType type, String source,
                             String taskId, String description, String suggestion) {
        String key = (source == null ? "" : source) + ":" + type.name()
                + ":" + (taskId == null ? "" : taskId);

        Optional<AlarmRecord> existingOpen = alarms.values().stream()
                .filter(a -> "OPEN".equals(a.status()))
                .filter(a -> a.type() == type)
                .filter(a -> Objects.equals(a.source(), source))
                .filter(a -> Objects.equals(a.affectedTaskId(), taskId))
                .findFirst();
        if (existingOpen.isPresent()) return existingOpen.get();

        long now = System.currentTimeMillis();
        Long last = cooldown.get(key);
        if (last != null && now - last < NETWORK_ALARM_COOLDOWN_MS) {
            return alarms.values().stream()
                    .filter(a -> a.type() == type)
                    .filter(a -> Objects.equals(a.source(), source))
                    .filter(a -> Objects.equals(a.affectedTaskId(), taskId))
                    .max(Comparator.comparing(AlarmRecord::occurredAt))
                    .orElseGet(() -> create(level, type, source, taskId, description, suggestion, key, now));
        }
        return create(level, type, source, taskId, description, suggestion, key, now);
    }

    private AlarmRecord create(AlarmLevel level, AlarmType type, String source,
                               String taskId, String description, String suggestion,
                               String key, long now) {
        AlarmRecord record = new AlarmRecord(UUID.randomUUID().toString(), level, type,
                source, Instant.now(), taskId, description, suggestion, "OPEN", "");
        alarms.put(record.id(), record);
        cooldown.put(key, now);
        return record;
    }

    public List<AlarmRecord> list(String level, String status) {
        return alarms.values().stream()
                .filter(a -> level == null || level.isBlank() || a.level().name().equalsIgnoreCase(level))
                .filter(a -> status == null || status.isBlank() || a.status().equalsIgnoreCase(status))
                .sorted(Comparator.comparing(AlarmRecord::occurredAt).reversed())
                .toList();
    }

    public AlarmRecord resolve(String id, String note) {
        AlarmRecord old = Optional.ofNullable(alarms.get(id))
                .orElseThrow(() -> new IllegalArgumentException("告警不存在"));
        AlarmRecord updated = new AlarmRecord(old.id(), old.level(), old.type(), old.source(),
                old.occurredAt(), old.affectedTaskId(), old.description(), old.suggestion(),
                "RESOLVED", note == null ? "" : note);
        alarms.put(id, updated);
        return updated;
    }

    public long openCount() {
        return alarms.values().stream().filter(a -> "OPEN".equals(a.status())).count();
    }
}
