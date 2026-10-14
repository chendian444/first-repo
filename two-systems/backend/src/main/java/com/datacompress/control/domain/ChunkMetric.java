package com.datacompress.control.domain;

public record ChunkMetric(
        int chunkIndex,
        long offsetBytes,
        int originalBytes,
        int compressedBytes,
        String algorithm,
        int level,
        int chunkSizeBytes,
        double compressionMillis,
        double modeledTransferMillis,
        double decompressionMillis,
        double actualRateKbps,
        double predictedRateKbps,
        boolean checksumPassed,
        int retries,
        long elapsedMillis) {
}
