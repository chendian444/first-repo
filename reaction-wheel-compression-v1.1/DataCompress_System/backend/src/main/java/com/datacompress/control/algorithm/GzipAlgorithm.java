package com.datacompress.control.algorithm;

import org.springframework.stereotype.Component;
import java.io.*;
import java.util.List;
import java.util.zip.*;

@Component
public class GzipAlgorithm extends BaseAlgorithm {
    public GzipAlgorithm() { super("GZIP", true, 0, 9, 6, List.of(1, 6)); }

    public byte[] compress(byte[] input, int level) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (LevelGzip stream = new LevelGzip(out, normalizeLevel(level))) {
            stream.write(input);
        }
        return out.toByteArray();
    }

    public byte[] decompress(byte[] input) throws Exception {
        try (GZIPInputStream in = new GZIPInputStream(new ByteArrayInputStream(input))) {
            return in.readAllBytes();
        }
    }

    private static final class LevelGzip extends GZIPOutputStream {
        LevelGzip(OutputStream out, int level) throws IOException {
            super(out);
            def.setLevel(level);
        }
    }
}
