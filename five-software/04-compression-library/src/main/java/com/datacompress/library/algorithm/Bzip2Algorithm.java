package com.datacompress.library.algorithm;

import org.apache.commons.compress.compressors.bzip2.*;
import org.springframework.stereotype.Component;
import java.io.*;
import java.util.List;

@Component
public class Bzip2Algorithm extends BaseAlgorithm {
    public Bzip2Algorithm() { super("BZIP2", true, 1, 9, 6, List.of(3, 6)); }

    public byte[] compress(byte[] input, int level) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (BZip2CompressorOutputStream stream =
                     new BZip2CompressorOutputStream(out, normalizeLevel(level))) {
            stream.write(input);
        }
        return out.toByteArray();
    }

    public byte[] decompress(byte[] input) throws Exception {
        try (BZip2CompressorInputStream in =
                     new BZip2CompressorInputStream(new ByteArrayInputStream(input))) {
            return in.readAllBytes();
        }
    }
}
