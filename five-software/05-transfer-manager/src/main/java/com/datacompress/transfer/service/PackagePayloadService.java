package com.datacompress.transfer.service;

import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

@Service
public class PackagePayloadService {
    public static final String MAGIC = "DCCS-PACKAGE-V1";

    public PackagedPayload build(List<MultipartFile> uploads) throws IOException {
        return build(uploads, null, null);
    }

    public PackagedPayload build(List<MultipartFile> uploads, String requestedName, String requestedKind) throws IOException {
        if (uploads == null || uploads.isEmpty()) {
            throw new IllegalArgumentException("请至少选择一个待压缩文件或目录包");
        }
        List<PackageEntrySource> entries = new ArrayList<>();
        Set<String> usedNames = new HashSet<>();
        long rawBytes = 0;
        int index = 1;
        for (MultipartFile upload : uploads) {
            if (upload == null || upload.isEmpty()) continue;
            String entryPath = normalizePath(upload.getOriginalFilename());
            if (entryPath.isBlank()) entryPath = "file-" + index;
            entryPath = uniquePath(entryPath, usedNames);
            long size = upload.getSize();
            if (size <= 0) continue;
            if (size > Integer.MAX_VALUE) {
                throw new IllegalArgumentException("单个文件超过当前任务包格式限制");
            }
            rawBytes += size;
            entries.add(new PackageEntrySource(entryPath, upload, size));
            index++;
        }
        if (entries.isEmpty() || rawBytes == 0) {
            throw new IllegalArgumentException("文件不能为空");
        }
        if (rawBytes > Integer.MAX_VALUE - 1024L * 1024L) {
            throw new IllegalArgumentException("任务包超过当前内存打包限制");
        }

        ByteArrayOutputStream buffer = new ByteArrayOutputStream(initialPackageCapacity(rawBytes, entries));
        try (DataOutputStream out = new DataOutputStream(buffer)) {
            out.writeUTF(MAGIC);
            out.writeInt(entries.size());
            for (PackageEntrySource entry : entries) {
                out.writeUTF(entry.path());
                out.writeInt(Math.toIntExact(entry.size()));
                try (InputStream input = entry.upload().getInputStream()) {
                    long copied = input.transferTo(out);
                    if (copied != entry.size()) {
                        throw new EOFException("文件读取不完整: " + entry.path());
                    }
                }
            }
        }

        List<String> entryPaths = entries.stream().map(PackageEntrySource::path).toList();
        String packageKind = determineKind(entryPaths, requestedKind);
        String packageName = determineName(entryPaths, requestedName, packageKind);
        return new PackagedPayload(packageName, packageKind, "application/vnd.dccs.package",
                buffer.toByteArray(), rawBytes, entries.size());
    }
    public boolean isPackage(byte[] payload) {
        if (payload == null || payload.length < 4) return false;
        try (DataInputStream in = new DataInputStream(new ByteArrayInputStream(payload))) {
            return MAGIC.equals(in.readUTF());
        } catch (IOException ignored) {
            return false;
        }
    }

    public List<PackageEntryData> readAnyEntries(byte[] payload) throws IOException {
        if (isPackage(payload)) return readEntries(payload);
        return readZipEntries(payload);
    }

