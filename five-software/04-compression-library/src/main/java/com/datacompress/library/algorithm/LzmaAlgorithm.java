package com.datacompress.library.algorithm;

import org.springframework.stereotype.Component;
import org.tukaani.xz.*;
import java.io.*;
import java.util.List;

@Component
public class LzmaAlgorithm extends BaseAlgorithm {
    public LzmaAlgorithm() { super("LZMA", true, 0, 9, 4, List.of(1, 4)); }

    public byte[] compress(byte[] input, int level) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (XZOutputStream stream =
                     new XZOutputStream(out, new LZMA2Options(normalizeLevel(level)))) {
            stream.write(input);
        }
        return out.toByteArray();
    }

    public byte[] decompress(byte[] input) throws Exception {
        try (XZInputStream in = new XZInputStream(new ByteArrayInputStream(input))) {
            return in.readAllBytes();
        }
    }
}
