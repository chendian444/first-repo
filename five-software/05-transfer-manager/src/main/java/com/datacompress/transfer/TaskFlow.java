package com.datacompress.transfer;
import com.datacompress.transfer.service.*;
import com.datacompress.transfer.domain.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.multipart.MultipartFile;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.util.*;
import java.util.concurrent.*;
import java.nio.file.*;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.security.MessageDigest;
import java.util.zip.*;

@Service
public class TaskFlow {
    public static class Job {
        public String id,name,kind,scene,receiver,checksum,receiptChecksum,error="",message="等待执行";
        public volatile TaskState state=TaskState.QUEUED;
        public RecognitionResult recognition;
        public PriorityDecision priority;
        public long created,finished,originalBytes,compressedBytes;
        public double compressMillis,transferMillis,restoreMillis;
        public int entries,level,attempts;
        public volatile double progress;
        public volatile boolean pause,cancel;
        public boolean verified;
    }
    private final PackagePayloadService packaging;
    private final MultimodalRecognitionService recognition;
    private final DataClassificationService classification;
    private final ObjectMapper mapper;
    private final Path home;
    private final Map<String,Job> jobs=new ConcurrentHashMap<>();
    private final Set<String> owned=ConcurrentHashMap.newKeySet();
    private final PriorityBlockingQueue<Job> queue=new PriorityBlockingQueue<>(11,Comparator.<Job>comparingInt(j->-j.priority.priorityValue()).thenComparingLong(j->j.created));
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private volatile boolean running=true;
    public TaskFlow(PackagePayloadService packaging,MultimodalRecognitionService recognition,DataClassificationService classification,ObjectMapper mapper,@Value("${tasks.storage:runtime}") String storage){
        this.packaging=packaging;this.recognition=recognition;this.classification=classification;this.mapper=mapper;this.home=Path.of(storage).toAbsolutePath();
    }
    @PostConstruct public void start()throws IOException{
        Files.createDirectories(home.resolve("jobs"));Files.createDirectories(home.resolve("received"));
        try(var children=Files.list(home.resolve("jobs"))){
            for(Path folder:children.toList()){
                if(!Files.isRegularFile(folder.resolve("job.json")))continue;
                try{
                    Job job=mapper.readValue(folder.resolve("job.json").toFile(),Job.class);
                    if(!terminal(job.state)) {job.state=TaskState.FAILED;job.error="上次进程中断；可重试原始任务";job.message=job.error;job.pause=false;job.cancel=false;}
                    jobs.put(job.id,job);persist(job);
                }catch(IOException corrupt){System.err.println("忽略无法读取的任务元数据: "+folder.getFileName());}
            }
        }
        worker.submit(()->{while(running){try{Job job=queue.poll(300,TimeUnit.MILLISECONDS);if(job!=null){owned.add(job.id);execute(job);owned.remove(job.id);}}catch(InterruptedException e){Thread.currentThread().interrupt();break;}}});
    }
    @PreDestroy public void stop(){running=false;worker.shutdownNow();}
    public Job submit(List<MultipartFile> uploads,String name,String kind,String scene,String priority,int level,String receiver)throws Exception{
        long total=0;for(MultipartFile f:uploads)total+=f.getSize();
        if(total<=0 || total>64L*1024*1024)throw new IllegalArgumentException("每个任务总大小须为 1 字节–64 MiB");
        if(level<0 || level>9)throw new IllegalArgumentException("ZIP 级别范围为 0–9");
        if(receiver!=null && !receiver.isBlank()){
            URI uri=URI.create(receiver);if(!Set.of("http","https").contains(uri.getScheme()) || uri.getHost()==null || uri.getUserInfo()!=null)throw new IllegalArgumentException("接收地址须为 HTTP/HTTPS URL");
        }
        PackagePayloadService.PackagedPayload pkg=packaging.build(uploads,name,kind);
        Job job=new Job();job.id=UUID.randomUUID().toString();job.name=pkg.fileName();job.kind=pkg.packageKind();job.entries=pkg.entryCount();job.scene=scene;job.level=level;job.created=System.currentTimeMillis();job.originalBytes=pkg.rawFileBytes();job.receiver=receiver;
        job.recognition=recognition.recognize(job.name,pkg.mimeType(),pkg.payload(),"USER_UPLOAD",scene);
        job.priority=classification.decide(job.recognition,scene,priority,job.created);
        Files.createDirectories(directory(job));Files.write(directory(job).resolve("input.dccpkg"),pkg.payload());
        jobs.put(job.id,job);persist(job);queue.offer(job);return job;
    }
    public List<Job> list(){return jobs.values().stream().sorted(Comparator.comparingLong((Job j)->j.created).reversed()).toList();}
    public Job get(String id){Job j=jobs.get(id);if(j==null)throw new IllegalArgumentException("任务不存在");return j;}
    public synchronized Job action(String id,String action)throws IOException{
        Job job=get(id);
        switch(action){
            case "pause" -> {if(!terminal(job.state)){job.pause=true;job.state=TaskState.PAUSED;job.message="在下一个处理边界暂停";}}
            case "resume" -> {if(job.state==TaskState.PAUSED){job.pause=false;job.state=owned.contains(id)?TaskState.TRANSMITTING:TaskState.QUEUED;job.message="恢复执行";}}
            case "cancel" -> {if(!terminal(job.state)){job.cancel=true;job.pause=false;queue.remove(job);job.state=TaskState.CANCELLED;job.finished=System.currentTimeMillis();job.message="任务已取消";}}
            case "retry" -> {
                if(job.state!=TaskState.FAILED && job.state!=TaskState.CANCELLED)throw new IllegalArgumentException("只有失败或取消的任务可重试");
                if(owned.contains(id))throw new IllegalArgumentException("任务尚在结束当前操作，请稍后重试");
                if(!Files.exists(directory(job).resolve("input.dccpkg")))throw new IllegalArgumentException("原始数据不可用");
                job.pause=false;job.cancel=false;job.error="";job.progress=0;job.verified=false;job.finished=0;job.attempts=0;job.state=TaskState.RETRYING;job.message="重新排队";queue.offer(job);
            }
            default -> throw new IllegalArgumentException("不支持的任务操作");
        }
        persist(job);return job;
    }
    private void checkpoint(Job job)throws InterruptedException{
        while(job.pause && !job.cancel && running)Thread.sleep(100);
        if(job.cancel || !running || Thread.currentThread().isInterrupted())throw new InterruptedException("任务停止");
    }
    private void stage(Job job,TaskState state,double progress,String message)throws Exception{
        checkpoint(job);job.state=state;job.progress=progress;job.message=message;persist(job);
    }
    private void execute(Job job){
        try{
            stage(job,TaskState.PROFILING,5,"读取原始任务包");
            byte[] input=Files.readAllBytes(directory(job).resolve("input.dccpkg"));
            List<PackagePayloadService.PackageEntryData> originals=packaging.readEntries(input);
            long begin=System.nanoTime();ByteArrayOutputStream buffer=new ByteArrayOutputStream();
            try(ZipOutputStream zip=new ZipOutputStream(buffer)){
                zip.setLevel(job.level);
                for(int n=0;n<originals.size();n++){
                    checkpoint(job);var file=originals.get(n);zip.putNextEntry(new ZipEntry(file.path()));
                    byte[] bytes=file.bytes();for(int at=0;at<bytes.length;at+=65536){checkpoint(job);zip.write(bytes,at,Math.min(65536,bytes.length-at));}
                    zip.closeEntry();job.progress=10+30.0*(n+1)/originals.size();
                }
            }
            byte[] packed=buffer.toByteArray();job.compressMillis=(System.nanoTime()-begin)/1000000.0;job.compressedBytes=packed.length;job.checksum=sha(packed);
            Files.write(directory(job).resolve("compressed.zip"),packed);
            stage(job,TaskState.TRANSMITTING,45,"通过 HTTP 投递压缩包，等待接收端校验 ACK");
            String destination=job.receiver;
            if(destination==null || destination.isBlank())destination="http://127.0.0.1:"+serverPort+"/api/receive";
            begin=System.nanoTime();boolean delivered=false;Exception last=null;
            for(int attempt=1;attempt<=3;attempt++){
                checkpoint(job);job.attempts=attempt;
                try{
                    HttpRequest request=HttpRequest.newBuilder(URI.create(destination)).timeout(Duration.ofSeconds(15)).header("Content-Type","application/zip").header("X-Task-Id",job.id).header("X-Checksum-Sha256",job.checksum).POST(HttpRequest.BodyPublishers.ofByteArray(packed)).build();
                    HttpResponse<String> response=http.send(request,HttpResponse.BodyHandlers.ofString());
                    if(response.statusCode()!=200)throw new IOException("接收端状态码 "+response.statusCode());
                    var ack=mapper.readTree(response.body());job.receiptChecksum=ack.path("sha256").asText();
                    if(!job.checksum.equals(job.receiptChecksum) || ack.path("bytes").asLong()!=packed.length)throw new IOException("接收端校验 ACK 不匹配");
                    delivered=true;break;
                }catch(IOException e){last=e;if(attempt<3){job.message="链路失败，等待自动重试 "+attempt+"/3";Thread.sleep(200L*attempt);}}
            }
            if(!delivered)throw last==null?new IOException("投递失败"):last;
            job.transferMillis=(System.nanoTime()-begin)/1000000.0;
            stage(job,TaskState.VERIFYING,80,"解压恢复并逐文件比较 SHA-256");
            begin=System.nanoTime();List<PackagePayloadService.PackageEntryData> restored=packaging.readAnyEntries(packed);
            if(originals.size()!=restored.size())throw new IOException("恢复文件数量不匹配");
            for(int n=0;n<originals.size();n++){
                checkpoint(job);var a=originals.get(n);var b=restored.get(n);
                if(!a.path().equals(b.path()) || !sha(a.bytes()).equals(sha(b.bytes())))throw new IOException("恢复文件校验失败: "+a.path());
                Path root=directory(job).resolve("restored");Path path=root.resolve(b.path()).normalize();if(!path.startsWith(root))throw new IOException("非法文件路径");
                Files.createDirectories(path.getParent());Files.write(path,b.bytes());
            }
            job.restoreMillis=(System.nanoTime()-begin)/1000000.0;job.verified=true;
            stage(job,TaskState.COMPLETED,100,"压缩、实际 HTTP 传输及逐文件恢复校验全部完成");job.finished=System.currentTimeMillis();persist(job);
        }catch(InterruptedException interrupted){
            if(job.cancel){job.state=TaskState.CANCELLED;job.message="已取消；接收端已接收的文件会保留";}else{job.state=TaskState.FAILED;job.error="执行中断，可重试";job.message=job.error;}
            job.finished=System.currentTimeMillis();try{persist(job);}catch(IOException ignored){}
        }catch(Exception e){job.state=TaskState.FAILED;job.error=e.toString();job.message="任务失败，可查看错误并重试";job.finished=System.currentTimeMillis();try{persist(job);}catch(IOException ignored){}}
    }
    @Value("${server.port:8105}") private int serverPort;
    private boolean terminal(TaskState state){return state==TaskState.COMPLETED||state==TaskState.FAILED||state==TaskState.CANCELLED;}
    private Path directory(Job job){return home.resolve("jobs").resolve(job.id);}
    private synchronized void persist(Job job)throws IOException{
        Path temp=directory(job).resolve("job.json.tmp");mapper.writerWithDefaultPrettyPrinter().writeValue(temp.toFile(),job);Files.move(temp,directory(job).resolve("job.json"),StandardCopyOption.REPLACE_EXISTING);
    }
    public byte[] download(String id,String kind)throws IOException{
        Job job=get(id);if(!Set.of("compressed","restored").contains(kind))throw new IllegalArgumentException("下载类型无效");
        if(job.state!=TaskState.COMPLETED)throw new IllegalArgumentException("任务尚未完成");
        Path path=directory(job).resolve("compressed.zip");
        if(kind.equals("compressed"))return Files.readAllBytes(path);
        Path recovered=directory(job).resolve("restored");ByteArrayOutputStream output=new ByteArrayOutputStream();
        try(ZipOutputStream zip=new ZipOutputStream(output);var paths=Files.walk(recovered)){
            for(Path file:paths.filter(Files::isRegularFile).sorted().toList()){
                zip.putNextEntry(new ZipEntry(recovered.relativize(file).toString().replace('\\','/')));Files.copy(file,zip);zip.closeEntry();
            }
        }
        return output.toByteArray();
    }
    public Map<String,Object> receive(byte[] body,String id,String checksum)throws Exception{
        UUID.fromString(id);if(body.length==0||body.length>70L*1024*1024)throw new IllegalArgumentException("接收包大小无效");
        String actual=sha(body);if(!actual.equalsIgnoreCase(checksum))throw new IllegalArgumentException("传输 SHA-256 不匹配");
        Path delivery=home.resolve("received").resolve(id);Path root=delivery.resolve("files");Files.createDirectories(root);
        long expanded=0;int count=0;
        try(ZipInputStream zip=new ZipInputStream(new ByteArrayInputStream(body))){
            ZipEntry e;
            while((e=zip.getNextEntry())!=null){
                if(e.isDirectory())continue;if(++count>10000)throw new IllegalArgumentException("接收文件数过多");
                Path p=root.resolve(e.getName()).normalize();if(!p.startsWith(root) || p.equals(root))throw new IllegalArgumentException("接收文件路径无效");Files.createDirectories(p.getParent());
                try(OutputStream dst=Files.newOutputStream(p)){byte[] chunk=new byte[65536];int n;while((n=zip.read(chunk))!=-1){expanded+=n;if(expanded>64L*1024*1024)throw new IllegalArgumentException("接收包解压超过 64 MiB");dst.write(chunk,0,n);}}
            }
        }
        if(count==0)throw new IllegalArgumentException("不是有效的文件 ZIP 包");
        Files.write(delivery.resolve("transport.zip"),body);
        return Map.of("sha256",actual,"bytes",body.length,"files",count,"ack","STORED_AND_RESTORED");
    }
    private String sha(byte[] data)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));}
}
