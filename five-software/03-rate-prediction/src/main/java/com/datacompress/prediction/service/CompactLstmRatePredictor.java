package com.datacompress.prediction.service;

import com.datacompress.prediction.service.ForecastSeries.Sample;
import com.datacompress.prediction.domain.PredictionHealth;
import com.datacompress.prediction.domain.RateForecast;
import com.datacompress.prediction.service.ForecastSeries.Status;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.time.Instant;
import java.util.*;

@Service
public class CompactLstmRatePredictor {
    private static final Logger log = LoggerFactory.getLogger(CompactLstmRatePredictor.class);

    private final ObjectMapper mapper;
    private final PredictionFeedbackService feedback;
    private final ForecastSeries network;
    private final int configuredHorizon;
    private final int historySamples;
    private final double minimumRateKbps;
    private Model model;

    public CompactLstmRatePredictor(
            ObjectMapper mapper,
            PredictionFeedbackService feedback,
            ForecastSeries network,
            @Value("${app.predictor.horizon:12}") int configuredHorizon,
            @Value("${app.predictor.history-samples:7200}") int historySamples,
            @Value("${app.network.minimum-fallback-rate-kbps:64}") double minimumRateKbps) {
        this.mapper = mapper;
        this.feedback = feedback;
        this.network = network;
        this.configuredHorizon = Math.max(1, configuredHorizon);
        this.historySamples = Math.max(120, historySamples);
        this.minimumRateKbps = Math.max(1.0, minimumRateKbps);
    }

    @PostConstruct
    public void load() {
        try (InputStream in = new ClassPathResource("model/rate-lstm.json").getInputStream()) {
            model = mapper.readValue(in, Model.class);
            validateModel(model);
            log.info("Loaded compact LSTM model: sequenceLength={}, horizon={}, hiddenSize={}",
                    model.sequenceLength, model.horizon, model.hiddenSize);
        } catch (Exception error) {
            model = null;
            log.error("LSTM model unavailable; robust fallback will remain active", error);
        }
    }

    public RateForecast predictCurrent() {
        Sample current = network.current();
        return predict(network.rateHistory(historySamples),
                current.packetLossPercent(), current.jitterMillis());
    }

    public RateForecast predict(List<Double> history, double lossPercent, double jitterMillis) {
        long started = System.nanoTime();
        List<Double> clean = history == null ? List.of() : history.stream()
                .filter(v -> v != null && Double.isFinite(v) && v > 0)
                .toList();

        Baseline baseline = baseline(clean);
        Status telemetry = network.status();
        PredictionHealth health = feedback.health();
        boolean telemetryDegraded = !telemetry.fresh();
        boolean modelDegraded = !health.modelAllowed();

        List<Double> predicted;
        String modelName;
        String degradationReason = "NONE";

        if (telemetryDegraded) {
            predicted = robustFallback(clean, configuredHorizon, baseline);
            modelName = "ROBUST_P20_TELEMETRY_FALLBACK";
            degradationReason = "telemetry " + telemetry.source()
                    + ", ageMs=" + telemetry.ageMillis();
        } else if (model == null || clean.size() < Math.max(8, model.sequenceLength / 2)) {
            predicted = fallback(clean, configuredHorizon);
            modelName = "FAST_HOLT_WARMUP";
            degradationReason = model == null ? "model unavailable" : "insufficient history";
        } else if (modelDegraded) {
            predicted = robustFallback(clean, configuredHorizon, baseline);
            modelName = "ROBUST_P20_MODEL_CIRCUIT_BREAKER";
            degradationReason = health.reason();
        } else {
            predicted = stabilize(lstm(clean), baseline);
            modelName = "COMPACT_LSTM_MULTISCALE_GUARDED";
        }

        double average = predicted.stream().mapToDouble(Double::doubleValue)
                .average().orElse(Math.max(minimumRateKbps, baseline.shortAverage));
        double freshnessFactor = freshnessFactor(telemetry);
        double conservativeCeiling = conservativeCeiling(baseline,
                telemetryDegraded || modelDegraded);
        double safe = feedback.safe(average, lossPercent, jitterMillis,
                freshnessFactor, conservativeCeiling);
        long elapsed = (System.nanoTime() - started) / 1_000_000L;
        PredictionHealth finalHealth = feedback.health();
        boolean degraded = telemetryDegraded || modelDegraded
                || modelName.contains("FALLBACK") || modelName.contains("WARMUP");

        return new RateForecast(Instant.now(), predicted, average, safe,
                finalHealth.rollingMaeKbps(), finalHealth.rollingMapePercent(),
                finalHealth.correctionFactor(), modelName, elapsed,
                telemetry.fresh(), telemetry.ageMillis(), degraded, degradationReason,
                baseline.p20, baseline.shortAverage, baseline.mediumAverage,
                finalHealth.unsafePredictionRatioPercent(), finalHealth.rollingSamples());
    }

