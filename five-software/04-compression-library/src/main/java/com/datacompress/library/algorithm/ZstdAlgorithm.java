package com.datacompress.library.algorithm;

import com.github.luben.zstd.Zstd;
import org.springframework.stereotype.Component;
import java.nio.ByteBuffer;
import java.util.List;

@Component
public class ZstdAlgorithm extends BaseAlgorithm {
    public ZstdAlgorithm() { super("ZSTD", true, 1, 22, 3, List.of(1, 3, 6)); }

    public byte[] compress(byte[] input, int level) {
        byte[] compressed = Zstd.compress(input, normalizeLevel(level));
        return ByteBuffer.allocate(4 + compressed.length)
                .putInt(input.length).put(compressed).array();
    }

    public byte[] decompress(byte[] input) {
        ByteBuffer frame = ByteBuffer.wrap(input);
        int original = frame.getInt();
        byte[] compressed = new byte[frame.remaining()];
        frame.get(compressed);
        byte[] restored = new byte[original];
        long result = Zstd.decompress(restored, compressed);
        if (Zstd.isError(result)) throw new IllegalStateException(Zstd.getErrorName(result));
        return restored;
    }
}
