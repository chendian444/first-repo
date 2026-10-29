package com.datacompress.control.domain;

public record StrategyAdjustment(
        long elapsedMillis,
        String fromStrategy,
        String toStrategy,
        double actualRateKbps,
        double predictedRateKbps,
        double predictionErrorPercent,
        double estimatedGainPercent,
        String reason) {
}
