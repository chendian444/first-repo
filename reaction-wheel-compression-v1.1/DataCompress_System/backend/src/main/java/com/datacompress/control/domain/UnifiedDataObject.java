package com.datacompress.control.domain;

import java.time.Instant;

public record UnifiedDataObject(
        String sourceId,
        String dataId,
        Instant producedAt,
        Instant accessedAt,
        String fileName,
        String mimeType,
        String businessScene,
        long originalBytes,
        String status,
        byte[] payload,
        RecognitionResult recognition,
        PriorityDecision priority) {
}
