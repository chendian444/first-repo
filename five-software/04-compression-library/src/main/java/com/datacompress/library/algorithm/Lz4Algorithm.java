package com.datacompress.library.algorithm;

import net.jpountz.lz4.*;
import org.springframework.stereotype.Component;
import java.nio.ByteBuffer;
import java.util.List;

@Component
public class Lz4Algorithm extends BaseAlgorithm {
    private final LZ4Factory factory = LZ4Factory.fastestInstance();
    public Lz4Algorithm() { super("LZ4", true, 0, 9, 0, List.of(0, 6)); }

    public byte[] compress(byte[] input, int level) {
        LZ4Compressor compressor = normalizeLevel(level) == 0
                ? factory.fastCompressor()
                : factory.highCompressor(normalizeLevel(level));
        byte[] buffer = new byte[compressor.maxCompressedLength(input.length)];
        int n = compressor.compress(input, 0, input.length, buffer, 0, buffer.length);
        ByteBuffer frame = ByteBuffer.allocate(8 + n);
        frame.putInt(input.length).putInt(n).put(buffer, 0, n);
        return frame.array();
    }

    public byte[] decompress(byte[] input) {
        ByteBuffer frame = ByteBuffer.wrap(input);
        int original = frame.getInt();
        int compressed = frame.getInt();
        byte[] data = new byte[compressed];
        frame.get(data);
        byte[] restored = new byte[original];
        factory.fastDecompressor().decompress(data, 0, restored, 0, original);
        return restored;
    }
}
