package com.datacompress.control.service;

import com.datacompress.control.algorithm.AlgorithmRegistry;
import org.springframework.stereotype.Service;

import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HexFormat;

@Service
public class ReceiverService {
    private final AlgorithmRegistry registry;

    public ReceiverService(AlgorithmRegistry registry) {
        this.registry = registry;
    }

    public ReceiveResult restore(byte[] original, byte[] compressed,
                                 String algorithm, int level) throws Exception {
        byte[] restored = registry.require(algorithm).decompress(compressed);
        boolean equal = Arrays.equals(original, restored);
        return new ReceiveResult(equal, sha256(original), sha256(restored), restored,
                equal ? "接收、解压、完整性校验成功" : "校验失败，需要补传");
    }

    public String sha256(byte[] data) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
    }

    public record ReceiveResult(boolean passed, String originalChecksum,
                                String restoredChecksum, byte[] restoredBytes, String message) {}
}
