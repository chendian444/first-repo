package com.datacompress.control.service;

import com.datacompress.control.domain.*;

import java.util.*;

final class TransferTaskEntity implements Comparable<TransferTaskEntity> {
    private static final int MAX_VIEW_CHUNKS = 2000;

    final String id;
    final String fileName;
    final String packageKind;
    final int itemCount;
    final String sourceId;
    final String businessScene;
    volatile byte[] data;
    final long originalBytes;
    final RecognitionResult recognition;
    final PriorityDecision priority;
    final String mode;
    final String manualAlgorithm;
    final Integer manualLevel;
    final long queuedAt = System.currentTimeMillis();

    volatile TaskState state = TaskState.QUEUED;
    volatile CompressionDecision decision;
    volatile int completedChunks;
    volatile int totalChunks;
    volatile int retryCount;
    volatile long startedAt;
    volatile long completedAt;
    volatile long compressedBytes;
    volatile double compressionMillis;
    volatile double transferMillis;
    volatile double decompressionMillis;
    volatile boolean integrityPassed = true;
    volatile boolean pauseRequested;
    volatile boolean cancelRequested;
    volatile boolean workerOwned;
    volatile String checksum = "";
    volatile String message = "等待调度";
    volatile byte[] compressedArchive = new byte[0];
    volatile byte[] restoredData = new byte[0];

    final List<NetworkCurvePoint> curve = Collections.synchronizedList(new ArrayList<>());
    final List<StrategyAdjustment> adjustments = Collections.synchronizedList(new ArrayList<>());
    final List<ChunkMetric> chunks = Collections.synchronizedList(new ArrayList<>());

    TransferTaskEntity(String id, String fileName, String packageKind, int itemCount,
                       String sourceId, String businessScene,
                       byte[] data, RecognitionResult recognition, PriorityDecision priority,
                       String mode, String manualAlgorithm, Integer manualLevel) {
        this.id = id;
        this.fileName = fileName;
        this.packageKind = "FOLDER".equalsIgnoreCase(packageKind) ? "FOLDER" : "FILE";
        this.itemCount = Math.max(1, itemCount);
        this.sourceId = sourceId;
        this.businessScene = businessScene;
        this.data = data;
        this.originalBytes = data == null ? 0 : data.length;
        this.recognition = recognition;
        this.priority = priority;
        this.mode = mode;
        this.manualAlgorithm = manualAlgorithm;
        this.manualLevel = manualLevel;
    }

    TransferTaskView view() {
        List<NetworkCurvePoint> curveSnapshot = snapshot(curve);
        List<StrategyAdjustment> adjustmentSnapshot = snapshot(adjustments);
        List<ChunkMetric> chunkSnapshot = snapshot(chunks);
        double progress = originalBytes == 0 ? 100 :
                Math.min(100, chunkSnapshot.stream().mapToLong(ChunkMetric::originalBytes).sum()
                        * 100.0 / originalBytes);
        return new TransferTaskView(id, fileName, packageKind, itemCount, sourceId, businessScene, originalBytes,
                compressedBytes, progress, state, recognition, priority, decision,
                totalChunks, completedChunks, retryCount, queuedAt, startedAt, completedAt,
                compressionMillis, transferMillis, decompressionMillis, integrityPassed,
                checksum, message, curveSnapshot, adjustmentSnapshot, compactChunkMetrics(chunkSnapshot));
    }

    private static <T> List<T> snapshot(List<T> values) {
        synchronized (values) {
            return new ArrayList<>(values);
        }
    }

    private static List<ChunkMetric> compactChunkMetrics(List<ChunkMetric> values) {
        if (values.size() <= MAX_VIEW_CHUNKS) return values;
        List<ChunkMetric> compact = new ArrayList<>(MAX_VIEW_CHUNKS);
        int stride = (int) Math.ceil(values.size() / (double) MAX_VIEW_CHUNKS);
        for (int i = 0; i < values.size(); i += stride) {
            compact.add(values.get(i));
        }
        ChunkMetric last = values.get(values.size() - 1);
        if (compact.isEmpty() || compact.get(compact.size() - 1).chunkIndex() != last.chunkIndex()) {
            compact.add(last);
        }
        return compact;
    }
    long payloadLength() {
        return data == null ? originalBytes : data.length;
    }

    void releaseCompletedPayloads() {
        if (state != TaskState.COMPLETED) return;
        data = null;
        compressedArchive = new byte[0];
        restoredData = new byte[0];
    }
    @Override
    public int compareTo(TransferTaskEntity other) {
        int priorityCompare = Integer.compare(other.priority.priorityValue(),
                priority.priorityValue());
        if (priorityCompare != 0) return priorityCompare;
        int deadlineCompare = Long.compare(priority.deadlineEpochMs(),
                other.priority.deadlineEpochMs());
        return deadlineCompare != 0 ? deadlineCompare : Long.compare(queuedAt, other.queuedAt);
    }
}
