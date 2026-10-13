package com.datacompress.library.algorithm;

import java.util.List;

public abstract class BaseAlgorithm implements CompressionAlgorithm {
    private final String name;
    private final boolean levels;
    private final int min;
    private final int max;
    private final int defaultLevel;
    private final List<Integer> realtimeLevels;

    protected BaseAlgorithm(String name, boolean levels, int min, int max,
                            int defaultLevel, List<Integer> realtimeLevels) {
        this.name = name;
        this.levels = levels;
        this.min = min;
        this.max = max;
        this.defaultLevel = defaultLevel;
        this.realtimeLevels = List.copyOf(realtimeLevels);
    }

    public String name() { return name; }
    public boolean supportsLevel() { return levels; }
    public int minLevel() { return min; }
    public int maxLevel() { return max; }
    public int defaultLevel() { return defaultLevel; }
    public List<Integer> realtimeLevels() { return realtimeLevels; }
}
