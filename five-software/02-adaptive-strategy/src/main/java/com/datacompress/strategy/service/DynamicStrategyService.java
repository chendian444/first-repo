package com.datacompress.strategy.service;

import com.datacompress.strategy.domain.*;
import com.datacompress.strategy.StrategyInputs.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;

@Service
public class DynamicStrategyService {
    private final double switchGainPercent;

    public DynamicStrategyService(
            @Value("${app.strategy.switch-gain-percent:3.0}") double switchGainPercent) {
        this.switchGainPercent = switchGainPercent;
    }

    public CompressionDecision select(
            List<AlgorithmProfile> profiles,
            ContentHints recognition,
            SchedulingHints priority,
            LinkConditions network,
            RateBudget forecast,
            long chunkBytes,
            CompressionDecision previous,
            long heldMillis) {

        if (network.quality() == LinkGrade.DISCONNECTED) {
            boolean cache = priority.cacheAllowed();
            return new CompressionDecision("NONE", "NONE", 0,
                    chunkSize(network, priority), cache, priority.batchAllowed(),
                    sendOrder(priority), 0, 0, 0, Double.POSITIVE_INFINITY, 1.0,
                    cache ? "链路断开，任务写入缓存并保留断点" : "关键数据等待链路恢复后立即发送");
        }

        double rate = Math.max(1.0, forecast.safeRateKbps());
        CompressionDecision best = profiles.stream()
                .filter(AlgorithmProfile::available)
                .map(p -> evaluate(p, recognition, priority, network, rate, chunkBytes))
                .min(Comparator.comparingDouble(CompressionDecision::estimatedTotalMillis))
                .orElseThrow(() -> new IllegalStateException("没有可用压缩策略"));

        if (previous == null || previous.cache()) return best;
        if (previous.strategyKey().equals(best.strategyKey())) return best;

        AlgorithmProfile previousProfile = profiles.stream()
                .filter(p -> p.available() && p.algorithm().equals(previous.algorithm())
                        && p.level() == previous.level())
                .findFirst().orElse(null);
        if (previousProfile == null) return best;

        CompressionDecision current = evaluate(previousProfile, recognition, priority,
                network, rate, chunkBytes);
        double gain = (current.estimatedTotalMillis() - best.estimatedTotalMillis())
                / Math.max(0.001, current.estimatedTotalMillis()) * 100.0;

        if (heldMillis < 1000) {
            return copyWithReason(current, "尚未达到最小策略保持时间，避免频繁切换");
        }
        if (gain < switchGainPercent) {
            return copyWithReason(current, "候选策略预计收益 "
                    + String.format("%.2f", gain) + "%，未达到切换阈值");
        }
        return copyWithReason(best, best.reason() + "；相对当前策略预计节省 "
                + String.format("%.2f", gain) + "%");
    }

    private CompressionDecision evaluate(AlgorithmProfile profile,
                                         ContentHints recognition,
                                         SchedulingHints priority,
                                         LinkConditions network,
                                         double safeRateKbps,
                                         long chunkBytes) {
        long compressed = profile.compressedBytes(chunkBytes);
        double compression = profile.compressionMillis(chunkBytes);
        double transfer = compressed / 1024.0 / safeRateKbps * 1000.0;
        double decompression = profile.decompressionMillis(chunkBytes);
        double retryCost = transfer * network.packetLossPercent() / 100.0;
        double queuePenalty = priority.priority() == Urgency.CRITICAL ? 0
                : priority.priority() == Urgency.IMPORTANT ? 4 : 12;
        double total = compression + transfer + decompression + retryCost + queuePenalty;
        String preprocess = recognition.alreadyCompressed() ? "NONE" : recognition.suggestedPreprocess();
        return new CompressionDecision(preprocess, profile.algorithm(), profile.level(),
                chunkSize(network, priority), false, priority.batchAllowed(),
                sendOrder(priority), compression, transfer, decompression, total,
                profile.compressedRatio(),
                "最小化预处理、压缩、预测传输、解压、排队与重传代价");
    }

    private int chunkSize(LinkConditions network, SchedulingHints priority) {
        if (priority.priority() == Urgency.CRITICAL) {
            return switch (network.quality()) {
                case GOOD -> 512 * 1024;
                case FLUCTUATING, RECOVERING -> 256 * 1024;
                case CONGESTED, DISCONNECTED -> 128 * 1024;
            };
        }
        return switch (network.quality()) {
            case GOOD -> 512 * 1024;
            case FLUCTUATING, RECOVERING -> 256 * 1024;
            case CONGESTED, DISCONNECTED -> 64 * 1024;
        };
    }

    private int sendOrder(SchedulingHints p) {
        return switch (p.priority()) {
            case CRITICAL -> 1;
            case IMPORTANT -> 2;
            case NORMAL -> 3;
        };
    }

    private CompressionDecision copyWithReason(CompressionDecision d, String reason) {
        return new CompressionDecision(d.preprocess(), d.algorithm(), d.level(),
                d.chunkSizeBytes(), d.cache(), d.batch(), d.sendOrder(),
                d.estimatedCompressionMillis(), d.estimatedTransferMillis(),
                d.estimatedDecompressionMillis(), d.estimatedTotalMillis(),
                d.estimatedCompressedRatio(), reason);
    }
}
