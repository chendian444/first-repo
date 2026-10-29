package com.datacompress.control.controller;

import com.datacompress.control.algorithm.*;
import com.datacompress.control.domain.*;
import com.datacompress.control.service.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

@RestController
@RequestMapping("/api")
public class TransferController {
    private final TransferTaskService tasks;
    private final MultimodalRecognitionService recognition;
    private final DataSourceService sources;
    private final AlgorithmRegistry algorithms;
    private final PackagePayloadService packagePayloads;

    public TransferController(TransferTaskService tasks,
                              MultimodalRecognitionService recognition,
                              DataSourceService sources,
                              AlgorithmRegistry algorithms,
                              PackagePayloadService packagePayloads) {
        this.tasks = tasks;
        this.recognition = recognition;
        this.sources = sources;
        this.algorithms = algorithms;
        this.packagePayloads = packagePayloads;
    }

    @PostMapping(value = "/tasks", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public TransferTaskView submit(
            @RequestParam(value = "files", required = false) List<MultipartFile> files,
            @RequestParam(value = "file", required = false) MultipartFile file,
            @RequestParam(value = "packageName", required = false) String packageName,
            @RequestParam(value = "packageKind", required = false) String packageKind,
            @RequestParam("sourceId") String sourceId,
            @RequestParam(value = "businessScene", defaultValue = "综合监测") String businessScene,
            @RequestParam(value = "priority", defaultValue = "AUTO") String priority,
            @RequestParam(value = "mode", defaultValue = "AUTO") String mode,
            @RequestParam(value = "algorithm", defaultValue = "ZSTD") String algorithm,
            @RequestParam(value = "level", defaultValue = "3") Integer level) {
        return tasks.submitPackage(collect(files, file), packageName, packageKind,
                sourceId, businessScene, priority, mode, algorithm, level);
    }

    @GetMapping("/tasks")
    public List<TransferTaskView> list() { return tasks.list(); }

    @GetMapping("/tasks/{id}")
    public TransferTaskView get(@PathVariable("id") String id) { return tasks.get(id); }

    @PostMapping("/tasks/{id}/retry")
    public TransferTaskView retry(@PathVariable("id") String id) { return tasks.retry(id); }

    @PostMapping("/tasks/{id}/pause")
    public TransferTaskView pause(@PathVariable("id") String id) { return tasks.pause(id); }

    @PostMapping("/tasks/{id}/resume")
    public TransferTaskView resume(@PathVariable("id") String id) { return tasks.resume(id); }

    @PostMapping("/tasks/{id}/cancel")
    public TransferTaskView cancel(@PathVariable("id") String id) { return tasks.cancel(id); }

    @GetMapping("/tasks/{id}/download/compressed")
    public ResponseEntity<byte[]> downloadCompressed(@PathVariable("id") String id) {
        String name = stripExtension(safeFileName(tasks.fileName(id))) + "-compressed.zip";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(name, StandardCharsets.UTF_8).build().toString())
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(tasks.compressedArchive(id));
    }

