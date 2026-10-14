package com.datacompress.control.algorithm;

import java.util.List;

public interface CompressionAlgorithm {
    String name();
    boolean supportsLevel();
    int minLevel();
    int maxLevel();
    int defaultLevel();
    List<Integer> realtimeLevels();
    byte[] compress(byte[] input, int level) throws Exception;
    byte[] decompress(byte[] input) throws Exception;

    default int normalizeLevel(int level) {
        return supportsLevel()
                ? Math.max(minLevel(), Math.min(maxLevel(), level))
                : defaultLevel();
    }
}
