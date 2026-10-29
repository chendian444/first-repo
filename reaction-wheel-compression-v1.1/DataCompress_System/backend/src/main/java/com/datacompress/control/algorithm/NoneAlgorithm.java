package com.datacompress.control.algorithm;

import org.springframework.stereotype.Component;
import java.util.List;

@Component
public class NoneAlgorithm extends BaseAlgorithm {
    public NoneAlgorithm() { super("NONE", false, 0, 0, 0, List.of(0)); }
    public byte[] compress(byte[] input, int level) { return input.clone(); }
    public byte[] decompress(byte[] input) { return input.clone(); }
}
