package com.datacompress.prediction.service;

import com.datacompress.prediction.domain.PredictionHealth;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;

@Service
public class PredictionFeedbackService {
    private final double alpha;
    private final double minimum;
    private final double maximum;
    private final int windowSize;
    private final int minimumHealthSamples;
    private final double maximumMapePercent;
    private final double maximumUnsafeRatio;
    private final long cooldownMillis;
    private final double maximumSafeStepUp;

    private final Deque<ErrorPoint> rolling = new ArrayDeque<>();
    private double correctionFactor = 0.90;
    private double mae;
    private double mape;
    private double unsafeRatio;
    private long degradedUntil;
    private String degradationReason = "HEALTHY";
    private double lastSafeRate;

    public PredictionFeedbackService(
            @Value("${app.predictor.feedback-alpha:0.18}") double alpha,
            @Value("${app.predictor.minimum-safe-factor:0.55}") double minimum,
            @Value("${app.predictor.maximum-safe-factor:1.05}") double maximum,
            @Value("${app.predictor.health-window-samples:240}") int windowSize,
            @Value("${app.predictor.health-minimum-samples:30}") int minimumHealthSamples,
            @Value("${app.predictor.health-maximum-mape-percent:35}") double maximumMapePercent,
            @Value("${app.predictor.health-maximum-unsafe-ratio:0.35}") double maximumUnsafeRatio,
            @Value("${app.predictor.health-cooldown-ms:60000}") long cooldownMillis,
            @Value("${app.predictor.maximum-safe-step-up:1.15}") double maximumSafeStepUp) {
        this.alpha = clamp(alpha, 0.01, 1.0);
        this.minimum = Math.max(0.05, minimum);
        this.maximum = Math.max(this.minimum, maximum);
        this.windowSize = Math.max(20, windowSize);
        this.minimumHealthSamples = Math.max(10, Math.min(this.windowSize, minimumHealthSamples));
        this.maximumMapePercent = Math.max(1.0, maximumMapePercent);
        this.maximumUnsafeRatio = clamp(maximumUnsafeRatio, 0.05, 1.0);
        this.cooldownMillis = Math.max(5_000L, cooldownMillis);
        this.maximumSafeStepUp = clamp(maximumSafeStepUp, 1.0, 2.0);
    }

    public synchronized void update(double predicted, double actual) {
        if (!Double.isFinite(predicted) || predicted <= 0
                || !Double.isFinite(actual) || actual <= 0) return;

        double ratio = clamp(actual / predicted, minimum, maximum);
        correctionFactor = alpha * ratio + (1.0 - alpha) * correctionFactor;

        double error = Math.abs(actual - predicted);
        double percent = error / actual * 100.0;
        boolean unsafe = predicted > actual * 1.15;
        rolling.addLast(new ErrorPoint(error, percent, unsafe));
        while (rolling.size() > windowSize) rolling.removeFirst();
        recalculate();
        evaluateHealth();
    }

    public synchronized double safe(double predicted, double lossPercent, double jitterMillis) {
        return safe(predicted, lossPercent, jitterMillis, 1.0, Double.POSITIVE_INFINITY);
    }

    public synchronized double safe(double predicted, double lossPercent, double jitterMillis,
                                    double freshnessFactor, double conservativeCeiling) {
        double penalty = clamp(1.0 - Math.max(0, lossPercent) / 100.0
                        - Math.max(0, jitterMillis) / 1000.0,
                0.55, 1.0);
        double target = Math.max(1.0, predicted * correctionFactor * penalty
                * clamp(freshnessFactor, 0.20, 1.0));
        if (Double.isFinite(conservativeCeiling) && conservativeCeiling > 0) {
            target = Math.min(target, conservativeCeiling);
        }
        if (lastSafeRate > 0) {
            target = Math.min(target, lastSafeRate * maximumSafeStepUp);
        }
        lastSafeRate = target;
        return target;
    }

    public synchronized PredictionHealth health() {
        long remaining = Math.max(0L, degradedUntil - System.currentTimeMillis());
        boolean degraded = remaining > 0;
        return new PredictionHealth(Instant.now(), !degraded, degraded,
                degraded ? degradationReason : "HEALTHY",
                rolling.size(), mae, mape, unsafeRatio * 100.0,
                correctionFactor, remaining);
    }

    public synchronized double factor() { return correctionFactor; }
    public synchronized double mae() { return mae; }
    public synchronized double mape() { return mape; }
    public synchronized double unsafeRatioPercent() { return unsafeRatio * 100.0; }
    public synchronized int sampleCount() { return rolling.size(); }

    private void recalculate() {
        if (rolling.isEmpty()) {
            mae = mape = unsafeRatio = 0;
            return;
        }
        double errorSum = 0;
        double percentSum = 0;
        int unsafe = 0;
        for (ErrorPoint point : rolling) {
            errorSum += point.absoluteError();
            percentSum += point.percentError();
            if (point.unsafe()) unsafe++;
        }
        mae = errorSum / rolling.size();
        mape = percentSum / rolling.size();
        unsafeRatio = unsafe / (double) rolling.size();
    }

    private void evaluateHealth() {
        if (rolling.size() < minimumHealthSamples) return;
        String reason = null;
        if (mape > maximumMapePercent) {
            reason = String.format("MAPE %.1f%% > %.1f%%", mape, maximumMapePercent);
        } else if (unsafeRatio > maximumUnsafeRatio) {
            reason = String.format("unsafe ratio %.1f%% > %.1f%%",
                    unsafeRatio * 100.0, maximumUnsafeRatio * 100.0);
        }
        if (reason != null) {
            degradedUntil = Math.max(degradedUntil, System.currentTimeMillis() + cooldownMillis);
            degradationReason = reason;
            correctionFactor = Math.min(correctionFactor, 0.75);
        }
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private record ErrorPoint(double absoluteError, double percentError, boolean unsafe) {}
}
