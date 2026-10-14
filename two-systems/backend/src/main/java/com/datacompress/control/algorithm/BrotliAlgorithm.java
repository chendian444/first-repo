package com.datacompress.control.algorithm;

import com.aayushatharva.brotli4j.Brotli4jLoader;
import com.aayushatharva.brotli4j.decoder.*;
import com.aayushatharva.brotli4j.encoder.Encoder;
import org.springframework.stereotype.Component;
import java.util.List;

@Component
public class BrotliAlgorithm extends BaseAlgorithm {
    public BrotliAlgorithm() { super("BROTLI", true, 0, 11, 5, List.of(3, 6)); }

    public byte[] compress(byte[] input, int level) throws Exception {
        Brotli4jLoader.ensureAvailability();
        return Encoder.compress(input, Encoder.Parameters.create(normalizeLevel(level)));
    }

    public byte[] decompress(byte[] input) throws Exception {
        Brotli4jLoader.ensureAvailability();
        DirectDecompress result = Decoder.decompress(input);
        if (result.getResultStatus() != DecoderJNI.Status.DONE) {
            throw new IllegalStateException("Brotli status: " + result.getResultStatus());
        }
        return result.getDecompressedData();
    }
}
