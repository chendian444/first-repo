package com.datacompress.control.service;

import com.datacompress.control.algorithm.*;
import com.datacompress.control.domain.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class CompressionProfileService {
    private static final int CRITICAL_NO_COMPRESSION_MAX_BYTES = 16 * 1024 * 1024;
    private final AlgorithmRegistry registry;
    private final int sampleBytes;
    private final Map<String, List<AlgorithmProfile>> cache = new ConcurrentHashMap<>();

    public CompressionProfileService(
            AlgorithmRegistry registry,
            @Value("${app.strategy.profile-sample-bytes:65536}") int sampleBytes) {
        this.registry = registry;
        this.sampleBytes = sampleBytes;
    }

    public List<AlgorithmProfile> profile(byte[] data, RecognitionResult recognition,
                                          PriorityDecision priority, String mode,
                                          String manualAlgorithm, Integer manualLevel) {
        String signature = recognition.modality() + ":" + data.length + ":"
                + Arrays.hashCode(Arrays.copyOf(data, Math.min(1024, data.length)))
                + ":" + mode + ":" + manualAlgorithm + ":" + manualLevel;
        return cache.computeIfAbsent(signature,
                key -> build(data, recognition, priority, mode, manualAlgorithm, manualLevel));
    }

    private List<AlgorithmProfile> build(byte[] data, RecognitionResult recognition,
                                         PriorityDecision priority, String mode,
                                         String manualAlgorithm, Integer manualLevel) {
        byte[] sample = representativeSample(data);
        List<Candidate> candidates = candidates(recognition, priority, mode, manualAlgorithm, manualLevel, data.length);
        List<AlgorithmProfile> result = new ArrayList<>();

        for (Candidate candidate : candidates) {
            CompressionAlgorithm algorithm = registry.require(candidate.algorithm());
            int level = algorithm.normalizeLevel(candidate.level());
            try {
                long c0 = System.nanoTime();
                byte[] compressed = algorithm.compress(sample, level);
                long cNanos = System.nanoTime() - c0;

                long d0 = System.nanoTime();
                byte[] restored = algorithm.decompress(compressed);
                long dNanos = System.nanoTime() - d0;

                if (!Arrays.equals(sample, restored)) {
                    throw new IllegalStateException("解压结果不一致");
                }

                double bytes = Math.max(1.0, sample.length);
                result.add(new AlgorithmProfile(algorithm.name(), level, true,
                        compressed.length / bytes, cNanos / bytes, dNanos / bytes, null));
            } catch (Throwable error) {
                result.add(new AlgorithmProfile(algorithm.name(), level, false,
                        1.0, 0, 0, error.getClass().getSimpleName() + ": " + error.getMessage()));
            }
        }
        return result;
    }

    private List<Candidate> candidates(RecognitionResult recognition,
                                       PriorityDecision priority, String mode,
                                       String manualAlgorithm, Integer manualLevel,
                                       int dataLength) {
        if ("MANUAL".equalsIgnoreCase(mode)) {
            String algorithm = manualAlgorithm == null ? "ZSTD" : manualAlgorithm;
            CompressionAlgorithm value = registry.require(algorithm);
            return List.of(new Candidate(value.name(),
                    manualLevel == null ? value.defaultLevel() : manualLevel));
        }

        if (recognition.alreadyCompressed()) return List.of(new Candidate("NONE", 0));

        LinkedHashSet<Candidate> set = new LinkedHashSet<>();
        if (priority.priority() != DataPriority.CRITICAL || dataLength <= CRITICAL_NO_COMPRESSION_MAX_BYTES) {
            set.add(new Candidate("NONE", 0));
        }

        switch (priority.priority()) {
            case CRITICAL -> {
                set.add(new Candidate("LZ4", 0));
                set.add(new Candidate("SNAPPY", 0));
                set.add(new Candidate("ZSTD", 1));
                set.add(new Candidate("ZSTD", 3));
            }
            case IMPORTANT -> {
                set.add(new Candidate("LZ4", 0));
                set.add(new Candidate("ZSTD", 1));
                set.add(new Candidate("ZSTD", 3));
                set.add(new Candidate("GZIP", 1));
            }
            case NORMAL -> {
                set.add(new Candidate("LZ4", 0));
                set.add(new Candidate("ZSTD", 1));
                set.add(new Candidate("ZSTD", 3));
                set.add(new Candidate("ZSTD", 6));
                set.add(new Candidate("GZIP", 1));
                set.add(new Candidate("GZIP", 6));
                if (recognition.modality() == DataModality.TEXT_LOG
                        || recognition.modality() == DataModality.STATISTICAL_REPORT) {
                    set.add(new Candidate("BROTLI", 6));
                }
            }
        }
        return List.copyOf(set);
    }
    private byte[] representativeSample(byte[] data) {
        int size = Math.min(sampleBytes, data.length);
        if (size == data.length) return data.clone();
        byte[] out = new byte[size];
        int third = size / 3;
        System.arraycopy(data, 0, out, 0, third);
        int middle = Math.max(0, data.length / 2 - third / 2);
        System.arraycopy(data, middle, out, third, third);
        int rest = size - third * 2;
        System.arraycopy(data, data.length - rest, out, third * 2, rest);
        return out;
    }

    private record Candidate(String algorithm, int level) {}
}
