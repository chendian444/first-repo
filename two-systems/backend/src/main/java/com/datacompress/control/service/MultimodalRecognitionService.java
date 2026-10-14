package com.datacompress.control.service;

import com.datacompress.control.domain.*;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.*;

@Service
public class MultimodalRecognitionService {
    private static final Set<String> COMPRESSED =
            Set.of("jpg","jpeg","png","gif","webp","mp4","avi","mov","mkv","zip","gz","7z","rar","xz");

    public RecognitionResult recognize(String fileName, String mimeType, byte[] payload,
                                       String sourceType, String businessScene) {
        String ext = extension(fileName);
        String mime = mimeType == null ? "application/octet-stream" : mimeType.toLowerCase(Locale.ROOT);
        byte[] head = Arrays.copyOf(payload, Math.min(payload.length, 4096));
        String text = new String(head, StandardCharsets.UTF_8);
        DataModality modality;
        double confidence;
        String format = ext.isBlank() ? detectMagic(head) : ext.toUpperCase(Locale.ROOT);
        boolean alreadyCompressed = COMPRESSED.contains(ext) || magicCompressed(head);

        if (isDccsPackage(fileName, mime)) {
            modality = DataModality.PACKAGE_DATA; confidence = 0.94;
            alreadyCompressed = false;
            format = "DCCPKG";
        } else if (containsAlarm(text, fileName, businessScene)) {
            modality = DataModality.ALARM_EVENT; confidence = 0.93;
        } else if (containsControl(text, fileName, businessScene)) {
            modality = DataModality.CONTROL_MESSAGE; confidence = 0.91;
        } else if (mime.startsWith("image/") || mime.startsWith("video/") || COMPRESSED.contains(ext)) {
            modality = DataModality.IMAGE_VIDEO; confidence = 0.97;
        } else if (Set.of("csv","tsv").contains(ext) || looksDelimited(text)) {
            modality = DataModality.NUMERIC_TIME_SERIES; confidence = 0.88;
        } else if (Set.of("log","txt","json","xml").contains(ext) || printableRatio(head) > 0.88) {
            modality = DataModality.TEXT_LOG; confidence = 0.84;
        } else if (Set.of("xlsx","xls","pdf","docx").contains(ext)) {
            modality = DataModality.STATISTICAL_REPORT; confidence = 0.80;
        } else if (sourceType != null && sourceType.toUpperCase(Locale.ROOT).contains("CONTROL")) {
            modality = DataModality.DEVICE_OPERATION; confidence = 0.76;
        } else {
            modality = DataModality.OTHER_FILE; confidence = 0.55;
        }

        double compressibility = alreadyCompressed ? 0.08 :
                switch (modality) {
                    case NUMERIC_TIME_SERIES -> 0.88;
                    case TEXT_LOG, STATISTICAL_REPORT -> 0.78;
                    case PACKAGE_DATA -> 0.72;
                    case DEVICE_OPERATION -> 0.68;
                    case ALARM_EVENT, CONTROL_MESSAGE -> 0.50;
                    default -> 0.35;
                };

        String preprocess = switch (modality) {
            case NUMERIC_TIME_SERIES -> "列式整理 + 空值位图 + 可选差分编码";
            case TEXT_LOG -> "字段提取 + 字典编码";
            case PACKAGE_DATA -> "包清单整理 + 分块压缩";
            default -> "NONE";
        };

        List<String> algorithms = alreadyCompressed
                ? List.of("NONE")
                : switch (modality) {
                    case ALARM_EVENT, CONTROL_MESSAGE -> List.of("NONE","LZ4","SNAPPY","ZSTD");
                    case NUMERIC_TIME_SERIES -> List.of("LZ4","ZSTD","GZIP");
                    case TEXT_LOG, STATISTICAL_REPORT -> List.of("ZSTD","GZIP","BROTLI");
                    case PACKAGE_DATA -> List.of("LZ4","ZSTD","GZIP","BZIP2");
                    default -> List.of("NONE","LZ4","ZSTD");
                };

        String tag = alreadyCompressed ? "可直接发送"
                : compressibility > 0.8 ? "适合高压缩比处理"
                : compressibility > 0.5 ? "适合快速压缩"
                : "建议延迟批量处理";

        return new RecognitionResult(modality, format, mime, alreadyCompressed,
                compressibility, preprocess, algorithms,
                alreadyCompressed ? "0" : "1-6", confidence, tag,
                "综合文件扩展名、MIME、文件头、数据源、业务场景和样本内容识别");
    }

    private String extension(String name) {
        if (name == null) return "";
        int p = name.lastIndexOf('.');
        return p < 0 ? "" : name.substring(p + 1).toLowerCase(Locale.ROOT);
    }

    private boolean isDccsPackage(String fileName, String mime) {
        String name = fileName == null ? "" : fileName.toLowerCase(Locale.ROOT);
        String type = mime == null ? "" : mime.toLowerCase(Locale.ROOT);
        return name.endsWith(".dccpkg") || type.contains("vnd.dccs.package");
    }

    private boolean containsAlarm(String text, String name, String scene) {
        String value = (text + " " + name + " " + scene).toLowerCase(Locale.ROOT);
        return value.contains("alarm") || value.contains("告警") || value.contains("故障")
                || value.contains("越界") || value.contains("异常事件");
    }

    private boolean containsControl(String text, String name, String scene) {
        String value = (text + " " + name + " " + scene).toLowerCase(Locale.ROOT);
        return value.contains("command") || value.contains("control")
                || value.contains("控制指令") || value.contains("参数下发");
    }

    private boolean looksDelimited(String text) {
        String[] lines = text.split("\\R");
        if (lines.length < 2) return false;
        long commas = text.chars().filter(c -> c == ',' || c == '\t').count();
        return commas >= Math.min(6, lines.length);
    }

    private double printableRatio(byte[] bytes) {
        if (bytes.length == 0) return 1.0;
        int printable = 0;
        for (byte b : bytes) {
            int v = b & 0xff;
            if (v == 9 || v == 10 || v == 13 || (v >= 32 && v < 127) || v >= 0xC0) printable++;
        }
        return printable / (double) bytes.length;
    }

    private boolean magicCompressed(byte[] h) {
        return starts(h, 0xFF,0xD8) || starts(h, 0x89,0x50,0x4E,0x47)
                || starts(h, 0x50,0x4B,0x03,0x04) || starts(h, 0x1F,0x8B);
    }

    private String detectMagic(byte[] h) {
        if (starts(h, 0xFF,0xD8)) return "JPEG";
        if (starts(h, 0x89,0x50,0x4E,0x47)) return "PNG";
        if (starts(h, 0x50,0x4B,0x03,0x04)) return "ZIP";
        if (starts(h, 0x1F,0x8B)) return "GZIP";
        return "BINARY";
    }

    private boolean starts(byte[] h, int... values) {
        if (h.length < values.length) return false;
        for (int i=0;i<values.length;i++) if ((h[i]&0xff) != values[i]) return false;
        return true;
    }
}
