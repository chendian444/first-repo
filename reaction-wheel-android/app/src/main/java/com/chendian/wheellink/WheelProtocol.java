package com.chendian.wheellink;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;

/** Unmodified legacy firmware: 0x23, 64 raw bytes, sum8. No device timestamp. */
public final class WheelProtocol {
    public enum Command {
        OPEN_TELEMETRY(8), STOP_MOTORS(5);
        public final int code;
        Command(int value) { code=value; }
        public byte[] bytes() { return new byte[]{(byte)0xa0,(byte)0xac,(byte)code,
                (byte)((0xa0+0xac+code+0x66)&255),0x66}; }
    }
    public interface Listener {
        void onFrame(byte[] raw);
        void onAcknowledgement(int command);
    }
    private byte[] buffer=new byte[8192];
    private int size;
    public long validFrames, invalidCandidates, discardedBytes, receivedBytes;

    public void feed(byte[] input, Listener listener) {
        receivedBytes+=input.length;
        // Consume chunks so even unbounded junk does not grow the parser's memory.
        int offset=0;
        while(offset<input.length) {
            int n=Math.min(input.length-offset,4096);
            System.arraycopy(input,offset,buffer,size,n);size+=n;offset+=n;
            parse(listener);
        }
    }
    private void parse(Listener listener) {
        int p=0;
        while(p<size) {
            int first=buffer[p]&255;
            if(first==0x23) {
                if(size-p<66)break;
                int sum=0;for(int j=1;j<=64;j++)sum+=buffer[p+j]&255;
                if((sum&255)==(buffer[p+65]&255)) {
                    byte[] raw=Arrays.copyOfRange(buffer,p+1,p+65);
                    validFrames++;p+=66;listener.onFrame(raw);continue;
                }
                invalidCandidates++;
            } else if(first==0xa0) {
                if(size-p<2)break;
                if((buffer[p+1]&255)==0xac) {
                    if(size-p<5)break;
                    int code=buffer[p+2]&255;
                    if(code>=1 && code<=9 && (buffer[p+4]&255)==0x99
                            && (buffer[p+3]&255)==((0xa0+0xac+code+0x66)&255)) {
                        listener.onAcknowledgement(code);p+=5;continue;
                    }
                }
            }
            discardedBytes++;p++;
        }
        System.arraycopy(buffer,p,buffer,0,size-p);size-=p;
    }
    public static float[] values(byte[] raw) {
        if(raw.length!=64)throw new IllegalArgumentException("64 bytes required");
        float[] v=new float[16];ByteBuffer b=ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);
        for(int i=0;i<16;i++)v[i]=b.getFloat();return v;
    }
    public static byte[] legacyFrame(byte[] raw) {
        if(raw.length!=64)throw new IllegalArgumentException("64 bytes required");
        byte[] out=new byte[66];out[0]=0x23;int sum=0;
        for(int i=0;i<64;i++){out[i+1]=raw[i];sum+=raw[i]&255;}
        out[65]=(byte)sum;return out;
    }
    public static String csvHeader() {
        StringBuilder s=new StringBuilder("source,phone_elapsed_ms,phone_sequence,gyro_x,gyro_y,gyro_z");
        for(int i=4;i<=14;i++)s.append(",reserved_").append(i<10?"0":"").append(i);
        return s.append(",rc_x,rc_y\n").toString();
    }
    public static String csvRow(String source,long elapsed,long sequence,byte[] raw) {
        StringBuilder s=new StringBuilder(source).append(',').append(elapsed).append(',').append(sequence);
        for(float f:values(raw))s.append(',').append(Float.isFinite(f)?Float.toString(f):"");
        return s.append('\n').toString();
    }
}
