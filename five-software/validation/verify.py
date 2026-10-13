"""Run executable applications one at a time and exercise their real APIs.

Requires Python 3.10+ and Java 17+. UI checks additionally require Playwright
and Chromium. Does not build, alter source, or call external services.
"""
from pathlib import Path
import subprocess, json, os, sys, time, math, io, zipfile, threading, hashlib
import urllib.request, urllib.error, http.server, tempfile, argparse

ROOT=Path(__file__).resolve().parents[1]
RESULTS=[]
OPENER=urllib.request.build_opener(urllib.request.ProxyHandler({}))

def check(label,condition):
    if not condition:raise AssertionError(label)
    RESULTS.append(label);print('PASS',label,flush=True)

def raw(port,path,method='GET',data=None,headers=None):
    req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=data,method=method,headers=headers or {})
    try:
        with OPENER.open(req,timeout=20) as response:return response.status,response.read()
    except urllib.error.HTTPError as error:return error.code,error.read()

def api(port,path,body=None,method=None):
    code,data=raw(port,path,method or ('POST' if body is not None else 'GET'),json.dumps(body).encode() if body is not None else None,{'Content-Type':'application/json'})
    if code!=200:raise RuntimeError(f'{path}: HTTP {code} {data[:500]!r}')
    return json.loads(data)

def multipart(port,path,files,fields=None):
    boundary='--DataCompressSplitVerification';chunks=[]
    for field,filename,body in files:
        chunks.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()+body+b'\r\n')
    for key,value in (fields or {}).items():
        chunks.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n').encode())
    chunks.append(f'--{boundary}--\r\n'.encode())
    code,body=raw(port,path,'POST',b''.join(chunks),{'Content-Type':f'multipart/form-data; boundary={boundary}'})
    if code!=200:raise RuntimeError(f'{path}: HTTP {code} {body[:1000]!r}')
    return body

def wait_job(port,id,state='COMPLETED'):
    until=time.monotonic()+20
    while time.monotonic()<until:
        job=api(port,'/api/tasks/'+id)
        if job['state']==state:return job
        if job['state'] in ('FAILED','CANCELLED') and job['state']!=state:raise AssertionError(job)
        time.sleep(.1)
    raise AssertionError(f'Task timeout: {job}')

def monitor(port,storage):
    initial=api(port,'/api/monitor')
    check('监测：未接入的源不伪报新鲜遥测',all(not r['status']['fresh'] for r in initial))
    for source,rate in [('alpha',1400),('beta',25)]:
        api(port,'/api/monitor/'+source+'/telemetry',{'throughputKbps':rate,'rttMillis':30,'jitterMillis':5,'packetLossPercent':0,'connectionState':'CONNECTED'})
    rows={r['sourceId']:r for r in api(port,'/api/monitor')}
    check('监测：两源速率分别保留',rows['alpha']['current']['throughputKbps']==1400 and rows['beta']['current']['throughputKbps']==25)
    check('监测：低速链路触发告警',any(a['source']=='beta' for a in api(port,'/api/alarms')))
    api(port,'/api/monitor/demo-check/demo?enabled=true',method='POST')
    rows={r['sourceId']:r for r in api(port,'/api/monitor')}
    check('监测：演示数据明确标识',rows['demo-check']['demo'] and rows['demo-check']['status']['source']=='SIMULATION')
    api(port,'/api/monitor/demo-check/demo?enabled=false',method='POST')
    rows={r['sourceId']:r for r in api(port,'/api/monitor')}
    check('监测：关闭演示清除新鲜状态',not rows['demo-check']['status']['fresh'])
    check('监测：拒绝负速率',raw(port,'/api/monitor/alpha/telemetry','POST',b'{"throughputKbps":-1}',{'Content-Type':'application/json'})[0]==400)

SAMPLE=('sensor,temperature,state\nA,23.5,NORMAL\n'*500).encode()