    public PredictionHealth health() {
        return feedback.health();
    }

    private List<Double> lstm(List<Double> history) {
        int seq = model.sequenceLength;
        List<Double> tail = new ArrayList<>();
        if (history.size() >= seq) {
            tail.addAll(history.subList(history.size() - seq, history.size()));
        } else {
            double first = history.isEmpty() ? minimumRateKbps : history.get(0);
            for (int i = history.size(); i < seq; i++) tail.add(first);
            tail.addAll(history);
        }

        double mean = tail.stream().mapToDouble(Double::doubleValue).average()
                .orElse(minimumRateKbps);
        double variance = 0;
        for (double value : tail) variance += (value - mean) * (value - mean);
        double std = Math.max(20.0, Math.sqrt(variance / tail.size()));

        double[] h = new double[model.hiddenSize];
        double[] c = new double[model.hiddenSize];

        for (double value : tail) {
            double x = (value - mean) / std;
            double[] gates = new double[4 * model.hiddenSize];
            for (int row = 0; row < gates.length; row++) {
                double sum = model.bias[row] + model.weightIH[row][0] * x;
                for (int j = 0; j < model.hiddenSize; j++) {
                    sum += model.weightHH[row][j] * h[j];
                }
                gates[row] = sum;
            }

            double[] nextH = new double[model.hiddenSize];
            double[] nextC = new double[model.hiddenSize];
            for (int j = 0; j < model.hiddenSize; j++) {
                double inputGate = sigmoid(gates[j]);
                double forgetGate = sigmoid(gates[model.hiddenSize + j]);
                double cellGate = Math.tanh(gates[2 * model.hiddenSize + j]);
                double outputGate = sigmoid(gates[3 * model.hiddenSize + j]);
                nextC[j] = forgetGate * c[j] + inputGate * cellGate;
                nextH[j] = outputGate * Math.tanh(nextC[j]);
            }
            h = nextH;
            c = nextC;
        }

        int horizon = Math.min(configuredHorizon, model.horizon);
        double historicalMin = Collections.min(tail);
        double historicalMax = Collections.max(tail);
        double lower = Math.max(minimumRateKbps, historicalMin * 0.45);
        double upper = Math.max(lower, historicalMax * 1.55);

        List<Double> out = new ArrayList<>(horizon);
        for (int i = 0; i < horizon; i++) {
            double y = model.outputBias[i];
            for (int j = 0; j < model.hiddenSize; j++) {
                y += model.outputWeight[i][j] * h[j];
            }
            double rate = mean + y * std;
            out.add(clamp(rate, lower, upper));
        }
        return out;
    }

    private List<Double> stabilize(List<Double> raw, Baseline baseline) {
        List<Double> out = new ArrayList<>(raw.size());
        for (int i = 0; i < raw.size(); i++) {
            double horizonWeight = Math.exp(-i / 5.0);
            double anchor = baseline.mediumAverage
                    + (baseline.shortAverage - baseline.mediumAverage) * horizonWeight;
            double blended = raw.get(i) * 0.72 + anchor * 0.23 + baseline.p20 * 0.05;
            double lower = Math.max(minimumRateKbps, baseline.p10 * 0.75);
            double upper = Math.max(lower, baseline.p90 * 1.30);
            out.add(clamp(blended, lower, upper));
        }
        return out;
    }

