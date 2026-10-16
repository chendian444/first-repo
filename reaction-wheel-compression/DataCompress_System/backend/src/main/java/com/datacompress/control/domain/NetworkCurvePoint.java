package com.datacompress.control.domain;

public record NetworkCurvePoint(
        long elapsedMillis,
        double actualRateKbps,
        double predictedRateKbps,
        double safeRateKbps,
        double predictionErrorPercent,
        String strategy) {
}
