package com.datacompress.control.service;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.*;

/** DCW1, independent lossless frames. All multibyte fields are little endian. */
public final class WheelFrameCodec {
    private WheelFrameCodec() {}
    public record Frame(long sequence, long deviceMillis, int codec, int mode,
                        int periodMs, int payloadBytes, int wireBytes, byte[] raw) {}

    public static int crc16(byte[] bytes, int length) {
        return crc16(bytes, 0, length);
    }
    private static int crc16(byte[] bytes, int start, int length) {
        int crc = 0xffff;
        for (int i = start; i < start + length; i++) {
            crc ^= (bytes[i] & 255) << 8;
            for (int bit = 0; bit < 8; bit++)
                crc = ((crc & 0x8000) != 0 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
        }
        return crc;
    }
    private static int u16(byte[] b, int p) { return (b[p] & 255) | ((b[p + 1] & 255) << 8); }

    public static List<Frame> decodeBatch(byte[] bytes) {
        if (bytes == null || bytes.length == 0 || bytes.length > 65536)
            throw new IllegalArgumentException("遥测批次必须为 1~65536 字节");
        List<Frame> frames = new ArrayList<>();
        int p = 0;
        while (p < bytes.length) {
            if (bytes.length - p < 23 || bytes[p] != 'D' || bytes[p+1] != 'C'
                    || bytes[p+2] != 'W' || bytes[p+3] != '1')
                throw new IllegalArgumentException("DCW1 帧头错误或帧不完整");
            int codec = bytes[p+4] & 255, n = u16(bytes, p+6), mode = bytes[p+16] & 255;
            int period = u16(bytes, p+17), end = p + 20 + n;
            if (codec > 1 || bytes[p+5] != 16 || n < 1 || n > 64 || mode > 1
                    || period < 10 || period > 1000 || bytes[p+19] != 0
                    || end + 2 > bytes.length || (codec == 0 && n != 64))
                throw new IllegalArgumentException("DCW1 帧参数错误");
            if (crc16(bytes, p, 20+n) != u16(bytes, end))
                throw new IllegalArgumentException("DCW1 CRC 校验失败");
            byte[] raw = new byte[64];
            if (codec == 0) System.arraycopy(bytes, p+20, raw, 0, 64);
            else {
                int i = p+20, out = 0;
                while (i < end) {
                    int token = bytes[i++] & 255, count = (token & 127) + 1;
                    if (out + count > 64 || ((token & 128) == 0 && i + count > end))
                        throw new IllegalArgumentException("ZRLE 长度错误");
                    if ((token & 128) == 0) {
                        System.arraycopy(bytes, i, raw, out, count); i += count;
                    }
                    out += count;
                }
                if (out != 64) throw new IllegalArgumentException("ZRLE 恢复长度必须为 64");
            }
            ByteBuffer view = ByteBuffer.wrap(bytes, p+8, 8).order(ByteOrder.LITTLE_ENDIAN);
            frames.add(new Frame(Integer.toUnsignedLong(view.getInt()),
                    Integer.toUnsignedLong(view.getInt()), codec, mode, period, n, 22+n, raw));
            p = end + 2;
        }
        return frames;
    }
}
