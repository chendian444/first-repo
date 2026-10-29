package com.datacompress.control.domain;

import java.time.Instant;

public record AlarmRecord(
        String id,
        AlarmLevel level,
        AlarmType type,
        String source,
        Instant occurredAt,
        String affectedTaskId,
        String description,
        String suggestion,
        String status,
        String handlingNote) {
}