def strategy(port,storage):
    measurements=json.loads(multipart(port,'/api/strategy/measure',[('file','sample.txt',SAMPLE)]))
    check('策略：独立实测得到四条画像',len(measurements['profiles'])==4 and measurements['timingsMeasured'])
    request={'profiles':measurements['profiles'],'bytes':len(SAMPLE),'safeRateKbps':1,'packetLossPercent':0,'quality':'GOOD','priority':'NORMAL','heldMillis':2000}
    report=api(port,'/api/strategy/analyze',request)
    check('策略：慢链路选择实际压缩',report['selected']['algorithm']=='DEFLATE')
    previous=api(port,'/api/strategy/analyze',{**request,'profiles':[measurements['profiles'][0]]})['selected']
    held=api(port,'/api/strategy/analyze',{**request,'previous':previous,'heldMillis':200})
    check('策略：短保持期阻止切换',held['selected']['algorithm']=='NONE')
    cache=api(port,'/api/strategy/analyze',{**request,'quality':'DISCONNECTED'})
    check('策略：断连普通任务建议缓存',cache['selected']['cache'])
    check('策略：拒绝空画像',raw(port,'/api/strategy/analyze','POST',json.dumps({**request,'profiles':[]}).encode(),{'Content-Type':'application/json'})[0]==400)

def prediction(port,storage):
    rates=[1200+100*math.sin(i/7) for i in range(60)]
    full=api(port,'/api/prediction',{'rates':rates,'lossPercent':0,'jitterMillis':5})
    check('预测：原 LSTM 权重成功推理','LSTM' in full['modelName'] and len(full['predictedRatesKbps'])==12 and not full['degraded'])
    check('预测：安全预算为有限正值',math.isfinite(full['safeRateKbps']) and full['safeRateKbps']>0)
    short=api(port,'/api/prediction',{'rates':[1200,1210,1190],'lossPercent':0,'jitterMillis':5})
    check('预测：短历史明确回退',short['modelName']=='FAST_HOLT_WARMUP' and short['degraded'])
    feedback=api(port,'/api/prediction/feedback',{'predicted':1200,'actual':1000})
    check('预测：反馈更新健康指标',feedback['rollingSamples']==1)
    check('预测：拒绝负样本',raw(port,'/api/prediction','POST',b'{"rates":[-2]}',{'Content-Type':'application/json'})[0]==400)
    check('预测：零实际值明确拒绝，避免假报已校正',raw(port,'/api/prediction/feedback','POST',b'{"predicted":1000,"actual":0}',{'Content-Type':'application/json'})[0]==400)

def library(port,storage):
    methods=api(port,'/api/library');check('算法库：提供 10 个无损方法',len(methods)==10)
    result=json.loads(multipart(port,'/api/library/benchmark',[('file','sample.txt',SAMPLE)]))
    check('算法库：10 方法压缩恢复内容一致',len(result['profiles'])==10 and all(p.get('verified') for p in result['profiles']))
    binary=bytes(range(256))*20
    packed=multipart(port,'/api/library/compress',[('file','binary.bin',binary)],{'algorithm':'ZSTD','level':'3'})
    restored=multipart(port,'/api/library/restore',[('file','binary.dclib',packed)])
    check('算法库：文件压缩下载恢复逐字节一致',restored==binary)
    api(port,'/api/library/ZSTD/enabled?value=false',method='POST')
    disabled=json.loads(multipart(port,'/api/library/benchmark',[('file','sample.txt',SAMPLE)]))
    check('算法库：停用方法不参与基准',all(p['algorithm']!='ZSTD' for p in disabled['profiles']))
    check('算法库：已停用方法仍可恢复既有包',multipart(port,'/api/library/restore',[('file','existing.dclib',packed)])==binary)
    api(port,'/api/library/ZSTD/enabled?value=true',method='POST')

