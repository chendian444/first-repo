package com.datacompress.monitor.service;

import com.datacompress.monitor.domain.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.atomic.AtomicLong;

@Service
public class NetworkTelemetryService {
    private final Deque<NetworkSample> history = new ConcurrentLinkedDeque<>();
    private final Random random = new Random(20260625L);
    private final int historyLimit;
    private final long staleAfterMillis;
    private final double minimumFallbackRateKbps;
    private final AtomicLong tick = new AtomicLong();
    private volatile boolean simulationEnabled;
    private volatile NetworkSample externalSample;
    private volatile long externalReceivedAt;
    private volatile long lastMeasurementAt;
    private volatile String activeSource;
    private volatile double jitterEma;
    private volatile double previousRtt;

    public NetworkTelemetryService(
            @Value("${app.network.history-limit:7200}") int historyLimit,
            @Value("${app.network.simulation-enabled:true}") boolean simulationEnabled,
            @Value("${app.network.measurement-stale-after-ms:10000}") long staleAfterMillis,
            @Value("${app.network.minimum-fallback-rate-kbps:32}") double minimumFallbackRateKbps) {
        this.historyLimit = Math.max(120, historyLimit);
        this.simulationEnabled = simulationEnabled;
        this.staleAfterMillis = Math.max(1000, staleAfterMillis);
        this.minimumFallbackRateKbps = Math.max(1.0, minimumFallbackRateKbps);
        if (simulationEnabled) {
            for (int i = 0; i < 60; i++) append(simulated(i));
            markMeasured("SIMULATION");
        } else {
            append(idleSample());
            activeSource = "NO_TELEMETRY";
        }
    }

    @Scheduled(fixedDelayString = "${app.network.sample-period-ms:500}")
    public void sample() {
        NetworkSample value;
        if (externalSample != null) {
            value = externalSample;
            lastMeasurementAt = externalReceivedAt;
            activeSource = "EXTERNAL_TELEMETRY";
        } else if (simulationEnabled) {
            value = simulated(tick.incrementAndGet());
            markMeasured("SIMULATION");
        } else {
            value = idleSample();
            activeSource = "NO_TELEMETRY";
        }
        append(value);
    }

    public NetworkSample current() {
        NetworkSample sample = history.peekLast();
        return sample == null ? idleSample() : sample;
    }

    public List<NetworkSample> history(int limit) {
        List<NetworkSample> values = new ArrayList<>(history);
        int from = Math.max(0, values.size() - Math.max(1, Math.min(limit, historyLimit)));
        return List.copyOf(values.subList(from, values.size()));
    }

    public List<Double> rateHistory(int limit) {
        return history(limit).stream().map(NetworkSample::throughputKbps)
                .filter(v -> Double.isFinite(v) && v > 0).toList();
    }

    public void ingest(NetworkSample sample) {
        externalSample = new NetworkSample(
                sample.timestamp() == null ? Instant.now() : sample.timestamp(),
                positive(sample.throughputKbps(), 0), positive(sample.rttMillis(), 1),
                Math.max(0, sample.jitterMillis()), clamp(sample.packetLossPercent(), 0, 100),
                Math.max(0, sample.retransmissions()),
                sample.connectionState() == null ? ConnectionState.CONNECTED : sample.connectionState(),
                sample.quality() == null ? classify(sample.throughputKbps(), sample.rttMillis(),
                        sample.jitterMillis(), sample.packetLossPercent(), sample.connectionState()) : sample.quality(),
                Math.max(0, sample.queuedBytes()), Math.max(0, sample.cachedTasks()),
                clamp(sample.cpuPercent(), 0, 100), clamp(sample.memoryPercent(), 0, 100), true);
        externalReceivedAt = System.currentTimeMillis();
        lastMeasurementAt = externalReceivedAt;
        activeSource = "EXTERNAL_TELEMETRY";
        simulationEnabled = false;
        append(externalSample);
    }

    /** Compatibility entry point for the V7 prediction module's ACK-confirmed measurements. */
    public synchronized NetworkSample recordTransfer(double throughputKbps,
                                                     double rttMillis,
                                                     int retries,
                                                     long queuedBytes,
                                                     int cachedTasks) {
        double rate = positive(throughputKbps, minimumFallbackRateKbps);
        double rtt = positive(rttMillis, 1.0);
        double delta = previousRtt <= 0 ? 0 : Math.abs(rtt - previousRtt);
        jitterEma = jitterEma == 0 ? delta : 0.25 * delta + 0.75 * jitterEma;
        previousRtt = rtt;
        double loss = retries <= 0 ? 0 : Math.min(100.0, retries * 100.0 / (retries + 1.0));
        ConnectionState state = retries > 2 ? ConnectionState.CONGESTED
                : retries > 0 ? ConnectionState.UNSTABLE : ConnectionState.CONNECTED;
        NetworkSample sample = new NetworkSample(Instant.now(), rate, rtt, jitterEma, loss,
                Math.max(0, retries), state, classify(rate, rtt, jitterEma, loss, state),
                Math.max(0, queuedBytes), Math.max(0, cachedTasks), 0, 0, true);
        markMeasured("INTERNAL_TCP_ACK");
        append(sample);
        return sample;
    }

    public synchronized NetworkSample recordFailure(long queuedBytes, int cachedTasks) {
        NetworkSample previous = current();
        NetworkSample sample = new NetworkSample(Instant.now(),
                Math.max(minimumFallbackRateKbps, previous.throughputKbps() * 0.55),
                Math.max(previous.rttMillis(), 1000),
                Math.max(previous.jitterMillis(), 100),
                Math.max(previous.packetLossPercent(), 50),
                previous.retransmissions() + 1,
                ConnectionState.CONGESTED, NetworkQuality.CONGESTED,
                Math.max(0, queuedBytes), Math.max(0, cachedTasks), 0, 0, true);
        markMeasured("INTERNAL_TCP_FAILURE");
        append(sample);
        return sample;
    }

