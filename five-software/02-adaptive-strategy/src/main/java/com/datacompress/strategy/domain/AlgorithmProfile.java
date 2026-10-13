package com.datacompress.strategy.domain;

public record AlgorithmProfile(
        String algorithm,
        int level,
        boolean available,
        double compressedRatio,
        double compressionNanosPerByte,
        double decompressionNanosPerByte,
        String error) {

    public long compressedBytes(long originalBytes) {
        return "NONE".equals(algorithm)
                ? originalBytes
                : Math.max(1L, Math.round(originalBytes * compressedRatio));
    }

    public double compressionMillis(long bytes) {
        return compressionNanosPerByte * bytes / 1_000_000.0D;
    }

    public double decompressionMillis(long bytes) {
        return decompressionNanosPerByte * bytes / 1_000_000.0D;
    }
}
