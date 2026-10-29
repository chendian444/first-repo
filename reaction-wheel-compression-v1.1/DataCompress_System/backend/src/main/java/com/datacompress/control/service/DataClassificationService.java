package com.datacompress.control.service;

import com.datacompress.control.domain.*;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Locale;

@Service
public class DataClassificationService {
    public PriorityDecision decide(RecognitionResult recognition, String scene,
                                   String override, long producedAtMillis) {
        DataPriority priority;
        if (override != null && !override.isBlank() && !"AUTO".equalsIgnoreCase(override)) {
            priority = DataPriority.valueOf(override.toUpperCase(Locale.ROOT));
        } else if (recognition.modality() == DataModality.ALARM_EVENT
                || recognition.modality() == DataModality.CONTROL_MESSAGE) {
            priority = DataPriority.CRITICAL;
        } else if (recognition.modality() == DataModality.DEVICE_OPERATION
                || recognition.modality() == DataModality.NUMERIC_TIME_SERIES) {
            priority = DataPriority.IMPORTANT;
        } else {
            priority = DataPriority.NORMAL;
        }

        long now = Instant.now().toEpochMilli();
        long maxWait = switch (priority) {
            case CRITICAL -> 1000L;
            case IMPORTANT -> 10000L;
            case NORMAL -> 120000L;
        };
        int value = switch (priority) {
            case CRITICAL -> 100;
            case IMPORTANT -> 60;
            case NORMAL -> 20;
        };
        boolean cache = priority != DataPriority.CRITICAL;
        boolean batch = priority == DataPriority.NORMAL;
        String compression = switch (priority) {
            case CRITICAL -> "不压缩或 LZ4/SNAPPY/ZSTD-1 快速压缩";
            case IMPORTANT -> "LZ4/ZSTD/GZIP 平衡策略";
            case NORMAL -> "允许缓存、批量与较高压缩级别";
        };
        String failure = priority == DataPriority.CRITICAL
                ? "立即重传并触发严重告警"
                : priority == DataPriority.IMPORTANT
                ? "优先补传，超过截止时间告警"
                : "缓存后按优先级延迟补传";

        return new PriorityDecision(priority, value, now + maxWait, maxWait,
                cache, batch, compression, failure,
                "依据数据模态、业务场景和管理员覆盖规则分级");
    }
}
