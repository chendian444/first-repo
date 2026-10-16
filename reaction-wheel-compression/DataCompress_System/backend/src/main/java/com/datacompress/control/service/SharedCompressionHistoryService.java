
package com.datacompress.control.service;

import com.datacompress.control.domain.TransferTaskView;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Stream;

@Service
public class SharedCompressionHistoryService {
    private static final Logger log = LoggerFactory.getLogger(SharedCompressionHistoryService.class);
    private final ObjectMapper objectMapper;
    private final Path historyRoot;
    private final Map<String, TransferTaskView> views = new ConcurrentHashMap<>();
    private final Map<String, Path> compressedArchives = new ConcurrentHashMap<>();
    private final Map<String, Path> restoredArchives = new ConcurrentHashMap<>();

    public SharedCompressionHistoryService(ObjectMapper objectMapper,
                                           @Value("${app.history.dir:data/history}") String historyDir) {
        this.objectMapper = objectMapper;
        this.historyRoot = Path.of(historyDir).toAbsolutePath().normalize();
    }

    @PostConstruct
    public void load() {
        try {
            Files.createDirectories(historyRoot);
            try (Stream<Path> children = Files.list(historyRoot)) {
                children.filter(Files::isDirectory).forEach(this::loadOne);
            }
            log.info("Loaded {} shared compression history task(s) from {}", views.size(), historyRoot);
        } catch (IOException error) {
            log.warn("Unable to load shared compression history from {}: {}", historyRoot, error.getMessage());
        }
    }

    public void save(TransferTaskView view, byte[] compressedArchive, byte[] restoredArchive) throws IOException {
        if (view == null || view.id() == null || view.id().isBlank()) return;
        Path taskDir = historyRoot.resolve(safeId(view.id()));
        Files.createDirectories(taskDir);
        Path metadata = taskDir.resolve("task.json");
        Path compressed = taskDir.resolve("compressed.zip");
        Path restored = taskDir.resolve("restored.zip");

        objectMapper.writerWithDefaultPrettyPrinter().writeValue(metadata.toFile(), view);
        Files.write(compressed, compressedArchive == null ? new byte[0] : compressedArchive);
        Files.write(restored, restoredArchive == null ? new byte[0] : restoredArchive);

        views.put(view.id(), view);
        compressedArchives.put(view.id(), compressed);
        restoredArchives.put(view.id(), restored);
    }

    public List<TransferTaskView> list() {
        return new ArrayList<>(views.values()).stream()
                .sorted(Comparator.comparingLong(TransferTaskView::queuedAtMillis).reversed())
                .toList();
    }

    public Optional<TransferTaskView> get(String id) {
        return Optional.ofNullable(views.get(id));
    }

    public byte[] compressedArchive(String id) {
        return readArchive(id, compressedArchives, "压缩历史文件不存在: ");
    }

    public byte[] restoredArchive(String id) {
        return readArchive(id, restoredArchives, "恢复历史文件不存在: ");
    }

    private byte[] readArchive(String id, Map<String, Path> archiveMap, String missingMessage) {
        Path path = archiveMap.get(id);
        if (path == null || !Files.exists(path)) {
            throw new IllegalArgumentException(missingMessage + id);
        }
        try {
            return Files.readAllBytes(path);
        } catch (IOException error) {
            throw new IllegalStateException("读取共享历史文件失败: " + error.getMessage(), error);
        }
    }

    private void loadOne(Path taskDir) {
        Path metadata = taskDir.resolve("task.json");
        Path compressed = taskDir.resolve("compressed.zip");
        Path restored = taskDir.resolve("restored.zip");
        if (!Files.exists(metadata)) return;
        try {
            TransferTaskView view = objectMapper.readValue(metadata.toFile(), TransferTaskView.class);
            views.put(view.id(), view);
            if (Files.exists(compressed)) compressedArchives.put(view.id(), compressed);
            if (Files.exists(restored)) restoredArchives.put(view.id(), restored);
        } catch (IOException error) {
            log.warn("Skipping damaged compression history item {}: {}", taskDir, error.getMessage());
        }
    }

    private String safeId(String id) {
        return id.replaceAll("[^A-Za-z0-9._-]", "_");
    }
}
