"""Run against a fresh local backend (:8082) and bridge (:8080).
Usage: python tests/e2e.py (Linux + pyserial for the pseudo-terminal test).
"""
import base64
import ctypes
import json
import os
import pathlib
import pty
import select
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from binascii import crc_hqx

ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'serial-agent'))
from wheel_agent import http, upload
BASE='http://127.0.0.1:8082'

def wait_for(check, timeout=12):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        value=check()
        if value:return value
        time.sleep(.1)
    raise AssertionError('condition timed out')

def status():return http(BASE,'/api/wheel/status')
def config(mode,period):
    return http(BASE,'/api/wheel/config',json.dumps({'mode':mode,'periodMs':period}).encode(),
                {'Content-Type':'application/json'},'PUT')

initial=status()['acceptedFrames']
subprocess.run([sys.executable,str(ROOT/'serial-agent/wheel_agent.py'),
                '--replay',str(ROOT/'examples/historical-gyro.dcw'),'--backend',BASE],check=True)
s=status()
assert s['acceptedFrames']-initial==1000,s
assert s['inputMode']=='REPLAY'
assert s['wireBytes']>=36028
# HTTP retry and atomic CRC rejection.
frame=bytes.fromhex(json.loads((ROOT/'tests/vectors.json').read_text())[0]['frameHex'])
session='replay-'+str(uuid.uuid4());batch=str(uuid.uuid4())
assert upload(BASE,session,batch,frame)['accepted']==1
assert upload(BASE,session,batch,frame)['duplicateBatch']
before=status()['acceptedFrames']
try:
    upload(BASE,session,str(uuid.uuid4()),frame+frame[:-1]+bytes([frame[-1]^1]))
    raise AssertionError('accepted corrupt batch')
except urllib.error.HTTPError as e:assert e.code==400
assert status()['acceptedFrames']==before
for bad in [1,10.5,1001]:
    try:config('AUTO',bad);raise AssertionError('bad config accepted')
    except urllib.error.HTTPError as e:assert e.code==400

master,slave=pty.openpty();slave_name=os.ttyname(slave)
stop=threading.Event();seen=[];state={'mode':1,'period':10,'enabled':False}
codec=ctypes.CDLL(str(ROOT/'tests/build/codec.so'))
codec.Wheel_Encode.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_uint32,ctypes.c_uint8,ctypes.c_uint16,ctypes.c_void_p,ctypes.c_size_t]
codec.Wheel_Encode.restype=ctypes.c_size_t

def device():
    command=bytearray();seq=0;ticks=0;next_emit=time.monotonic()
    while not stop.is_set():
        readable,_,_=select.select([master],[],[],.002)
        if readable:
            try:data=os.read(master,1024)
            except OSError:continue
            command.extend(data)
            while command:
                if command.startswith(bytes.fromhex('A0AC08BA66')):
                    seen.append('OPEN_TELEMETRY');state['enabled']=True;del command[:5]
                    os.write(master,bytes.fromhex('A0AC08BA99'));continue
                if command.startswith(b'CW') and len(command)>=8:
                    c=bytes(command[:8]);del command[:8]
                    assert crc_hqx(c[:6],0xffff)==struct.unpack_from('<H',c,6)[0]
                    assert c[2]==1 and c[3] in (0,1)
                    state['mode']=c[3];state['period']=struct.unpack_from('<H',c,4)[0]
                    seen.append('TELEMETRY_CONFIG');continue
                if len(command)<8:break
                raise AssertionError(f'unexpected host command: {command.hex()}')
        now=time.monotonic()
        if state['enabled'] and now>=next_emit:
            raw=ctypes.create_string_buffer(struct.pack('<16f',.125,-.5,1.0,*([0.0]*13)))
            out=ctypes.create_string_buffer(86)
            n=codec.Wheel_Encode(raw,seq,ticks,state['mode'],state['period'],out,86)
            # Deliberately fragment every frame on the byte stream.
            os.write(master,out.raw[:7]);os.write(master,out.raw[7:n])
            seq+=1;ticks+=state['period'];next_emit=now+state['period']/1000

with tempfile.TemporaryDirectory(prefix='wheel-e2e-') as tmp:
    record=pathlib.Path(tmp)/'serial.dcw'
    agent=subprocess.Popen([sys.executable,str(ROOT/'serial-agent/wheel_agent.py'),
                            '--port',slave_name,'--backend',BASE,'--enable-stream','--record',str(record)],
                           stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    thread=threading.Thread(target=device,daemon=True);thread.start()
    try:
        wait_for(lambda:status()['inputMode']=='SERIAL' and status()['latest']['sequence']>3)
        config('RAW',20)
        wait_for(lambda:status()['configApplied'] and status()['latest']['mode']=='RAW'
                 and status()['latest']['periodMs']==20)
        s=status();assert base64.b64decode(s['latest']['rawBase64'])==struct.pack('<16f',.125,-.5,1.0,*([0.0]*13))
        assert s['latest']['codec']=='RAW'
    finally:
        agent.send_signal(signal.SIGINT)
        stdout,stderr=agent.communicate(timeout=10)
        stop.set();thread.join(timeout=2)
        os.close(master);os.close(slave)
        print(stdout,stderr)
        assert agent.returncode==0,agent.returncode
    assert record.stat().st_size>0
assert 'OPEN_TELEMETRY' in seen and 'TELEMETRY_CONFIG' in seen
result={'historicalReplayFrames':1000,'binaryUpload':'PASS','crcAtomicRejection':'PASS',
        'httpIdempotency':'PASS','configurationBounds':'PASS','serialPTYCapture':'PASS',
        'deviceConfigConfirmation':'PASS','rawBytesExact':'PASS','hostCommands':sorted(set(seen)),
        'hardwareTested':False}
(ROOT/'tests/e2e-result.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,ensure_ascii=False,indent=2))
