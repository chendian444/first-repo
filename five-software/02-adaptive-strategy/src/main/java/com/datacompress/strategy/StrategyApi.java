package com.datacompress.strategy;
import com.datacompress.strategy.domain.*;
import com.datacompress.strategy.service.DynamicStrategyService;
import com.datacompress.strategy.StrategyInputs.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.util.*;
import java.io.*;
import java.util.zip.*;
@RestController
@RequestMapping("/api/strategy")
public class StrategyApi {
    private final DynamicStrategyService engine;
    public record Analysis(List<AlgorithmProfile> profiles,long bytes,double safeRateKbps,double packetLossPercent,
        LinkGrade quality,Urgency priority,boolean alreadyCompressed,CompressionDecision previous,long heldMillis){}
    public StrategyApi(DynamicStrategyService engine){this.engine=engine;}
    @PostMapping("/analyze") public Map<String,Object> analyze(@RequestBody Analysis a){
        if(a.bytes()<=0 || a.bytes()>67108864 || !Double.isFinite(a.safeRateKbps()) || a.safeRateKbps()<=0 || !Double.isFinite(a.packetLossPercent()) || a.packetLossPercent()<0 || a.packetLossPercent()>100 || a.heldMillis()<0) throw new IllegalArgumentException("数据大小、速率、丢包率或保持时间无效");
        if(a.profiles()==null || a.profiles().isEmpty() || a.profiles().size()>100)throw new IllegalArgumentException("需要 1–100 条压缩画像");
        for(AlgorithmProfile p:a.profiles()) if(p.algorithm()==null || p.algorithm().isBlank() || !Double.isFinite(p.compressedRatio()) || p.compressedRatio()<0 || !Double.isFinite(p.compressionNanosPerByte()) || p.compressionNanosPerByte()<0 || !Double.isFinite(p.decompressionNanosPerByte()) || p.decompressionNanosPerByte()<0)throw new IllegalArgumentException("画像参数无效");
        Urgency urgency=a.priority()==null?Urgency.NORMAL:a.priority();
        SchedulingHints hints=new SchedulingHints(urgency,urgency!=Urgency.CRITICAL,urgency==Urgency.NORMAL);
        LinkConditions link=new LinkConditions(a.quality()==null?LinkGrade.GOOD:a.quality(),a.packetLossPercent());
        ContentHints content=new ContentHints(a.alreadyCompressed(),"NONE");
        List<AlgorithmProfile> candidates=a.alreadyCompressed()?a.profiles().stream().filter(p->"NONE".equals(p.algorithm())).toList():a.profiles();
        if(candidates.stream().noneMatch(AlgorithmProfile::available))throw new IllegalArgumentException("没有可用画像；已压缩数据需提供 NONE 画像");
        RateBudget budget=new RateBudget(a.safeRateKbps());
        CompressionDecision best=engine.select(candidates,content,hints,link,budget,a.bytes(),a.previous(),a.heldMillis());
        List<CompressionDecision> ranked=candidates.stream().filter(AlgorithmProfile::available).map(p->engine.select(List.of(p),content,hints,link,budget,a.bytes(),null,0)).sorted(Comparator.comparingDouble(CompressionDecision::estimatedTotalMillis)).toList();
        return Map.of("selected",best,"ranking",ranked,"estimated",true,"unit","KiB/s");
    }
    @PostMapping("/measure") public Map<String,Object> measure(@RequestParam MultipartFile file) throws Exception {
        byte[] payload=file.getBytes();
        if(payload.length==0)throw new IllegalArgumentException("样本不能为空");
        List<AlgorithmProfile> measurements=new ArrayList<>();
        measurements.add(new AlgorithmProfile("NONE",0,true,1,0,0,null));
        for(int level:new int[]{1,6,9}){
            long begin=System.nanoTime();ByteArrayOutputStream packed=new ByteArrayOutputStream();
            Deflater deflater=new Deflater(level);
            try(DeflaterOutputStream stream=new DeflaterOutputStream(packed,deflater)){stream.write(payload);}finally{deflater.end();}
            long compression=System.nanoTime()-begin;begin=System.nanoTime();
            byte[] restored;
            try(InflaterInputStream stream=new InflaterInputStream(new ByteArrayInputStream(packed.toByteArray()))){restored=stream.readAllBytes();}
            long decompression=System.nanoTime()-begin;
            if(!Arrays.equals(payload,restored))throw new IllegalStateException("实测校验失败");
            measurements.add(new AlgorithmProfile("DEFLATE",level,true,(double)packed.size()/payload.length,(double)compression/payload.length,(double)decompression/payload.length,null));
        }
        return Map.of("bytes",payload.length,"profiles",measurements,"source","LOCAL_JDK_BENCHMARK","timingsMeasured",true);
    }

    @ExceptionHandler(IllegalArgumentException.class) public org.springframework.http.ResponseEntity<Map<String,String>> invalid(IllegalArgumentException problem) { return org.springframework.http.ResponseEntity.badRequest().body(Map.of("error","STRATEGY_PARAMETERS_INVALID","message",String.valueOf(problem.getMessage()))); }
}
