package com.datacompress.library;
import com.datacompress.library.algorithm.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.http.*;
import java.util.*;
import java.security.MessageDigest;
import java.io.*;
@RestController
@RequestMapping("/api/library")
public class LibraryApi {
    private final AlgorithmRegistry registry;
    private final Set<String> enabled=java.util.concurrent.ConcurrentHashMap.newKeySet();
    public LibraryApi(AlgorithmRegistry registry){this.registry=registry;registry.all().forEach(a->enabled.add(a.name()));}
    @GetMapping public List<Map<String,Object>> list(){return registry.all().stream().map(a->Map.<String,Object>of("name",a.name(),"enabled",enabled.contains(a.name()),"minLevel",a.minLevel(),"maxLevel",a.maxLevel(),"defaultLevel",a.defaultLevel(),"supportsLevel",a.supportsLevel())).toList();}
    @PostMapping("/{name}/enabled") public Map<String,Object> enable(@PathVariable String name,@RequestParam boolean value){String id=registry.require(name).name();if(value)enabled.add(id);else enabled.remove(id);return Map.of("name",id,"enabled",value);}
    @PostMapping("/benchmark") public Map<String,Object> benchmark(@RequestParam MultipartFile file) throws Exception {
        byte[] sample=file.getBytes();if(sample.length==0 || sample.length>8388608)throw new IllegalArgumentException("基准样本大小须为 1 字节–8 MiB");
        List<Map<String,Object>> rows=new ArrayList<>();
        for(CompressionAlgorithm a:registry.all()){
            if(!enabled.contains(a.name()))continue;
            Map<String,Object> row=new LinkedHashMap<>();row.put("algorithm",a.name());row.put("level",a.defaultLevel());
            try{
                long start=System.nanoTime();byte[] compressed=a.compress(sample,a.defaultLevel());long compress=System.nanoTime()-start;
                start=System.nanoTime();byte[] restored=a.decompress(compressed);long restore=System.nanoTime()-start;
                if(!Arrays.equals(sample,restored))throw new IllegalStateException("恢复内容不一致");
                row.put("available",true);row.put("compressedBytes",compressed.length);row.put("compressedRatio",(double)compressed.length/sample.length);
                row.put("compressionNanosPerByte",(double)compress/sample.length);row.put("decompressionNanosPerByte",(double)restore/sample.length);row.put("compressionMillis",compress/1000000.0);row.put("decompressionMillis",restore/1000000.0);row.put("verified",true);
            }catch(Exception|LinkageError e){row.put("available",false);row.put("error",e.toString());}
            rows.add(row);
        }
        return Map.of("bytes",sample.length,"sha256",digest(sample),"profiles",rows);
    }
    @PostMapping("/compress") public ResponseEntity<byte[]> compress(@RequestParam MultipartFile file,@RequestParam String algorithm,@RequestParam(required=false) Integer level) throws Exception {
        CompressionAlgorithm codec=registry.require(algorithm);if(!enabled.contains(codec.name()))throw new IllegalArgumentException("算法已停用");
        byte[] input=file.getBytes();if(input.length>8388608)throw new IllegalArgumentException("单文件操作上限 8 MiB");
        int normalized=codec.normalizeLevel(level==null?codec.defaultLevel():level);
        byte[] body=codec.compress(input,normalized);ByteArrayOutputStream packed=new ByteArrayOutputStream();
        try(DataOutputStream out=new DataOutputStream(packed)){out.writeUTF("DC-LIB-1");out.writeUTF(codec.name());out.writeInt(normalized);out.writeInt(input.length);out.writeUTF(digest(input));out.writeInt(body.length);out.write(body);}
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM).header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=compressed.dclib").body(packed.toByteArray());
    }
    @PostMapping("/restore") public ResponseEntity<byte[]> restore(@RequestParam MultipartFile file) throws Exception {
        byte[] uploaded=file.getBytes();if(uploaded.length>16777216)throw new IllegalArgumentException("压缩文件上限 16 MiB");
        try(DataInputStream in=new DataInputStream(new ByteArrayInputStream(uploaded))){
            if(!"DC-LIB-1".equals(in.readUTF()))throw new IllegalArgumentException("不支持的压缩包格式");
            CompressionAlgorithm codec=registry.require(in.readUTF());in.readInt();int size=in.readInt();String checksum=in.readUTF();int packed=in.readInt();
            if(size<0||size>8388608||packed<0||packed>16777216)throw new IllegalArgumentException("压缩包长度无效");
            byte[] body=in.readNBytes(packed);if(body.length!=packed||in.available()!=0)throw new IllegalArgumentException("压缩包内容不完整");
            byte[] restored=codec.decompress(body);
            if(restored.length!=size || !digest(restored).equals(checksum))throw new IllegalArgumentException("完整性校验失败");
            return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM).header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=restored.bin").body(restored);
        }
    }
    private String digest(byte[] bytes)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}

    @ExceptionHandler(IllegalArgumentException.class) public org.springframework.http.ResponseEntity<Map<String,String>> invalid(IllegalArgumentException problem) { return org.springframework.http.ResponseEntity.badRequest().body(Map.of("error","LIBRARY_INPUT_INVALID","message",String.valueOf(problem.getMessage()))); }
}
