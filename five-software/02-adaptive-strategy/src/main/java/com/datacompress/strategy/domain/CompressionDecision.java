package com.datacompress.strategy.domain;

public record CompressionDecision(
        String preprocess,
        String algorithm,
        int level,
        int chunkSizeBytes,
        boolean cache,
        boolean batch,
        int sendOrder,
        double estimatedCompressionMillis,
        double estimatedTransferMillis,
        double estimatedDecompressionMillis,
        double estimatedTotalMillis,
        double estimatedCompressedRatio,
        String reason) {

    public String strategyKey() {
        return algorithm + "-" + level + "-" + chunkSizeBytes;
    }
}
