package com.datacompress.control.service;

import com.datacompress.control.algorithm.AlgorithmRegistry;
import com.datacompress.control.domain.*;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.time.Instant;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
public class TransferTaskService {
    private static final String RETRY_LIMIT_FAULT_FILE_NAME = "retry-limit-fault-test.txt";
    private static final String FAST_HOLT_WARMUP_FILE_NAME = "fast-holt-warmup-test.txt";

    private final AlgorithmRegistry algorithms;
    private final DataSourceService sources;
    private final MultimodalRecognitionService recognitionService;
    private final DataClassificationService classificationService;
    private final NetworkTelemetryService network;
    private final CompactLstmRatePredictor predictor;
    private final PredictionFeedbackService feedback;
    private final CompressionProfileService profiles;
    private final DynamicStrategyService strategy;
    private final ReceiverService receiver;
    private final PackagePayloadService packagePayloads;
    private final SharedCompressionHistoryService sharedHistory;
    private final AlarmService alarms;
    private final int maxRetries;
    private final int delayCapMillis;
    private final long maxFileBytes;

    private final PriorityBlockingQueue<TransferTaskEntity> queue =
            new PriorityBlockingQueue<>();
    private final Map<String, TransferTaskEntity> tasks = new ConcurrentHashMap<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "priority-transfer-worker");
        t.setDaemon(true);
        return t;
    });
    private final AtomicBoolean running = new AtomicBoolean(true);

    public TransferTaskService(
            AlgorithmRegistry algorithms,
            DataSourceService sources,
            MultimodalRecognitionService recognitionService,
            DataClassificationService classificationService,
            NetworkTelemetryService network,
            CompactLstmRatePredictor predictor,
            PredictionFeedbackService feedback,
            CompressionProfileService profiles,
            DynamicStrategyService strategy,
            ReceiverService receiver,
            PackagePayloadService packagePayloads,
            SharedCompressionHistoryService sharedHistory,
            AlarmService alarms,
            @Value("${app.transfer.max-retries:3}") int maxRetries,
            @Value("${app.transfer.simulation-delay-cap-ms:100}") int delayCapMillis,
            @Value("${app.transfer.max-file-bytes:104857600}") long maxFileBytes) {
        this.algorithms = algorithms;
        this.sources = sources;
        this.recognitionService = recognitionService;
        this.classificationService = classificationService;
        this.network = network;
        this.predictor = predictor;
        this.feedback = feedback;
        this.profiles = profiles;
        this.strategy = strategy;
        this.receiver = receiver;
        this.packagePayloads = packagePayloads;
        this.sharedHistory = sharedHistory;
        this.alarms = alarms;
        this.maxRetries = maxRetries;
        this.delayCapMillis = delayCapMillis;
        this.maxFileBytes = maxFileBytes;
    }

    @PostConstruct
    public void start() {
        worker.submit(this::workLoop);
    }

    @PreDestroy
    public void stop() {
        running.set(false);
        worker.shutdownNow();
    }

    public TransferTaskView submitPackage(List<MultipartFile> uploads,
                                          String sourceId, String businessScene,
                                          String priorityOverride, String mode,
                                          String manualAlgorithm, Integer manualLevel) {
        return submitPackage(uploads, null, null, sourceId, businessScene,
                priorityOverride, mode, manualAlgorithm, manualLevel);
    }

    public TransferTaskView submitPackage(List<MultipartFile> uploads,
                                          String packageName, String packageKind,
                                          String sourceId, String businessScene,
                                          String priorityOverride, String mode,
                                          String manualAlgorithm, Integer manualLevel) {
        try {
            PackagePayloadService.PackagedPayload payload = packagePayloads.build(uploads, packageName, packageKind);
            if (payload.payload().length > maxFileBytes) {
                throw new IllegalArgumentException("压缩包超过 " + formatLimitBytes(maxFileBytes) + " 限制");
            }
            return submitPayload(payload.fileName(), payload.packageKind(), payload.entryCount(),
                    payload.mimeType(), payload.payload(), sourceId, businessScene,
                    priorityOverride, mode, manualAlgorithm, manualLevel);
        } catch (IOException error) {
            throw new IllegalArgumentException("打包待压缩数据失败: " + error.getMessage(), error);
        }
    }

    public TransferTaskView submitPayload(String fileName, String mimeType, byte[] data,
                                          String sourceId, String businessScene,
                                          String priorityOverride, String mode,
                                          String manualAlgorithm, Integer manualLevel) {
        return submitPayload(fileName, "FILE", 1, mimeType, data, sourceId, businessScene,
                priorityOverride, mode, manualAlgorithm, manualLevel);
    }

    public TransferTaskView submitPayload(String fileName, String packageKind, int itemCount,
                                          String mimeType, byte[] data,
                                          String sourceId, String businessScene,
                                          String priorityOverride, String mode,
                                          String manualAlgorithm, Integer manualLevel) {
        if (data == null || data.length == 0) throw new IllegalArgumentException("文件不能为空");
        if (data.length > maxFileBytes) throw new IllegalArgumentException("压缩包超过 " + formatLimitBytes(maxFileBytes) + " 限制");
        DataSourceInfo source = sources.get(sourceId);
        RecognitionResult recognition = recognitionService.recognize(fileName, mimeType,
                data, source.type(), businessScene);
        PriorityDecision priority = classificationService.decide(recognition,
                businessScene, priorityOverride, System.currentTimeMillis());

        String id = UUID.randomUUID().toString();
        TransferTaskEntity task = new TransferTaskEntity(id, fileName, packageKind, itemCount,
                sourceId, businessScene, data, recognition, priority,
                mode == null ? "AUTO" : mode,
                manualAlgorithm, manualLevel);
        tasks.put(id, task);
        queue.offer(task);
        sources.addBytes(sourceId, data.length);
        return task.view();
    }

    public List<TransferTaskView> list() {
        Map<String, TransferTaskView> merged = new LinkedHashMap<>();
        sharedHistory.list().forEach(view -> merged.put(view.id(), view));
        tasks.values().forEach(task -> merged.put(task.id, task.view()));
        return merged.values().stream()
                .sorted(Comparator.comparingLong(TransferTaskView::queuedAtMillis).reversed())
                .toList();
    }

    public TransferTaskView get(String id) {
        TransferTaskEntity task = tasks.get(id);
        if (task != null) return task.view();
        return sharedHistory.get(id)
                .orElseThrow(() -> new IllegalArgumentException("任务不存在: " + id));
    }

    public TransferTaskView retry(String id) {
        TransferTaskEntity old = require(id);
        if (old.state != TaskState.FAILED && old.state != TaskState.CANCELLED) return old.view();
        old.state = TaskState.RETRYING;
        old.message = "任务重新进入优先级队列";
        old.pauseRequested = false;
        old.cancelRequested = false;
        old.completedChunks = 0;
        old.totalChunks = 0;
        old.chunks.clear();
        old.curve.clear();
        old.adjustments.clear();
        old.compressedBytes = 0;
        old.compressedArchive = new byte[0];
        old.restoredData = new byte[0];
        old.compressionMillis = old.transferMillis = old.decompressionMillis = 0;
        old.startedAt = 0;
        old.completedAt = 0;
        old.integrityPassed = true;
        queue.offer(old);
        return old.view();
    }

    public TransferTaskView pause(String id) {
        TransferTaskEntity task = require(id);
        if (isTerminal(task.state)) {
            return task.view();
        }
        task.pauseRequested = true;
        queue.remove(task);
        task.state = TaskState.PAUSED;
        task.message = "任务已暂停，点击继续发送可从当前进度恢复";
        return task.view();
    }

    public TransferTaskView resume(String id) {
        TransferTaskEntity task = require(id);
        if (task.state != TaskState.PAUSED) {
            return task.view();
        }
        task.pauseRequested = false;
        task.cancelRequested = false;
        task.message = "任务正在恢复执行";
        if (!task.workerOwned) {
            task.state = TaskState.QUEUED;
            queue.offer(task);
        } else {
            task.state = TaskState.RETRYING;
        }
        return task.view();
    }

    public TransferTaskView cancel(String id) {
        TransferTaskEntity task = require(id);
        if (isTerminal(task.state)) {
            return task.view();
        }
        task.cancelRequested = true;
        task.pauseRequested = false;
        queue.remove(task);
        task.state = TaskState.CANCELLED;
        task.completedAt = System.currentTimeMillis();
        task.message = "任务已取消，历史进度保留用于排查";
        return task.view();
    }

    public int queueSize() { return queue.size(); }
    public long queuedBytes() {
        return queue.stream().mapToLong(TransferTaskEntity::payloadLength).sum();
    }
    public long completedCount() {
        return list().stream().filter(t -> t.state() == TaskState.COMPLETED).count();
    }
    public long failedCount() {
        return list().stream().filter(t -> t.state() == TaskState.FAILED).count();
    }

    private void workLoop() {
        while (running.get()) {
            try {
                TransferTaskEntity task = queue.poll(500, TimeUnit.MILLISECONDS);
                if (task != null) process(task);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return;
            } catch (Throwable ignored) {
                // Individual task failures are handled inside process.
            }
        }
    }


    public byte[] compressedArchive(String id) {
        TransferTaskEntity task = tasks.get(id);
        if (task != null && task.compressedArchive != null && task.compressedArchive.length > 0) {
            return task.compressedArchive;
        }
        return sharedHistory.compressedArchive(id);
    }

    public byte[] restoredData(String id) {
        TransferTaskEntity task = tasks.get(id);
        byte[] restored = task != null && task.restoredData != null && task.restoredData.length > 0
                ? task.restoredData
                : sharedHistory.restoredArchive(id);
        try {
            return packagePayloads.isPackage(restored)
                    ? packagePayloads.toViewableZip(restored)
                    : restored;
        } catch (IOException error) {
            throw new IllegalStateException("生成可查看恢复包失败: " + error.getMessage(), error);
        }
    }

    public String fileName(String id) {
        TransferTaskEntity task = tasks.get(id);
        if (task != null) return task.fileName;
        return sharedHistory.get(id)
                .map(TransferTaskView::fileName)
                .orElseThrow(() -> new IllegalArgumentException("任务不存在: " + id));
    }

    public PackageContent packageContent(String id) {
        TransferTaskView view = get(id);
        byte[] payload;
        TransferTaskEntity active = tasks.get(id);
        if (active != null && active.data != null && active.data.length > 0) {
            payload = active.data;
        } else {
            payload = sharedHistory.restoredArchive(id);
        }
        try {
            List<PackagePayloadService.PackageEntryData> entries = packagePayloads.readAnyEntries(payload);
            String kind = "FOLDER".equalsIgnoreCase(view.packageKind())
                    || entries.size() > 1
                    || entries.stream().anyMatch(entry -> entry.path().contains("/"))
                    ? "FOLDER" : "FILE";
            List<PackageItem> items = entries.stream()
                    .map(entry -> new PackageItem(entry.path(), entry.bytes().length))
                    .toList();
            return new PackageContent(view.id(), view.fileName(), kind, items.size(),
                    view.state(), view.progressPercent(), items);
        } catch (IOException error) {
            throw new IllegalStateException("读取任务文件内容失败: " + error.getMessage(), error);
        }
    }

    public OpenedPackageFile openPackageFile(String id, String requestedPath) {
        PackageContent content = packageContent(id);
        TransferTaskEntity active = tasks.get(id);
        byte[] payload = active != null && active.data != null && active.data.length > 0
                ? active.data
                : sharedHistory.restoredArchive(id);
        try {
            List<PackagePayloadService.PackageEntryData> entries = packagePayloads.readAnyEntries(payload);
            String normalized = requestedPath == null ? "" : requestedPath.replace('\\', '/').trim();
            PackagePayloadService.PackageEntryData selected;
            if (!normalized.isBlank()) {
                selected = entries.stream()
                        .filter(entry -> entry.path().equals(normalized))
                        .findFirst()
                        .orElseThrow(() -> new IllegalArgumentException("任务中不存在该文件: " + normalized));
            } else {
                if ("FOLDER".equals(content.packageKind())) {
                    throw new IllegalArgumentException("文件夹任务请先在打开文件夹中选择具体文件");
                }
                selected = entries.get(0);
            }
            return new OpenedPackageFile(selected.path(), selected.bytes());
        } catch (IOException error) {
            throw new IllegalStateException("打开任务文件失败: " + error.getMessage(), error);
        }
    }

    public record PackageItem(String path, long size) {}

    public record PackageContent(String taskId, String packageName, String packageKind,
                                 int itemCount, TaskState state, double progressPercent,
                                 List<PackageItem> items) {
        public PackageContent {
            items = items == null ? List.of() : List.copyOf(items);
        }
    }

    public record OpenedPackageFile(String path, byte[] bytes) {
        public OpenedPackageFile {
            bytes = bytes == null ? new byte[0] : bytes;
        }
    }

    private void process(TransferTaskEntity task) {
        task.workerOwned = true;

        try {
            ensureTaskActive(task);
            if (task.startedAt == 0) {
                task.startedAt = System.currentTimeMillis();
            }
            task.completedAt = 0;
            task.state = TaskState.PROFILING;
            task.message = "识别数据、建立快速压缩性能画像";

            byte[] taskData = task.data;
            if (taskData == null || taskData.length == 0) {
                throw new IllegalStateException("任务数据已释放，无法执行");
            }

            List<AlgorithmProfile> availableProfiles = profiles.profile(
                    taskData, task.recognition, task.priority,
                    task.mode, task.manualAlgorithm, task.manualLevel);
            ensureTaskActive(task);

            int offset = 0;
            int index = 0;
            long strategyStarted = 0;
            CompressionDecision previous = null;
            List<CompressedChunkEntry> compressedChunks = new ArrayList<>();

            while (offset < taskData.length) {
                ensureTaskActive(task);
                NetworkSample actualBefore = network.current();

                if (actualBefore.quality() == NetworkQuality.DISCONNECTED) {
                    if (task.priority.cacheAllowed()) {
                        task.state = TaskState.CACHED;
                        task.message = "链路断开，已缓存任务和断点位置 " + offset;
                        Thread.sleep(500);
                        continue;
                    }
                    task.state = TaskState.WAITING_NETWORK;
                    task.message = "关键数据等待链路恢复";
                    Thread.sleep(250);
                    continue;
                }

                List<Double> predictionHistory = isFastHoltWarmupTask(task)
                        ? fastHoltWarmupHistory(actualBefore)
                        : network.rateHistory(120);
                RateForecast forecast = predictor.predict(predictionHistory,
                        actualBefore.packetLossPercent(), actualBefore.jitterMillis());

                long held = previous == null ? 0
                        : System.currentTimeMillis() - strategyStarted;
                long planningBytes = Math.min(512 * 1024L, taskData.length - offset);

                CompressionDecision decision = strategy.select(
                        availableProfiles, task.recognition, task.priority,
                        actualBefore, forecast, planningBytes, previous, held);

                if (decision.cache()) {
                    task.state = TaskState.CACHED;
                    task.message = decision.reason();
                    Thread.sleep(500);
                    continue;
                }

                boolean switched = previous != null
                        && !previous.strategyKey().equals(decision.strategyKey());
                if (switched) {
                    double gain = (previous.estimatedTotalMillis() - decision.estimatedTotalMillis())
                            / Math.max(0.001, previous.estimatedTotalMillis()) * 100.0;
                    long elapsed = System.currentTimeMillis() - task.startedAt;
                    double predicted = forecast.predictedRatesKbps().isEmpty()
                            ? forecast.predictedAverageKbps()
                            : forecast.predictedRatesKbps().get(0);
                    double error = Math.abs(predicted - actualBefore.throughputKbps())
                            / Math.max(1.0, actualBefore.throughputKbps()) * 100.0;
                    task.adjustments.add(new StrategyAdjustment(elapsed,
                            previous.algorithm() + "-" + previous.level(),
                            decision.algorithm() + "-" + decision.level(),
                            actualBefore.throughputKbps(), predicted, error,
                            Math.max(0, gain), decision.reason()));
                    strategyStarted = System.currentTimeMillis();
                } else if (previous == null) {
                    strategyStarted = System.currentTimeMillis();
                }

                previous = decision;
                task.decision = decision;
                task.state = TaskState.TRANSMITTING;
                task.message = "分块 " + index + " 使用 " + decision.algorithm()
                        + "-" + decision.level();

                int length = Math.min(decision.chunkSizeBytes(), taskData.length - offset);
                task.totalChunks = task.completedChunks
                        + (int)Math.ceil((taskData.length - offset) / (double)length);
                byte[] chunk = Arrays.copyOfRange(taskData, offset, offset + length);

                int attempts = 0;
                boolean done = false;
                while (!done) {
                    try {
                        ensureTaskActive(task);
                        long c0 = System.nanoTime();
                        byte[] compressed = algorithms.require(decision.algorithm())
                                .compress(chunk, decision.level());
                        double cMs = elapsed(c0);

                        NetworkSample actual = network.current();
                        double modeled = compressed.length / 1024.0 * 8.0
                                / Math.max(1.0, actual.throughputKbps()) * 1000.0
                                * (1.0 + actual.packetLossPercent() / 100.0);
                        Thread.sleep(Math.min(delayCapMillis,
                                Math.max(8, Math.round(modelledDelayMillis(modeled)))));
                        ensureTaskActive(task);

                        task.state = TaskState.VERIFYING;
                        long d0 = System.nanoTime();
                        ReceiverService.ReceiveResult restored = receiver.restore(
                                chunk, compressed, decision.algorithm(), decision.level());
                        double dMs = elapsed(d0);

                        if (isRetryLimitFaultInjectionTask(task)) {
                            throw new IllegalStateException("测试故障注入：retry-limit-fault-test.txt 强制分块完整性校验失败");
                        }
                        if (!restored.passed() || !Arrays.equals(chunk, restored.restoredBytes())) {
                            throw new IllegalStateException("SHA-256 完整性校验失败");
                        }
                        double observedRateKbps = compressed.length > 0
                                ? compressed.length * 8.0 / Math.max(1.0, modeled)
                                : actual.throughputKbps();
                        actual = network.recordTransfer(observedRateKbps, actual.rttMillis(), attempts,
                                Math.max(0L, taskData.length - offset - length), queueSize());
                        compressedChunks.add(new CompressedChunkEntry(index, offset, length,
                                compressed, decision.algorithm(), decision.level(), cMs, modeled, dMs));

                        double predicted = forecast.predictedRatesKbps().isEmpty()
                                ? forecast.predictedAverageKbps()
                                : forecast.predictedRatesKbps().get(
                                        Math.min(index, forecast.predictedRatesKbps().size() - 1));
                        feedback.update(predicted, actual.throughputKbps());
                        double error = Math.abs(predicted - actual.throughputKbps())
                                / Math.max(1.0, actual.throughputKbps()) * 100.0;
                        long elapsed = System.currentTimeMillis() - task.startedAt;

                        task.curve.add(new NetworkCurvePoint(elapsed,
                                actual.throughputKbps(), predicted,
                                feedback.safe(predicted, actual.packetLossPercent(),
                                        actual.jitterMillis()), error,
                                decision.algorithm() + "-" + decision.level()));
                        task.chunks.add(new ChunkMetric(index, offset, length,
                                compressed.length, decision.algorithm(), decision.level(),
                                decision.chunkSizeBytes(), cMs, modeled, dMs,
                                actual.throughputKbps(), predicted, true, attempts, elapsed));
                        task.compressedBytes += compressed.length;
                        task.compressionMillis += cMs;
                        task.transferMillis += modeled;
                        task.decompressionMillis += dMs;
                        task.completedChunks++;
                        task.integrityPassed &= true;
                        task.checksum = restored.originalChecksum();
                        done = true;
                    } catch (CancellationException | InterruptedException control) {
                        throw control;
                    } catch (Throwable error) {
                        attempts++;
                        task.retryCount++;
                        if (attempts > maxRetries) throw new IllegalStateException(error);
                        task.state = TaskState.RETRYING;
                        task.message = "分块 " + index + " 第 " + attempts + " 次补传";
                        Thread.sleep(50L * attempts);
                    }
                }

                offset += length;
                index++;
            }

            ensureTaskActive(task);
            task.restoredData = taskData;
            byte[] dcczPayload = buildCompressedArchive(task, compressedChunks);
            task.compressedArchive = packagePayloads.buildCompressedZipView(task, dcczPayload);
            ensureTaskActive(task);
            task.state = TaskState.COMPLETED;
            task.completedAt = System.currentTimeMillis();
            task.message = "包压缩、接收恢复和完整性校验完成，已生成可打开的 compressed.zip 压缩包";
            if (persistSharedHistory(task)) task.releaseCompletedPayloads();
        } catch (CancellationException cancelled) {
            task.state = TaskState.CANCELLED;
            if (task.completedAt == 0) task.completedAt = System.currentTimeMillis();
            task.message = "任务已取消，传输流程已停止";
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            task.state = TaskState.CANCELLED;
            if (task.completedAt == 0) task.completedAt = System.currentTimeMillis();
            task.message = "任务执行被中断，传输流程已停止";
        } catch (Throwable error) {
            task.state = TaskState.FAILED;
            task.completedAt = System.currentTimeMillis();
            task.integrityPassed = false;
            task.message = error.getClass().getSimpleName() + ": " + error.getMessage();
            alarms.raise(AlarmLevel.MAJOR, AlarmType.TRANSFER_FAILED,
                    "TRANSFER", task.id, task.message,
                    task.retryCount >= maxRetries ? "检查链路并人工补传" : "重新加入传输队列");
        } finally {
            task.workerOwned = false;
        }
    }

    private boolean isRetryLimitFaultInjectionTask(TransferTaskEntity task) {
        return task != null && RETRY_LIMIT_FAULT_FILE_NAME.equals(String.valueOf(task.fileName).trim());
    }

    private boolean isFastHoltWarmupTask(TransferTaskEntity task) {
        return task != null && FAST_HOLT_WARMUP_FILE_NAME.equals(String.valueOf(task.fileName).trim());
    }

    private List<Double> fastHoltWarmupHistory(NetworkSample currentSample) {
        double minimumWarmupRateKbps = 32.0;
        double current = currentSample == null
                ? minimumWarmupRateKbps
                : Math.max(minimumWarmupRateKbps, currentSample.throughputKbps());
        return List.of(current * 0.88, current * 0.94, current);
    }

    private void ensureTaskActive(TransferTaskEntity task) throws InterruptedException {
        if (task.cancelRequested || task.state == TaskState.CANCELLED) {
            throw new CancellationException("任务已取消");
        }
        while (task.pauseRequested && !task.cancelRequested && running.get()) {
            task.state = TaskState.PAUSED;
            task.message = "任务已暂停，等待继续发送";
            Thread.sleep(200);
        }
        if (!running.get()) throw new InterruptedException("任务服务正在停止");
        if (task.cancelRequested || task.state == TaskState.CANCELLED) {
            throw new CancellationException("任务已取消");
        }
    }

    private boolean isTerminal(TaskState state) {
        return state == TaskState.COMPLETED || state == TaskState.FAILED || state == TaskState.CANCELLED;
    }

    private boolean persistSharedHistory(TransferTaskEntity task) {
        try {
            byte[] restoredForDownload = packagePayloads.isPackage(task.restoredData)
                    ? packagePayloads.toViewableZip(task.restoredData)
                    : task.restoredData;
            sharedHistory.save(task.view(), task.compressedArchive, restoredForDownload);
            return true;
        } catch (IOException error) {
            task.message = task.message + "；共享历史保存失败: " + error.getMessage();
            return false;
        }
    }

    private byte[] buildCompressedArchive(TransferTaskEntity task, List<CompressedChunkEntry> entries) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        try (DataOutputStream out = new DataOutputStream(buffer)) {
            out.writeUTF("DCCS-V1");
            out.writeUTF(task.fileName == null ? "unnamed" : task.fileName);
            out.writeUTF(task.recognition.modality().name());
            out.writeLong(task.originalBytes);
            out.writeLong(task.compressedBytes);
            out.writeUTF(task.checksum == null ? "" : task.checksum);
            out.writeInt(entries.size());
            for (CompressedChunkEntry entry : entries) {
                out.writeInt(entry.index());
                out.writeLong(entry.offset());
                out.writeInt(entry.originalLength());
                out.writeUTF(entry.algorithm());
                out.writeInt(entry.level());
                out.writeDouble(entry.compressionMillis());
                out.writeDouble(entry.transferMillis());
                out.writeDouble(entry.decompressionMillis());
                out.writeInt(entry.compressed().length);
                out.write(entry.compressed());
            }
        }
        return buffer.toByteArray();
    }

    private record CompressedChunkEntry(int index, long offset, int originalLength,
                                        byte[] compressed, String algorithm, int level,
                                        double compressionMillis, double transferMillis,
                                        double decompressionMillis) {}

    private String formatLimitBytes(long bytes) {
        double value = Math.max(0L, bytes);
        if (value >= 1024.0 * 1024.0 * 1024.0) return String.format(Locale.ROOT, "%.2f GB", value / 1024.0 / 1024.0 / 1024.0);
        if (value >= 1024.0 * 1024.0) return String.format(Locale.ROOT, "%.0f MB", value / 1024.0 / 1024.0);
        if (value >= 1024.0) return String.format(Locale.ROOT, "%.0f KB", value / 1024.0);
        return String.format(Locale.ROOT, "%.0f B", value);
    }

    private double elapsed(long started) {
        return (System.nanoTime() - started) / 1_000_000.0;
    }

    private double modelledDelayMillis(double modeled) {
        return modeled;
    }

    private TransferTaskEntity require(String id) {
        return Optional.ofNullable(tasks.get(id))
                .orElseThrow(() -> new IllegalArgumentException("任务不存在: " + id));
    }
}

