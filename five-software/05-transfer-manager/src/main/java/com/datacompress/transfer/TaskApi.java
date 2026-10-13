package com.datacompress.transfer;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.http.*;
import java.util.*;
@RestController
public class TaskApi {
    private final TaskFlow tasks;
    public TaskApi(TaskFlow tasks){this.tasks=tasks;}
    @GetMapping("/api/tasks") public List<TaskFlow.Job> list(){return tasks.list();}
    @GetMapping("/api/tasks/{id}") public TaskFlow.Job detail(@PathVariable String id){return tasks.get(id);}
    @PostMapping("/api/tasks") public TaskFlow.Job create(@RequestParam List<MultipartFile> files,@RequestParam(required=false) String name,@RequestParam(defaultValue="FILE") String kind,@RequestParam(defaultValue="一般数据传输") String scene,@RequestParam(defaultValue="AUTO") String priority,@RequestParam(defaultValue="6") int level,@RequestParam(required=false) String receiver)throws Exception{return tasks.submit(files,name,kind,scene,priority,level,receiver);}
    @PostMapping("/api/tasks/{id}/{action}") public TaskFlow.Job control(@PathVariable String id,@PathVariable String action)throws Exception{return tasks.action(id,action);}
    @GetMapping("/api/tasks/{id}/download/{kind}") public ResponseEntity<byte[]> download(@PathVariable String id,@PathVariable String kind)throws Exception{return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM).header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename="+kind+"-"+id+".zip").body(tasks.download(id,kind));}
    @PostMapping(value="/api/receive",consumes="application/zip") public Map<String,Object> receive(@RequestBody byte[] bytes,@RequestHeader("X-Task-Id") String id,@RequestHeader("X-Checksum-Sha256") String checksum)throws Exception{return tasks.receive(bytes,id,checksum);}
    @ExceptionHandler(IllegalArgumentException.class) public ResponseEntity<Map<String,String>> invalid(IllegalArgumentException error){return ResponseEntity.badRequest().body(Map.of("error","TASK_INPUT_INVALID","message",String.valueOf(error.getMessage())));}
}
