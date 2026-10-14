package com.datacompress.control.domain;

import java.time.Instant;

public record NetworkSample(
        Instant timestamp,
        double throughputKbps,
        double rttMillis,
        double jitterMillis,
        double packetLossPercent,
        int retransmissions,
        ConnectionState connectionState,
        NetworkQuality quality,
        long queuedBytes,
        int cachedTasks,
        double cpuPercent,
        double memoryPercent,
        boolean externallyMeasured) {
}
