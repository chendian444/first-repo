package com.datacompress.control.algorithm;

import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class AlgorithmRegistry {
    private final Map<String, CompressionAlgorithm> algorithms = new LinkedHashMap<>();

    public AlgorithmRegistry(List<CompressionAlgorithm> implementations) {
        implementations.stream()
                .sorted(Comparator.comparing(CompressionAlgorithm::name))
                .forEach(a -> algorithms.put(a.name(), a));
    }

    public CompressionAlgorithm require(String name) {
        CompressionAlgorithm value = algorithms.get(
                name == null ? "" : name.trim().toUpperCase(Locale.ROOT));
        if (value == null) throw new IllegalArgumentException("Unsupported algorithm: " + name);
        return value;
    }

    public List<CompressionAlgorithm> all() { return List.copyOf(algorithms.values()); }
}
