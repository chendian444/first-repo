package com.datacompress.control.domain;

import java.time.Instant;

public record PredictionHealth(
        Instant checkedAt,
        boolean modelAllowed,
        boolean degraded,
        String reason,
        int rollingSamples,
        double rollingMaeKbps,
        double rollingMapePercent,
        double unsafePredictionRatioPercent,
        double correctionFactor,
        long cooldownRemainingMillis) {
}
