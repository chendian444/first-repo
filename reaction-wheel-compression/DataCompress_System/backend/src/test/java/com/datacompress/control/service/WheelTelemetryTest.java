package com.datacompress.control.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class WheelTelemetryTest {
    private byte[] vector(int index) throws Exception {
        try (var input = getClass().getResourceAsStream("/wheel-vectors.json")) {
            return HexFormat.of().parseHex(new ObjectMapper().readTree(input).get(index).get("frameHex").asText());
        }
    }
    private byte[] sequence(byte[] source, long seq, long ticks) {
        byte[] b = source.clone();
        for (int i=0; i<4; i++) { b[8+i]=(byte)(seq >> (8*i)); b[12+i]=(byte)(ticks >> (8*i)); }
        int crc = WheelFrameCodec.crc16(b, b.length-2);
        b[b.length-2] = (byte)crc; b[b.length-1] = (byte)(crc>>8);
        return b;
    }
    private byte[] join(byte[] a, byte[] b) {
        byte[] out = Arrays.copyOf(a, a.length+b.length);
        System.arraycopy(b,0,out,a.length,b.length); return out;
    }
    @Test void decodesCEncodedFramesBitExactlyIncludingSpecialFloats() throws Exception {
        try (var input = getClass().getResourceAsStream("/wheel-vectors.json")) {
            var vectors = new ObjectMapper().readTree(input);
            for (var v : vectors) {
                byte[] frame = HexFormat.of().parseHex(v.get("frameHex").asText());
                byte[] expected = HexFormat.of().parseHex(v.get("rawHex").asText());
                assertArrayEquals(expected, WheelFrameCodec.decodeBatch(frame).get(0).raw());
            }
        }
    }
    @Test void rejectsCorruptTruncatedAndOversizedFrames() throws Exception {
        byte[] frame = vector(0); frame[20] ^= 1;
        assertThrows(IllegalArgumentException.class, () -> WheelFrameCodec.decodeBatch(frame));
        byte[] good = vector(1);
        assertThrows(IllegalArgumentException.class, () -> WheelFrameCodec.decodeBatch(Arrays.copyOf(good, good.length-1)));
        assertThrows(IllegalArgumentException.class, () -> WheelFrameCodec.decodeBatch(new byte[65537]));
    }
    @Test void retriesAreIdempotentAndBadBatchIsAtomic() throws Exception {
        var s = new WheelTelemetryService(new DataSourceService());
        byte[] good = vector(0), bad = vector(1); bad[20] ^= 1;
        assertThrows(IllegalArgumentException.class, () -> s.ingest(join(good,bad),"bad","serial-test"));
        assertEquals(0L,s.status().get("acceptedFrames"));
        assertEquals(1,s.ingest(good,"batch1","serial-test").get("accepted"));
        assertEquals(true,s.ingest(good,"batch1","serial-test").get("duplicateBatch"));
        assertThrows(IllegalArgumentException.class, () -> s.ingest(vector(1),"batch1","serial-test"));
        assertEquals(1L,s.status().get("acceptedFrames"));
    }
    @Test void countsGapsAndHandlesRebootsAndUnsignedWrap() throws Exception {
        var s = new WheelTelemetryService(new DataSourceService()); byte[] f=vector(0);
        s.ingest(sequence(f,0xfffffffeL,0xfffffff0L),"b1","serial-test");
        s.ingest(sequence(f,0,4),"b2","serial-test");
        assertEquals(1L,s.status().get("sequenceGaps"));
        assertEquals(0L,s.status().get("deviceResets"));
        s.ingest(sequence(f,10,100),"b3","serial-test");
        s.ingest(sequence(f,0,10),"b4","serial-test");
        assertEquals(1L,s.status().get("deviceResets"));
        s.ingest(sequence(f,0,10),"b5","serial-test");
        assertEquals(1L,s.status().get("duplicateFrames"));
    }
    @Test void boundsHistoryAndValidatesOnlyTelemetryConfiguration() throws Exception {
        var s = new WheelTelemetryService(new DataSourceService());
        assertThrows(IllegalArgumentException.class, () -> s.configure(new WheelTelemetryService.Config("AUTO",1)));
        assertThrows(IllegalArgumentException.class, () -> s.configure(new WheelTelemetryService.Config("MOTOR",10)));
        s.configure(new WheelTelemetryService.Config("RAW",20));
        assertEquals("RAW",s.config().mode());
        byte[] f=vector(0), batch=new byte[f.length*500];
        for (int j=0;j<9;j++) {
            for (int i=0;i<500;i++) System.arraycopy(sequence(f,j*500+i,(j*500+i)*10),0,batch,i*f.length,f.length);
            s.ingest(batch,"b"+j,"replay-history");
        }
        assertEquals(4000,s.history(99999).size());
        assertEquals(4500L,s.status().get("acceptedFrames"));
        assertEquals("REPLAY",s.status().get("inputMode"));
        assertTrue(s.csv().startsWith("sequence,device_ms,"));
    }
}
