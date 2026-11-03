import com.chendian.wheellink.WheelProtocol;
import java.io.*;
import java.nio.*;
import java.nio.file.*;
import java.util.*;

public final class ProtocolTest {
    static void check(boolean value,String reason){if(!value)throw new AssertionError(reason);}
    static class Received implements WheelProtocol.Listener {
        List<byte[]> frames=new ArrayList<>();List<Integer> acknowledgements=new ArrayList<>();
        public void onFrame(byte[] raw){frames.add(raw);}
        public void onAcknowledgement(int code){acknowledgements.add(code);}
    }
    static byte[] join(byte[]...parts)throws IOException {
        ByteArrayOutputStream out=new ByteArrayOutputStream();for(byte[] part:parts)out.write(part);return out.toByteArray();
    }
    public static void main(String[] args)throws Exception {
        check(Arrays.equals(WheelProtocol.Command.OPEN_TELEMETRY.bytes(),new byte[]{(byte)0xa0,(byte)0xac,8,(byte)0xba,0x66}),"08 command");
        check(Arrays.equals(WheelProtocol.Command.STOP_MOTORS.bytes(),new byte[]{(byte)0xa0,(byte)0xac,5,(byte)0xb7,0x66}),"05 command");
        check(WheelProtocol.Command.values().length==2,"No unreviewed motion command");
        byte[] good=WheelProtocol.legacyFrame(new byte[64]),bad=good.clone();bad[65]^=1;
        byte[] ack={(byte)0xa0,(byte)0xac,8,(byte)0xba,(byte)0x99};
        byte[] input=join(new byte[]{0,1,2},ack,good,bad,good);
        for(int chunk:new int[]{1,3,5,17,66,4096}){
            WheelProtocol p=new WheelProtocol();Received r=new Received();
            for(int i=0;i<input.length;i+=chunk)p.feed(Arrays.copyOfRange(input,i,Math.min(i+chunk,input.length)),r);
            check(r.frames.size()==2,"fragmentation and corruption recovery "+chunk);
            check(r.acknowledgements.equals(Collections.singletonList(8)),"ACK separated from telemetry");
            check(p.invalidCandidates==1,"bad sum8 counted");
        }
        Random rng=new Random(20261103);WheelProtocol p=new WheelProtocol();Received r=new Received();
        for(int i=0;i<5004;i++){
            byte[] raw=new byte[64];rng.nextBytes(raw);
            if(i==0)Arrays.fill(raw,(byte)0);
            if(i==1)Arrays.fill(raw,(byte)0x23);
            if(i==2){ByteBuffer b=ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);for(int n=0;n<16;n++)b.putInt(n%2==0?0x80000000:0x7fc01234);}
            byte[] f=WheelProtocol.legacyFrame(raw);
            p.feed(Arrays.copyOfRange(f,0,9),r);p.feed(Arrays.copyOfRange(f,9,f.length),r);
            check(Arrays.equals(raw,r.frames.get(i)),"bit exact "+i);
        }
        check(p.validFrames==5004,"random count");
        String header=WheelProtocol.csvHeader();
        check(header.split(",").length==19&&header.contains("reserved_14"),"old channel labels");
        String row=WheelProtocol.csvRow("DEMO",123,7,new byte[64]);
        check(row.startsWith("DEMO,123,7,")&&row.trim().split(",").length==19,"source and phone time in CSV");
        WheelProtocol garbage=new WheelProtocol();byte[] bytes=new byte[1024*1024];Arrays.fill(bytes,(byte)0x23);garbage.feed(bytes,new Received());
        check(garbage.validFrames==0&&garbage.invalidCandidates>1000,"bounded junk recovery");
        if(args.length>0){
            WheelProtocol fixture=new WheelProtocol();Received frames=new Received();fixture.feed(Files.readAllBytes(Paths.get(args[0])),frames);
            check(fixture.validFrames==1000,"shared PC/Android historical UART fixture");
        }
        System.out.println("PASS: command bytes/whitelist, ACK, fragmentation, checksum resync, 5004 bit-exact samples, CSV, 1MiB junk, 1000-frame PC fixture");
    }
}
