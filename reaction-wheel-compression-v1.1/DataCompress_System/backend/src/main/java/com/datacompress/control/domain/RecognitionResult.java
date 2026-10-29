package com.datacompress.control.domain;

import java.util.List;

public record RecognitionResult(
        DataModality modality,
        String format,
        String mimeType,
        boolean alreadyCompressed,
        double compressibilityScore,
        String suggestedPreprocess,
        List<String> candidateAlgorithms,
        String recommendedLevelRange,
        double confidence,
        String strategyTag,
        String reason) {
    public RecognitionResult {
        candidateAlgorithms = List.copyOf(candidateAlgorithms);
    }
}
