package com.datacompress.control.service;

import com.datacompress.control.domain.DataSourceInfo;
import org.springframework.stereotype.Service;
import java.nio.*;
import java.security.*;
import java.time.Instant;
import java.util.*;

@Service
public class WheelTelemetryService {
    public static final List<String> CHANNELS = List.of("gyro_x", "gyro_y", "gyro_z",
            "angle_x", "angle_y", "angle_z", "wheel1_speed", "wheel2_speed", "wheel3_speed",
            "wheel1_iq", "wheel2_iq", "wheel3_iq", "battery_v", "protect_flag", "rc_x", "rc_y");
    public record Config(String mode, Integer periodMs) {}
    public record Sample(long sequence, long deviceMillis, Instant receivedAt,
                         String codec, String mode, int periodMs, int payloadBytes,
                         List<Float> values, String rawBase64) {}
    private final DataSourceService sources;
    private final Deque<Sample> history = new ArrayDeque<>();
    private final LinkedHashMap<String, String> batches = new LinkedHashMap<>();
    private Config desired = new Config("AUTO", 10);
    private long accepted, compressed, wireBytes, payloadBytes, gaps, duplicates, resets, rejected;
    private long lastSeq = -1, lastTicks;
    private String session = "";
    private Sample latest;

    public WheelTelemetryService(DataSourceService sources) {
        this.sources = sources;
        sources.save(new DataSourceInfo("reaction-wheel-01", "动量轮 AT32F403A", "SENSOR",
                "serial://USART3@230400", "AT32-WHEEL-01", "动量轮遥测",
                false, Instant.EPOCH, 0L, 10));
    }
    public synchronized Config config() { return desired; }
    public synchronized Config configure(Config input) {
        if (input == null || !("AUTO".equals(input.mode()) || "RAW".equals(input.mode()))
                || input.periodMs() == null || input.periodMs() < 10 || input.periodMs() > 1000)
            throw new IllegalArgumentException("mode 只能是 AUTO/RAW，periodMs 为 10~1000 的整数");
        desired = input;
        return desired;
    }
    public synchronized Map<String, Object> ingest(byte[] body, String batchId, String streamSession) {
        if (batchId == null || !batchId.matches("[A-Za-z0-9-]{1,80}")
                || streamSession == null || !streamSession.matches("[A-Za-z0-9-]{1,80}"))
            throw new IllegalArgumentException("需要有效的批次及采集会话 ID");
        String key = streamSession + ":" + batchId;
        String hash = sha256(body);
        if (batches.containsKey(key)) {
            if (!batches.get(key).equals(hash)) throw new IllegalArgumentException("批次 ID 重用但内容不同");
            return Map.of("accepted", 0, "duplicateBatch", true, "config", desired);
        }
        List<WheelFrameCodec.Frame> frames;
        try { frames = WheelFrameCodec.decodeBatch(body); }
        catch (IllegalArgumentException e) { rejected++; throw e; }
        // Fully validate the batch before mutating telemetry state.
        if (!session.equals(streamSession)) {
            session = streamSession; lastSeq = -1; history.clear();
        }
        int count = 0;
        for (var frame : frames) {
            if (lastSeq >= 0) {
                long delta = (frame.sequence() - lastSeq) & 0xffffffffL;
                long tickDelta = (frame.deviceMillis() - lastTicks) & 0xffffffffL;
                if (tickDelta >= 0x80000000L) { resets++; history.clear(); }
                else if (delta == 0 || delta >= 0x80000000L) { duplicates++; continue; }
                else gaps += delta - 1;
            }
            lastSeq = frame.sequence(); lastTicks = frame.deviceMillis();
            List<Float> values = new ArrayList<>();
            ByteBuffer data = ByteBuffer.wrap(frame.raw()).order(ByteOrder.LITTLE_ENDIAN);
            while (data.hasRemaining()) {
                float f = data.getFloat(); values.add(Float.isFinite(f) ? f : null);
            }
            latest = new Sample(frame.sequence(), frame.deviceMillis(), Instant.now(),
                    frame.codec() == 0 ? "RAW" : "ZRLE", frame.mode() == 0 ? "RAW" : "AUTO",
                    frame.periodMs(), frame.payloadBytes(), Collections.unmodifiableList(values),
                    Base64.getEncoder().encodeToString(frame.raw()));
            history.addLast(latest);
            if (history.size() > 4000) history.removeFirst();
            accepted++; count++; if (frame.codec() == 1) compressed++;
            wireBytes += frame.wireBytes(); payloadBytes += frame.payloadBytes();
            sources.save(new DataSourceInfo("reaction-wheel-01", "动量轮 AT32F403A", "SENSOR",
                    "serial://USART3@230400", "AT32-WHEEL-01", "动量轮遥测", true,
                    latest.receivedAt(), wireBytes, frame.periodMs()));
        }
        batches.put(key, hash);
        if (batches.size() > 256) batches.remove(batches.keySet().iterator().next());
        return Map.of("accepted", count, "duplicateBatch", false, "config", desired);
    }
    private static String sha256(byte[] bytes) {
        if (bytes == null || bytes.length == 0 || bytes.length > 65536)
            throw new IllegalArgumentException("遥测批次必须为 1~65536 字节");
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    public synchronized Map<String, Object> status() {
        boolean online = latest != null && latest.receivedAt().isAfter(Instant.now().minusSeconds(3));
        // Keep the existing source list consistent with stale telemetry, too.
        DataSourceInfo source = sources.get("reaction-wheel-01");
        if (source.online() != online) sources.save(new DataSourceInfo(source.id(), source.name(),
                source.type(), source.endpoint(), source.deviceCode(), source.businessScene(), online,
                source.lastReportTime(), source.cumulativeBytes(), source.collectionPeriodMs()));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("online", online); out.put("config", desired); out.put("latest", latest);
        out.put("inputMode", session.startsWith("replay-") ? "REPLAY" : "SERIAL");
        out.put("configApplied", online && latest.mode().equals(desired.mode())
                && latest.periodMs() == desired.periodMs());
        out.put("channels", CHANNELS); out.put("acceptedFrames", accepted);
        out.put("compressedFrames", compressed); out.put("wireBytes", wireBytes);
        out.put("payloadBytes", payloadBytes); out.put("rawPayloadBytes", accepted * 64);
        out.put("payloadSavingPercent", accepted == 0 ? 0 : 100.0*(1-payloadBytes/(accepted*64.0)));
        out.put("framedSavingPercent", accepted == 0 ? 0 : 100.0*(1-wireBytes/(accepted*86.0)));
        out.put("sequenceGaps", gaps); out.put("duplicateFrames", duplicates);
        out.put("deviceResets", resets); out.put("rejectedBatches", rejected);
        out.put("historyLimit", 4000);
        return out;
    }
    public synchronized List<Sample> history(int limit) {
        int n = Math.max(1, Math.min(4000, limit));
        return history.stream().skip(Math.max(0, history.size()-n)).toList();
    }
    public synchronized String csv() {
        StringBuilder s = new StringBuilder("sequence,device_ms,received_at,codec,mode,period_ms,")
                .append(String.join(",", CHANNELS)).append('\n');
        for (Sample f : history) {
            s.append(f.sequence()).append(',').append(f.deviceMillis()).append(',')
                    .append(f.receivedAt()).append(',').append(f.codec()).append(',')
                    .append(f.mode()).append(',').append(f.periodMs());
            for (Float v : f.values()) s.append(',').append(v == null ? "" : v);
            s.append('\n');
        }
        return s.toString();
    }
}
