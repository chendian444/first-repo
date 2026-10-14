package com.datacompress.control.domain;

import java.time.Instant;
import java.util.List;

public record RateForecast(
        Instant generatedAt,
        List<Double> predictedRatesKbps,
        double predictedAverageKbps,
        double safeRateKbps,
        double recentMaeKbps,
        double recentMapePercent,
        double correctionFactor,
        String modelName,
        long inferenceMillis,
        boolean telemetryFresh,
        long telemetryAgeMillis,
        boolean degraded,
        String degradationReason,
        double baselineP20Kbps,
        double shortAverageKbps,
        double mediumAverageKbps,
        double unsafePredictionRatioPercent,
        int feedbackSamples) {
    public RateForecast {
        predictedRatesKbps = List.copyOf(predictedRatesKbps);
    }
}