def transfer(port,storage):
    files=[('files','folder/a.txt',SAMPLE),('files','folder/data.bin',bytes(range(256))*10)]
    job=json.loads(multipart(port,'/api/tasks',files,{'kind':'FOLDER','name':'folder','level':'6'}))
    done=wait_job(port,job['id'])
    check('任务：实际 HTTP 接收 ACK 与恢复校验通过',done['verified'] and done['checksum']==done['receiptChecksum'] and done['attempts']==1)
    code,body=raw(port,f'/api/tasks/{job["id"]}/download/restored')
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        check('任务：恢复 ZIP 保留目录及原始内容',z.read('folder/a.txt')==SAMPLE and z.read('folder/data.bin')==bytes(range(256))*10)
    received=storage/'received'/job['id']/'files'/'folder'/'a.txt'
    check('任务：接收端真实落盘',received.read_bytes()==SAMPLE)
    failed=json.loads(multipart(port,'/api/tasks',[('files','failure.txt',SAMPLE)],{'receiver':'http://127.0.0.1:1/api/receive'}))
    fail=wait_job(port,failed['id'],'FAILED')
    check('任务：断链自动重试三次后标记失败',fail['attempts']==3 and bool(fail['error']))
    class SlowReceiver(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            body=self.rfile.read(int(self.headers['Content-Length']));time.sleep(1)
            response=json.dumps({'sha256':hashlib.sha256(body).hexdigest(),'bytes':len(body)}).encode();self.send_response(200);self.end_headers();self.wfile.write(response)
        def log_message(self,*args):pass
    receiver=http.server.ThreadingHTTPServer(('127.0.0.1',0),SlowReceiver)
    thread=threading.Thread(target=receiver.serve_forever,daemon=True);thread.start()
    try:
        blocker=json.loads(multipart(port,'/api/tasks',[('files','blocker.txt',SAMPLE)],{'receiver':f'http://127.0.0.1:{receiver.server_port}'}))
        held=json.loads(multipart(port,'/api/tasks',[('files','pause.txt',SAMPLE)]))
        check('任务：暂停排队任务',api(port,f'/api/tasks/{held["id"]}/pause',method='POST')['state']=='PAUSED')
        cancelled=json.loads(multipart(port,'/api/tasks',[('files','cancel.txt',SAMPLE)]))
        check('任务：取消任务进入终态',api(port,f'/api/tasks/{cancelled["id"]}/cancel',method='POST')['state']=='CANCELLED')
        wait_job(port,blocker['id']);time.sleep(.3)
        check('任务：暂停期间没有继续执行',api(port,'/api/tasks/'+held['id'])['state']=='PAUSED')
        api(port,f'/api/tasks/{held["id"]}/resume',method='POST');check('任务：恢复后完成同一任务',wait_job(port,held['id'])['verified'])
        api(port,f'/api/tasks/{cancelled["id"]}/retry',method='POST');check('任务：取消后可重试原始数据',wait_job(port,cancelled['id'])['verified'])
    finally:receiver.shutdown();receiver.server_close()
    return job['id']

def launch(app,port,storage):
    binary=app/'app.jar'
    if not binary.exists():binary=app/'target'/(app.name+'-1.0.0.jar')
    log=(storage.parent/(app.name+'.log')).open('w')
    p=subprocess.Popen([os.environ.get('JAVA','java'),'-jar',str(binary),'--server.address=127.0.0.1',f'--server.port={port}',f'--tasks.storage={storage}'],cwd=app,stdout=log,stderr=subprocess.STDOUT)
    until=time.monotonic()+40
    while time.monotonic()<until:
        if p.poll() is not None:raise RuntimeError((storage.parent/(app.name+'.log')).read_text())
        try:
            if api(port,'/actuator/health').get('status')=='UP':return p,log
        except Exception:pass
        time.sleep(.2)
    p.terminate();raise RuntimeError('Startup timed out')

def stop(process,log):
    process.terminate()
    try:process.wait(timeout=8)
    except subprocess.TimeoutExpired:process.kill();process.wait()
    log.close()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--browser',action='store_true');parser.add_argument('--output',type=Path);args=parser.parse_args()
    output=args.output or Path(tempfile.mkdtemp(prefix='dc-split-verify-'));output.mkdir(parents=True,exist_ok=True)
    cases=[monitor,strategy,prediction,library,transfer]
    projects=sorted(p for p in ROOT.iterdir() if p.is_dir() and p.name[:2].isdigit())
    for i,(app,case) in enumerate(zip(projects,cases)):
        port=8101+i;storage=output/(app.name+'-runtime');storage.mkdir(exist_ok=True)
        process,log=launch(app,port,storage)
        try:
            code,page=raw(port,'/');check(app.name+' 独立启动并提供专属界面',code==200 and '软件'.encode() in page)
            saved=case(port,storage)
            if args.browser:
                subprocess.run(['node',str(ROOT/'validation/browser-check.mjs'),app.name,str(port),str(output/(app.name+'.png'))],check=True)
                check(app.name+' 浏览器核心交互',True)
        finally:stop(process,log)
        if case==transfer:
            process,log=launch(app,port,storage)
            try:
                check('任务：重启后保留历史和恢复下载',api(port,'/api/tasks/'+saved)['verified'] and raw(port,f'/api/tasks/{saved}/download/restored')[0]==200)
            finally:stop(process,log)
    (output/'functional-results.json').write_text(json.dumps({'passed':len(RESULTS),'checks':RESULTS},ensure_ascii=False,indent=2))
    print('ALL CHECKS PASSED:',len(RESULTS),'output:',output)

if __name__=='__main__':main()
