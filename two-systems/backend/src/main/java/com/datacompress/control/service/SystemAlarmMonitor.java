package com.datacompress.control.service;

import com.datacompress.control.domain.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class SystemAlarmMonitor {
    private final TransferTaskService tasks;
    private final AlarmService alarms;
    private long lastQueueAlarm;
    private long lastResourceAlarm;

    public SystemAlarmMonitor(TransferTaskService tasks, AlarmService alarms) {
        this.tasks = tasks;
        this.alarms = alarms;
    }

    @Scheduled(fixedDelay = 5000)
    public void check() {
        long now = System.currentTimeMillis();

        if ((tasks.queueSize() >= 5 || tasks.queuedBytes() >= 50L * 1024 * 1024)
                && now - lastQueueAlarm > 30000) {
            alarms.raise(AlarmLevel.WARNING, AlarmType.QUEUE_BACKLOG,
                    "SCHEDULER", null,
                    "待发送任务或缓存数据量超过阈值",
                    "检查网络状态，提高关键任务优先级并延迟普通任务");
            lastQueueAlarm = now;
        }

        Runtime runtime = Runtime.getRuntime();
        double used = runtime.totalMemory() - runtime.freeMemory();
        double ratio = used / Math.max(1.0, runtime.maxMemory()) * 100.0;
        if (ratio > 85.0 && now - lastResourceAlarm > 30000) {
            alarms.raise(AlarmLevel.MAJOR, AlarmType.RESOURCE_SHORTAGE,
                    "JVM", null,
                    "JVM 内存使用率达到 " + String.format("%.1f", ratio) + "%",
                    "暂停普通任务、减小分块或提高 JVM 最大堆内存");
            lastResourceAlarm = now;
        }
    }
}
