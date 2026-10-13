package com.datacompress.library.algorithm;

import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;
import java.util.List;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;

class CoreCompressionTest {
    @Test
    void roundTripCoreAlgorithms() throws Exception {
        byte[] input = "sensor,value,status\nA,12.3,NORMAL\n".repeat(500)
                .getBytes(StandardCharsets.UTF_8);
        List<CompressionAlgorithm> algorithms = List.of(
                new NoneAlgorithm(), new GzipAlgorithm(), new DeflateAlgorithm(),
                new ZipAlgorithm(), new Bzip2Algorithm(), new LzmaAlgorithm(),
                new Lz4Algorithm(), new ZstdAlgorithm(), new SnappyAlgorithm(), new BrotliAlgorithm());
        for (CompressionAlgorithm algorithm : algorithms) {
            byte[] compressed = algorithm.compress(input, algorithm.defaultLevel());
            assertArrayEquals(input, algorithm.decompress(compressed), algorithm.name());
        }
    }
}
