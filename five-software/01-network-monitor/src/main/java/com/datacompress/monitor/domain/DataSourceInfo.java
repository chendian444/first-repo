package com.datacompress.monitor.domain;

import java.time.Instant;

public record DataSourceInfo(
        String id,
        String name,
        String type,
        String endpoint,
        String deviceCode,
        String businessScene,
        boolean online,
        Instant lastReportTime,
        long cumulativeBytes,
        int collectionPeriodMs) {
}
