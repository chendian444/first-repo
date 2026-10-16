package com.datacompress.control.algorithm;

import org.springframework.stereotype.Component;
import java.io.*;
import java.util.List;
import java.util.zip.*;

@Component
public class ZipAlgorithm extends BaseAlgorithm {
    public ZipAlgorithm() { super("ZIP", true, 0, 9, 6, List.of(1, 6)); }

    public byte[] compress(byte[] input, int level) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(out)) {
            zip.setLevel(normalizeLevel(level));
            zip.putNextEntry(new ZipEntry("payload.bin"));
            zip.write(input);
            zip.closeEntry();
        }
        return out.toByteArray();
    }

    public byte[] decompress(byte[] input) throws Exception {
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(input))) {
            if (zip.getNextEntry() == null) throw new IllegalArgumentException("ZIP entry missing");
            return zip.readAllBytes();
        }
    }
}
