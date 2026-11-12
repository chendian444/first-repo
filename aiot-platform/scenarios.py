"""Application-level HTTP fault injection; never alters host networking or motor commands."""
import random
import time
import uuid
from gateway import Outbox, envelope, post
from common import InputStream

PROFILES={
 'baseline':dict(delay=0,jitter=0,loss=0,ackLoss=0,offline=0,kbps=0),
 'latency':dict(delay=0.03,jitter=0.02,loss=0,ackLoss=0,offline=0,kbps=0),
 'loss':dict(delay=0,jitter=0,loss=0.3,ackLoss=0,offline=0,kbps=0),
 'ack_loss':dict(delay=0,jitter=0,loss=0,ackLoss=0.4,offline=0,kbps=0),
 'disconnect':dict(delay=0,jitter=0,loss=0,ackLoss=0,offline=0.4,kbps=0),
 'bandwidth':dict(delay=0,jitter=0,loss=0,ackLoss=0,offline=0,kbps=128),
}

def run_suite(base,device,token,record,protocol,directory,seed=2026,profiles=None):
    import base64,json
    frames=list(InputStream(protocol).feed(record.read_bytes()))[:100]
    if not frames:raise ValueError('fixture has no valid frames')
    results=[]
    for name in profiles or PROFILES:
        profile=PROFILES[name];rng=random.Random(seed);session=uuid.uuid4().hex
        box=Outbox(directory/(name+'-'+session+'.db'))
        for i in range(0,len(frames),20):box.add(envelope(session,frames[i:i+20],'replay'))
        initial=box.size();attempts=0;faults=0;duplicates=0;rtts=[];start=time.monotonic();accepted=0
        def deliver(payload):
            nonlocal attempts,faults,duplicates,accepted
            attempts+=1
            if time.monotonic()-start<profile['offline'] or rng.random()<profile['loss']:
                faults+=1;raise OSError('injected request loss/offline')
            t=time.monotonic()
            delay=max(0,profile['delay']+rng.uniform(-profile['jitter'],profile['jitter']))
            if profile['kbps']:delay+=len(json.dumps(payload).encode())*8/(profile['kbps']*1000)
            time.sleep(delay)
            reply=post(base,'/api/devices/'+device+'/telemetry',payload,token)
            accepted+=reply['accepted'];duplicates+=int(reply['duplicate'])
            if rng.random()<profile['ackLoss']:
                faults+=1;raise OSError('injected lost ACK after commit')
            rtts.append((time.monotonic()-t)*1000);return reply
        while box.size() and time.monotonic()-start<20:
            try:box.send_one(deliver)
            except OSError:time.sleep(0.03)
        elapsed=time.monotonic()-start
        ordered=sorted(rtts)
        results.append(dict(scenario=name,profile=profile,seed=seed,session=session,expectedFrames=len(frames),
            acceptedFrames=accepted,pendingBatches=box.size(),initialBatches=initial,attempts=attempts,injectedFaults=faults,
            duplicateACKs=duplicates,p95DeliveryMs=ordered[min(len(ordered)-1,int(len(ordered)*0.95))] if ordered else None,
            elapsedSeconds=elapsed,passed=box.size()==0 and accepted==len(frames)))
    return {'kind':'application_http_fault_injection','inputOrigin':'recorded_replay','hardwareTested':False,
            'seed':seed,'results':results,'passed':all(r['passed'] for r in results),
            'analysis':['ACK丢失后的同批次重试必须去重；请求丢失不代表设备采样丢失。',
                        '延迟统计包含注入等待、HTTP与服务处理，不是蓝牙时延或单程网络时延。',
                        '该报告验证应用重试与恢复，实机串口、Wi-Fi射频和电池状态需另行验收。']}
