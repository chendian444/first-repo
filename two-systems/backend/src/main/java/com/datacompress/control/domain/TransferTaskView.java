package com.datacompress.control.domain;

import java.util.List;

public record TransferTaskView(
        String id,
        String fileName,
        String packageKind,
        int itemCount,
        String sourceId,
        String businessScene,
        long originalBytes,
        long compressedBytes,
        double progressPercent,
        TaskState state,
        RecognitionResult recognition,
        PriorityDecision priority,
        CompressionDecision currentDecision,
        int totalChunks,
        int completedChunks,
        int retryCount,
        long queuedAtMillis,
        long startedAtMillis,
        long completedAtMillis,
        double totalCompressionMillis,
        double totalTransferMillis,
        double totalDecompressionMillis,
        boolean integrityPassed,
        String checksum,
        String message,
        List<NetworkCurvePoint> networkCurve,
        List<StrategyAdjustment> adjustments,
        List<ChunkMetric> chunks) {
    public TransferTaskView {
        packageKind = "FOLDER".equalsIgnoreCase(packageKind) ? "FOLDER" : "FILE";
        itemCount = Math.max(1, itemCount);
        networkCurve = networkCurve == null ? List.of() : List.copyOf(networkCurve);
        adjustments = adjustments == null ? List.of() : List.copyOf(adjustments);
        chunks = chunks == null ? List.of() : List.copyOf(chunks);
    }
}
