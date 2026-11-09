"""Simulated RWT1 UART -> real PC compression/HTTP -> Java 26-channel export."""
import base64,json,os,pathlib,pty,select,signal,struct,subprocess,sys,tempfile,threading,time,urllib.request
from binascii import crc_hqx
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'serial-agent'))
from wheel_agent import http
from wheel_protocol import FULL_CHANNELS
BASE='http://127.0.0.1:8082';OPEN=bytes.fromhex('A0AC08BA66')
raw=struct.pack('<26f',*range(1,27))
def packet(seq):
    p=struct.pack('<4sBBHII',b'RWT1',1,26,104,seq,seq*10)+raw
    return p+struct.pack('<H',crc_hqx(p,0xffff))
def status():return http(BASE,'/api/wheel/status')
def config(mode,period):return http(BASE,'/api/wheel/config',json.dumps({'mode':mode,'periodMs':period}).encode(),{'Content-Type':'application/json'},'PUT')
def wait(check):
    end=time.monotonic()+15
    while time.monotonic()<end:
        if check():return
        time.sleep(.05)
    raise AssertionError(status())
config('AUTO',100)
master,slave=pty.openpty();stop=threading.Event();commands=bytearray();errors=[]
def device():
    enabled=False;seq=0
    try:
        while not stop.is_set():
            ready,_,_=select.select([master],[],[],.01)
            if ready:
                commands.extend(os.read(master,1024))
                if OPEN in commands and not enabled:enabled=True;os.write(master,bytes.fromhex('A0AC08BA99'))
            if enabled:
                p=bytearray(packet(seq))
                if seq==1:p[-1]^=1
                os.write(master,p[:7]);os.write(master,p[7:]);seq+=1;time.sleep(.01)
    except Exception as e:errors.append(str(e))
with tempfile.TemporaryDirectory(prefix='raw26-e2e-') as tmp:
    record=pathlib.Path(tmp)/'capture.rwt'
    agent=subprocess.Popen([sys.executable,str(ROOT/'serial-agent/wheel_agent.py'),'--protocol','raw26','--port',os.ttyname(slave),'--enable-stream','--backend',BASE,'--record',str(record)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    thread=threading.Thread(target=device,daemon=True);thread.start()
    try:
        wait(lambda:status()['sourceProtocol']=='RAW26_RWT1' and status()['configApplied'])
        s=status();assert s['channels']==FULL_CHANNELS and s['timeSource']=='DEVICE'
        assert len(s['latest']['values'])==26 and s['latest']['values']==list(range(1,27))
        assert base64.b64decode(s['latest']['rawBase64'])==raw
        config('RAW',20)
        wait(lambda:status()['configApplied'] and status()['latest']['mode']=='RAW' and status()['latest']['periodMs']==20)
        assert status()['latest']['codec']=='RAW'
        csv=urllib.request.urlopen(BASE+'/api/wheel/export.csv').read().decode()
        assert csv.startswith('sequence,device_ms,received_at,codec,mode,batch_period_ms,')
        assert len(csv.splitlines()[0].split(','))==32 and 'wheel1_id,wheel2_id,wheel3_id' in csv
    finally:
        agent.send_signal(signal.SIGINT);out,err=agent.communicate(timeout=12);stop.set();thread.join(timeout=2);os.close(master);os.close(slave);print(out,err)
    assert agent.returncode==0 and not errors,(agent.returncode,errors)
    assert bytes(commands)==OPEN,commands.hex()
    assert record.stat().st_size>122
    replay=pathlib.Path(tmp)/'replay.rwt';replay.write_bytes(b''.join(packet(i) for i in range(20)))
    before=status()['acceptedFrames']
    subprocess.run([sys.executable,str(ROOT/'serial-agent/wheel_agent.py'),'--protocol','raw26','--replay',str(replay),'--backend',BASE],check=True)
    s=status();assert s['acceptedFrames']-before==20 and s['latest']['deviceMillis']==190 and not s['configApplied']
result={'raw26PTY':'PASS','all26FieldsExact':'PASS','raw104BytesExact':'PASS','deviceClockAndSequence':'PASS','hostConfigOnly':'PASS','csvColumns':32,'replayFrames':20,'hardwareTested':False}
(ROOT/'tests/raw26-e2e-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