    public TelemetryStatus status() {
        long age = telemetryAgeMillis();
        boolean fresh = lastMeasurementAt > 0 && age <= staleAfterMillis;
        List<Double> minute = rateHistorySince(60_000L);
        List<Double> fiveMinutes = rateHistorySince(5 * 60_000L);
        List<Double> oneHour = rateHistorySince(60 * 60_000L);
        double fallback = Math.max(minimumFallbackRateKbps, current().throughputKbps());
        double p20 = percentile(minute, 0.20, fallback);
        double averageMinute = average(minute, fallback);
        double averageFive = average(fiveMinutes, averageMinute);
        double averageHour = average(oneHour, averageFive);
        double conservative = Math.max(minimumFallbackRateKbps, Math.min(p20, averageMinute * 0.85));
        return new TelemetryStatus(Instant.now(), fresh, age,
                activeSource == null ? "UNKNOWN" : activeSource,
                conservative, p20, averageMinute, averageFive, averageHour, history.size());
    }

    public boolean isTelemetryFresh() {
        return lastMeasurementAt > 0 && telemetryAgeMillis() <= staleAfterMillis;
    }

    public long telemetryAgeMillis() {
        if (lastMeasurementAt <= 0) return Long.MAX_VALUE;
        return Math.max(0, System.currentTimeMillis() - lastMeasurementAt);
    }

    public void setSimulationEnabled(boolean enabled) {
        simulationEnabled = enabled;
        if (!enabled && externalSample == null) { lastMeasurementAt = 0; activeSource = "NO_TELEMETRY"; }
        if (enabled) {
            externalSample = null;
            externalReceivedAt = 0;
            markMeasured("SIMULATION");
        }
    }

    public boolean isSimulationEnabled() { return simulationEnabled; }

    private void markMeasured(String source) {
        lastMeasurementAt = System.currentTimeMillis();
        activeSource = source;
    }

    private NetworkSample idleSample() {
        return new NetworkSample(Instant.now(), 0, 0, 0, 0,
                0, ConnectionState.DISCONNECTED, NetworkQuality.DISCONNECTED,
                0L, 0, 0, 0, false);
    }

    private NetworkSample simulated(long n) {
        double phase = n % 180;
        double base = 1500 + 350 * Math.sin(n / 18.0) + 160 * Math.sin(n / 5.5);
        if (phase > 65 && phase < 95) base -= 850;
        if (phase > 125 && phase < 138) base -= 1200;
        double rate = Math.max(50, base + random.nextGaussian() * 45);
        double loss = phase > 125 && phase < 138 ? 8 + random.nextDouble() * 8
                : phase > 65 && phase < 95 ? 2 + random.nextDouble() * 4
                : Math.max(0, random.nextGaussian() * 0.4);
        double rtt = 22 + Math.max(0, 1600 - rate) / 7 + random.nextDouble() * 10;
        double jitter = 3 + loss * 2.2 + random.nextDouble() * 8;
        ConnectionState state = rate < 80 ? ConnectionState.DISCONNECTED
                : rate < 450 ? ConnectionState.CONGESTED
                : loss > 3 ? ConnectionState.UNSTABLE
                : ConnectionState.CONNECTED;
        NetworkQuality quality = classify(rate, rtt, jitter, loss, state);
        return new NetworkSample(Instant.now(), rate, rtt, jitter, loss,
                loss > 1 ? (int)Math.ceil(loss / 2) : 0, state, quality,
                0L, 0, 28 + random.nextDouble() * 22,
                35 + random.nextDouble() * 20, false);
    }

    private NetworkQuality classify(double rate, double rtt, double jitter,
                                    double loss, ConnectionState state) {
        if (state == ConnectionState.DISCONNECTED || rate < 80) return NetworkQuality.DISCONNECTED;
        if (state == ConnectionState.RECOVERING) return NetworkQuality.RECOVERING;
        if (rate < 500 || loss > 5 || rtt > 250) return NetworkQuality.CONGESTED;
        if (loss > 1.5 || jitter > 35 || rtt > 120) return NetworkQuality.FLUCTUATING;
        return NetworkQuality.GOOD;
    }

    private List<Double> rateHistorySince(long millis) {
        Instant cutoff = Instant.now().minusMillis(Math.max(1, millis));
        return history.stream()
                .filter(sample -> sample.timestamp() != null && !sample.timestamp().isBefore(cutoff))
                .map(NetworkSample::throughputKbps)
                .filter(value -> Double.isFinite(value) && value > 0)
                .toList();
    }

    private void append(NetworkSample sample) {
        history.addLast(sample);
        while (history.size() > historyLimit) history.pollFirst();
    }

    private double average(List<Double> values, double fallback) {
        return values.stream().mapToDouble(Double::doubleValue).average().orElse(fallback);
    }

    private double percentile(List<Double> values, double quantile, double fallback) {
        if (values.isEmpty()) return fallback;
        List<Double> sorted = new ArrayList<>(values);
        sorted.sort(Double::compareTo);
        int index = (int)Math.floor(Math.max(0, Math.min(1, quantile)) * (sorted.size() - 1));
        return sorted.get(index);
    }

    private double positive(double value, double fallback) {
        return Double.isFinite(value) && value > 0 ? value : fallback;
    }

    private double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