    @GetMapping({"/tasks/{id}/download/restored", "/tasks/{id}/download/decompressed"})
    public ResponseEntity<byte[]> downloadRestored(@PathVariable("id") String id) {
        String name = "decompressed-" + stripExtension(safeFileName(tasks.fileName(id))) + ".zip";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(name, StandardCharsets.UTF_8).build().toString())
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(tasks.restoredData(id));
    }

    @GetMapping(value = "/tasks/{id}/browse", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> browseTaskFiles(@PathVariable("id") String id) {
        TransferTaskService.PackageContent content = tasks.packageContent(id);
        String taskId = url(id);
        StringBuilder rows = new StringBuilder();
        for (TransferTaskService.PackageItem item : content.items()) {
            String itemPath = item.path();
            String href = "/api/tasks/" + taskId + "/content/file?path=" + url(itemPath);
            rows.append("<tr><td><span class=\"file-icon\">▤</span>")
                    .append(escape(itemPath))
                    .append("</td><td>").append(escape(formatBytes(item.size())))
                    .append("</td><td><a target=\"_blank\" rel=\"noopener\" href=\"")
                    .append(href).append("\">打开</a></td></tr>");
        }
        String kindText = "FOLDER".equals(content.packageKind()) ? "文件夹" : "文件";
        String location = "传输任务队列 / " + content.packageName();
        String html = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>" + escape(content.packageName()) + " - 任务文件位置</title>"
                + "<style>body{margin:0;background:#f4f7fc;color:#183066;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif}"
                + ".shell{max-width:980px;margin:36px auto;padding:0 18px}.card{background:#fff;border:1px solid #dfe8f7;border-radius:14px;box-shadow:0 10px 28px rgba(31,77,139,.08);overflow:hidden}"
                + "header{padding:22px 26px;border-bottom:1px solid #e6edf8;background:linear-gradient(90deg,#f8fbff,#eef5ff)}h1{margin:0 0 8px;font-size:22px}"
                + ".crumb{color:#657797;font-size:13px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:18px 26px}.summary div{padding:12px;border:1px solid #e5edf8;border-radius:9px;background:#fbfdff}"
                + ".summary span{display:block;color:#74849d;font-size:12px;margin-bottom:6px}.summary b{font-size:15px}table{width:calc(100% - 52px);margin:0 26px 26px;border-collapse:collapse;border:1px solid #e1e9f6}"
                + "th,td{padding:13px 14px;border-bottom:1px solid #e7edf7;text-align:left;font-size:13px}th{background:#f3f7fd}td:nth-child(2){width:130px}td:nth-child(3){width:90px}"
                + "a{color:#0868ef;font-weight:700;text-decoration:none}a:hover{text-decoration:underline}.file-icon{margin-right:8px;color:#176cf3}@media(max-width:700px){.summary{grid-template-columns:1fr 1fr}table{width:calc(100% - 24px);margin:0 12px 18px}}</style>"
                + "</head><body><div class=\"shell\"><div class=\"card\"><header><h1>" + escape(content.packageName()) + "</h1>"
                + "<div class=\"crumb\">当前位置：" + escape(location) + "</div></header>"
                + "<section class=\"summary\"><div><span>任务类型</span><b>" + kindText + "</b></div>"
                + "<div><span>任务状态</span><b>" + stateText(content.state()) + "</b></div>"
                + "<div><span>任务进度</span><b>" + String.format(Locale.ROOT, "%.1f%%", content.progressPercent()) + "</b></div>"
                + "<div><span>文件数量</span><b>" + content.itemCount() + "</b></div></section>"
                + "<table><thead><tr><th>任务包内位置</th><th>大小</th><th>操作</th></tr></thead><tbody>" + rows + "</tbody></table>"
                + "</div></div></body></html>";
        return ResponseEntity.ok()
                .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'")
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .contentType(new MediaType("text", "html", StandardCharsets.UTF_8))
                .body(html);
    }

    @GetMapping("/tasks/{id}/content/file")
    public ResponseEntity<byte[]> openTaskFile(@PathVariable("id") String id,
                                               @RequestParam(value = "path", required = false) String filePath) {
        TransferTaskService.OpenedPackageFile opened = tasks.openPackageFile(id, filePath);
        String name = opened.path().contains("/")
                ? opened.path().substring(opened.path().lastIndexOf('/') + 1)
                : opened.path();
        MediaType mediaType = safeInlineMediaType(name);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.inline()
                        .filename(safeFileName(name), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "sandbox; default-src 'none'")
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .contentType(mediaType)
                .body(opened.bytes());
    }

    private MediaType safeInlineMediaType(String fileName) {
        String lower = fileName == null ? "" : fileName.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".js")
                || lower.endsWith(".mjs") || lower.endsWith(".svg") || lower.endsWith(".xml")) {
            return new MediaType("text", "plain", StandardCharsets.UTF_8);
        }
        return MediaTypeFactory.getMediaType(fileName).orElse(MediaType.APPLICATION_OCTET_STREAM);
    }

    private String stateText(TaskState state) {
        if (state == null) return "未知";
        return switch (state) {
            case COMPLETED -> "已完成";
            case FAILED -> "失败";
            case TRANSMITTING -> "传输中";
            case VERIFYING -> "校验中";
            case QUEUED -> "排队中";
            case PROFILING -> "策略分析中";
            case WAITING_NETWORK -> "等待网络";
            case CACHED -> "已缓存";
            case RETRYING -> "补传中";
            case PAUSED -> "已暂停";
            case CANCELLED -> "已取消";
        };
    }

    private String formatBytes(long bytes) {
        double value = Math.max(0, bytes);
        if (value < 1024) return Math.round(value) + " B";
        if (value < 1024 * 1024) return String.format(Locale.ROOT, "%.2f KB", value / 1024);
        if (value < 1024 * 1024 * 1024) return String.format(Locale.ROOT, "%.2f MB", value / 1024 / 1024);
        return String.format(Locale.ROOT, "%.2f GB", value / 1024 / 1024 / 1024);
    }

    private String url(String value) {
        return URLEncoder.encode(String.valueOf(value == null ? "" : value), StandardCharsets.UTF_8)
                .replace("+", "%20");
    }

    private String escape(String value) {
        return String.valueOf(value == null ? "" : value)
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    private String safeFileName(String fileName) {
        String value = fileName == null || fileName.isBlank() ? "package" : fileName;
        return value.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    private String stripExtension(String fileName) {
        int dot = fileName.lastIndexOf('.');
        return dot > 0 ? fileName.substring(0, dot) : fileName;
    }

    @PostMapping(value = "/recognize", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public RecognitionResult recognize(@RequestParam(value = "files", required = false) List<MultipartFile> files,
                                       @RequestParam(value = "file", required = false) MultipartFile file,
                                       @RequestParam("sourceId") String sourceId,
                                       @RequestParam(value = "scene", defaultValue = "综合监测") String scene)
            throws Exception {
        DataSourceInfo source = sources.get(sourceId);
        PackagePayloadService.PackagedPayload payload = packagePayloads.build(collect(files, file));
        return recognition.recognize(payload.fileName(), payload.mimeType(),
                payload.payload(), source.type(), scene);
    }

    @GetMapping("/algorithms")
    public List<Map<String,Object>> algorithms() {
        return algorithms.all().stream().map(a -> {
            Map<String,Object> item = new LinkedHashMap<>();
            item.put("name", a.name());
            item.put("supportsLevel", a.supportsLevel());
            item.put("minLevel", a.minLevel());
            item.put("maxLevel", a.maxLevel());
            item.put("defaultLevel", a.defaultLevel());
            item.put("realtimeLevels", a.realtimeLevels());
            return item;
        }).toList();
    }

    private List<MultipartFile> collect(List<MultipartFile> files, MultipartFile file) {
        List<MultipartFile> collected = new ArrayList<>();
        if (files != null) {
            for (MultipartFile item : files) if (item != null && !item.isEmpty()) collected.add(item);
        }
        if (collected.isEmpty() && file != null && !file.isEmpty()) collected.add(file);
        if (collected.isEmpty()) throw new IllegalArgumentException("请选择待压缩的文件或目录包");
        return collected;
    }
}
