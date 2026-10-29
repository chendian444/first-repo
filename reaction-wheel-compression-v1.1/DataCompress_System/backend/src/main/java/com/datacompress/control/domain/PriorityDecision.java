package com.datacompress.control.domain;

public record PriorityDecision(
        DataPriority priority,
        int priorityValue,
        long deadlineEpochMs,
        long maxWaitMillis,
        boolean cacheAllowed,
        boolean batchAllowed,
        String recommendedCompressionPolicy,
        String failurePolicy,
        String reason) {
}
