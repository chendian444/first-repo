package com.datacompress.transfer.service;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class PackagePayloadServiceTest {
    private final PackagePayloadService service = new PackagePayloadService();

    @Test
    void keepsOriginalFileNameForSingleFileTask() throws Exception {
        MockMultipartFile file = new MockMultipartFile("files", "监测报告.csv", "text/csv",
                "a,b\n1,2".getBytes(StandardCharsets.UTF_8));
        PackagePayloadService.PackagedPayload payload = service.build(List.of(file), "监测报告.csv", "FILE");

        assertEquals("监测报告.csv", payload.fileName());
        assertEquals("FILE", payload.packageKind());
        assertEquals(1, payload.entryCount());
        assertEquals("监测报告.csv", service.readEntries(payload.payload()).get(0).path());
    }

    @Test
    void keepsOriginalFolderNameAndPaths() throws Exception {
        MockMultipartFile first = new MockMultipartFile("files", "巡检资料/day1/a.txt", "text/plain", "A".getBytes());
        MockMultipartFile second = new MockMultipartFile("files", "巡检资料/day2/b.txt", "text/plain", "B".getBytes());
        PackagePayloadService.PackagedPayload payload = service.build(List.of(first, second), "巡检资料", "FOLDER");

        assertEquals("巡检资料", payload.fileName());
        assertEquals("FOLDER", payload.packageKind());
        assertEquals(List.of("巡检资料/day1/a.txt", "巡检资料/day2/b.txt"),
                service.readEntries(payload.payload()).stream().map(PackagePayloadService.PackageEntryData::path).toList());
    }
}
