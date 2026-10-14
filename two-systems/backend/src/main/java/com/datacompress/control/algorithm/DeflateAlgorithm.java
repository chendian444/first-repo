package com.datacompress.control.algorithm;

import org.springframework.stereotype.Component;
import java.io.*;
import java.util.List;
import java.util.zip.*;

@Component
public class DeflateAlgorithm extends BaseAlgorithm {
    public DeflateAlgorithm() { super("DEFLATE", true, 0, 9, 6, List.of(1, 6)); }

    public byte[] compress(byte[] input, int level) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Deflater deflater = new Deflater(normalizeLevel(level));
        try (DeflaterOutputStream stream = new DeflaterOutputStream(out, deflater)) {
            stream.write(input);
        } finally {
            deflater.end();
        }
        return out.toByteArray();
    }

    public byte[] decompress(byte[] input) throws Exception {
        try (InflaterInputStream in = new InflaterInputStream(new ByteArrayInputStream(input))) {
            return in.readAllBytes();
        }
    }
}
