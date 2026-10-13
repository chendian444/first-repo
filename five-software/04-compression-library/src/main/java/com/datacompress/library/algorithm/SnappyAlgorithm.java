package com.datacompress.library.algorithm;

import org.springframework.stereotype.Component;
import org.xerial.snappy.Snappy;
import java.util.List;

@Component
public class SnappyAlgorithm extends BaseAlgorithm {
    public SnappyAlgorithm() { super("SNAPPY", false, 0, 0, 0, List.of(0)); }
    public byte[] compress(byte[] input, int level) throws Exception { return Snappy.compress(input); }
    public byte[] decompress(byte[] input) throws Exception { return Snappy.uncompress(input); }
}
