package com.datacompress.control.service;

import com.datacompress.control.domain.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class NetworkAlarmMonitor {
    private final NetworkTelemetryService network;
    private final AlarmService alarms;
    private NetworkQuality lastQuality = NetworkQuality.GOOD;
    private long lastRaised;

    public NetworkAlarmMonitor(NetworkTelemetryService network, AlarmService alarms) {
        this.network = network;
        this.alarms = alarms;
    }

    @Scheduled(fixedDelay = 2000)
    public void check() {
        NetworkSample n = network.current();
        if (!n.externallyMeasured()) {
            lastQuality = n.quality();
            return;
        }
        long now = System.currentTimeMillis();
        if (n.quality() != lastQuality && now - lastRaised > 60_000) {
            if (n.quality() == NetworkQuality.DISCONNECTED) {
                alarms.raise(AlarmLevel.CRITICAL, AlarmType.DISCONNECTED, "NETWORK", null,
                        "网络连接中断，普通任务已进入缓存等待", "检查链路并优先恢复关键数据通道");
                lastRaised = now;
            } else if (n.quality() == NetworkQuality.CONGESTED) {
                alarms.raise(AlarmLevel.MAJOR, AlarmType.LOW_BANDWIDTH, "NETWORK", null,
                        "网络拥塞：吞吐率 " + String.format("%.1f", n.throughputKbps()) + " KB/s",
                        "减小分块并暂停普通任务");
                lastRaised = now;
            } else if (n.packetLossPercent() > 3) {
                alarms.raise(AlarmLevel.WARNING, AlarmType.HIGH_PACKET_LOSS, "NETWORK", null,
                        "丢包率升高到 " + String.format("%.2f", n.packetLossPercent()) + "%",
                        "降低安全传输速率并检查链路质量");
                lastRaised = now;
            }
            lastQuality = n.quality();
        }
    }
}