    public byte[] toViewableZip(byte[] packagePayload) throws IOException {
        List<PackageEntryData> entries = readEntries(packagePayload);
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(buffer)) {
            for (PackageEntryData entry : entries) {
                ZipEntry zipEntry = new ZipEntry(entry.path());
                zip.putNextEntry(zipEntry);
                zip.write(entry.bytes());
                zip.closeEntry();
            }
        }
        return buffer.toByteArray();
    }

    public List<PackageEntryData> readEntries(byte[] payload) throws IOException {
        try (DataInputStream in = new DataInputStream(new ByteArrayInputStream(payload))) {
            String magic = in.readUTF();
            if (!MAGIC.equals(magic)) throw new IOException("不是有效的 DCCS 包载荷");
            int count = in.readInt();
            if (count < 0 || count > 100_000) throw new IOException("包条目数量非法");
            List<PackageEntryData> entries = new ArrayList<>();
            for (int i = 0; i < count; i++) {
                String entryPath = normalizePath(in.readUTF());
                int length = in.readInt();
                if (length < 0) throw new IOException("包条目长度非法");
                byte[] bytes = in.readNBytes(length);
                if (bytes.length != length) throw new EOFException("包条目读取不完整");
                entries.add(new PackageEntryData(entryPath, bytes));
            }
            return List.copyOf(entries);
        }
    }

    private List<PackageEntryData> readZipEntries(byte[] payload) throws IOException {
        List<PackageEntryData> entries = new ArrayList<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(payload))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String entryPath = normalizePath(entry.getName());
                if (entryPath.isBlank()) continue;
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                zip.transferTo(buffer);
                entries.add(new PackageEntryData(entryPath, buffer.toByteArray()));
                zip.closeEntry();
            }
        }
        if (entries.isEmpty()) throw new IOException("任务内容为空或不是可查看的文件包");
        return List.copyOf(entries);
    }

    private String determineKind(List<String> entryPaths, String requestedKind) {
        if ("FOLDER".equalsIgnoreCase(requestedKind)) return "FOLDER";
        if ("FILE".equalsIgnoreCase(requestedKind) && entryPaths.size() == 1) return "FILE";
        return entryPaths.size() > 1 || entryPaths.stream().anyMatch(path -> path.contains("/")) ? "FOLDER" : "FILE";
    }

    private String determineName(List<String> entryPaths, String requestedName, String packageKind) {
        String requested = sanitizeDisplayName(requestedName);
        if (!requested.isBlank()) return requested;
        String firstPath = entryPaths.get(0);
        if ("FOLDER".equals(packageKind) && firstPath.contains("/")) {
            return sanitizeDisplayName(firstPath.substring(0, firstPath.indexOf('/')));
        }
        int slash = firstPath.lastIndexOf('/');
        return sanitizeDisplayName(slash >= 0 ? firstPath.substring(slash + 1) : firstPath);
    }

    private int initialPackageCapacity(long rawBytes, List<PackageEntrySource> entries) {
        long overhead = 16L + entries.stream().mapToLong(entry -> entry.path().length() * 3L + 8L).sum();
        long capacity = Math.min(Integer.MAX_VALUE - 8L, Math.max(1024L, rawBytes + overhead));
        return Math.toIntExact(capacity);
    }
    private String normalizePath(String original) {
        if (original == null) return "";
        String value = original.replace('\\', '/').trim();
        value = value.replaceAll("^[A-Za-z]:", "");
        while (value.startsWith("/")) value = value.substring(1);
        List<String> parts = new ArrayList<>();
        for (String raw : value.split("/")) {
            String part = raw.trim().replaceAll("[\\\\:*?\"<>|]", "_");
            if (part.isBlank() || part.equals(".") || part.equals("..")) continue;
            parts.add(part);
        }
        return String.join("/", parts);
    }

    private String uniquePath(String path, Set<String> used) {
        String value = path;
        int counter = 2;
        while (!used.add(value)) {
            int dot = path.lastIndexOf('.');
            if (dot > 0) {
                value = path.substring(0, dot) + "-" + counter + path.substring(dot);
            } else {
                value = path + "-" + counter;
            }
            counter++;
        }
        return value;
    }

    private String sanitizeDisplayName(String name) {
        String value = name == null ? "" : name.trim();
        value = value.replaceAll("[\\\\/:*?\"<>|]", "_");
        return value;
    }

    private String json(String value) {
        return String.valueOf(value == null ? "" : value)
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    private record PackageEntrySource(String path, MultipartFile upload, long size) {}

    public record PackageEntryData(String path, byte[] bytes) {
        public PackageEntryData {
            path = path == null ? "" : path;
            bytes = bytes == null ? new byte[0] : bytes;
        }
    }

    public record PackagedPayload(String fileName, String packageKind, String mimeType, byte[] payload,
                                  long rawFileBytes, int entryCount) {}
}