    private List<Double> robustFallback(List<Double> values, int horizon, Baseline baseline) {
        if (values.isEmpty()) return Collections.nCopies(horizon, minimumRateKbps);
        double level = Math.min(baseline.shortAverage, baseline.mediumAverage);
        double target = Math.max(baseline.p20, Math.min(level, baseline.p35));
        double trend = clamp((baseline.shortAverage - baseline.mediumAverage) * 0.20,
                -target * 0.10, target * 0.05);
        List<Double> out = new ArrayList<>(horizon);
        for (int i = 1; i <= horizon; i++) {
            double value = target + trend * i * Math.exp(-i / 3.0);
            out.add(Math.max(minimumRateKbps, value));
        }
        return out;
    }

    private List<Double> fallback(List<Double> values, int horizon) {
        if (values.isEmpty()) return Collections.nCopies(horizon, minimumRateKbps);
        int count = Math.min(24, values.size());
        List<Double> tail = values.subList(values.size() - count, values.size());
        double level = tail.get(0);
        double trend = 0;
        for (int i = 1; i < tail.size(); i++) {
            double previousLevel = level;
            level = 0.35 * tail.get(i) + 0.65 * (level + trend);
            trend = 0.15 * (level - previousLevel) + 0.85 * trend;
        }
        List<Double> out = new ArrayList<>();
        for (int i = 1; i <= horizon; i++) {
            out.add(Math.max(minimumRateKbps,
                    level + trend * i * Math.pow(0.96, i)));
        }
        return out;
    }

    private Baseline baseline(List<Double> values) {
        if (values.isEmpty()) {
            return new Baseline(minimumRateKbps, minimumRateKbps, minimumRateKbps,
                    minimumRateKbps, minimumRateKbps, minimumRateKbps);
        }
        List<Double> shortWindow = tail(values, 24);
        List<Double> mediumWindow = tail(values, 120);
        return new Baseline(
                percentile(mediumWindow, 0.10),
                percentile(mediumWindow, 0.20),
                percentile(mediumWindow, 0.35),
                percentile(mediumWindow, 0.90),
                average(shortWindow),
                average(mediumWindow));
    }

    private double conservativeCeiling(Baseline baseline, boolean degraded) {
        double healthy = Math.max(minimumRateKbps,
                Math.min(baseline.p90, baseline.p35 * 1.10));
        if (!degraded) return healthy;
        return Math.max(minimumRateKbps, baseline.p20 * 0.90);
    }

    private double freshnessFactor(Status status) {
        if (status.fresh()) return 1.0;
        if (status.ageMillis() == Long.MAX_VALUE) return 0.35;
        double factor = 0.75 - Math.min(0.45, status.ageMillis() / 60_000.0 * 0.45);
        return clamp(factor, 0.30, 0.75);
    }

    private List<Double> tail(List<Double> values, int count) {
        int from = Math.max(0, values.size() - count);
        return values.subList(from, values.size());
    }

    private double average(List<Double> values) {
        return values.stream().mapToDouble(Double::doubleValue).average()
                .orElse(minimumRateKbps);
    }

    private double percentile(List<Double> values, double quantile) {
        if (values.isEmpty()) return minimumRateKbps;
        List<Double> sorted = new ArrayList<>(values);
        sorted.sort(Double::compareTo);
        int index = (int)Math.floor(clamp(quantile, 0, 1) * (sorted.size() - 1));
        return sorted.get(index);
    }

    private void validateModel(Model value) {
        if (value.sequenceLength <= 0 || value.horizon <= 0 || value.hiddenSize <= 0
                || value.weightIH == null || value.weightHH == null || value.bias == null
                || value.outputWeight == null || value.outputBias == null) {
            throw new IllegalArgumentException("Incomplete LSTM model");
        }
        if (value.bias.length != value.hiddenSize * 4
                || value.outputBias.length < Math.min(configuredHorizon, value.horizon)) {
            throw new IllegalArgumentException("Invalid LSTM dimensions");
        }
    }

    private static double sigmoid(double x) {
        if (x >= 0) {
            double z = Math.exp(-x);
            return 1.0 / (1.0 + z);
        }
        double z = Math.exp(x);
        return z / (1.0 + z);
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private record Baseline(double p10, double p20, double p35, double p90,
                            double shortAverage, double mediumAverage) {}

    public static class Model {
        public String modelType;
        public int version;
        public int sequenceLength;
        public int horizon;
        public int inputSize;
        public int hiddenSize;
        public double trainingLoss;
        public double[][] weightIH;
        public double[][] weightHH;
        public double[] bias;
        public double[][] outputWeight;
        public double[] outputBias;
    }
}
