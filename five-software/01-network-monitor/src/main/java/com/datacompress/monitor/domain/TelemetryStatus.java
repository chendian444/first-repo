package com.datacompress.monitor.domain;

import java.time.Instant;

public record TelemetryStatus(
        Instant checkedAt,
        boolean fresh,
        long ageMillis,
        String source,
        double conservativeRateKbps,
        double p20OneMinuteKbps,
        double averageOneMinuteKbps,
        double averageFiveMinutesKbps,
        double averageOneHourKbps,
        int retainedSamples) {
}
