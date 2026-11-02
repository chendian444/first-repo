"""Real PTY -> PC encoder -> HTTP -> Java decode; run against local backend :8082."""
import base64
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

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'serial-agent'))
from wheel_agent import http
from wheel_protocol import LegacyParser
BASE = 'http://127.0.0.1:8082'
OPEN = bytes.fromhex('A0AC08BA66')

def status(): return http(BASE, '/api/wheel/status')
def config(mode, period):
    return http(BASE, '/api/wheel/config', json.dumps({'mode':mode,'periodMs':period}).encode(),
                {'Content-Type':'application/json'}, 'PUT')
def wait(check, timeout=15):
    end = time.monotonic()+timeout
    while time.monotonic()<end:
        result = check()
        if result: return result
        time.sleep(.05)
    raise AssertionError('timed out: '+str(status()))
def frame(raw): return b'\x23'+raw+bytes([sum(raw)&255])

config('AUTO', 100)
master, slave = pty.openpty()
stop = threading.Event(); commands = bytearray(); errors = []
raw = struct.pack('<16f', .125, -.5, 1., *([0.]*11), 12., -7.)
bad = bytearray(frame(bytes(64))); bad[-1] ^= 1

def device():
    enabled = False
    try:
        while not stop.is_set():
            ready,_,_ = select.select([master], [], [], .01)
            if ready:
                data = os.read(master, 1024); commands.extend(data)
                if OPEN in commands and not enabled:
                    enabled = True
                    os.write(master, bytes.fromhex('A0AC08BA99')+bad)
            if enabled:
                packet = frame(raw)
                os.write(master, packet[:5]); os.write(master, packet[5:])
                time.sleep(.01)
    except Exception as exc:
        errors.append(str(exc))

with tempfile.TemporaryDirectory(prefix='legacy-e2e-') as tmp:
    record = pathlib.Path(tmp)/'capture.legacy'
    agent = subprocess.Popen([sys.executable, str(ROOT/'serial-agent/wheel_agent.py'),
            '--protocol','legacy','--port',os.ttyname(slave),'--enable-stream',
            '--backend',BASE,'--record',str(record)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    thread = threading.Thread(target=device, daemon=True); thread.start()
    try:
        wait(lambda: status()['compressionLocation']=='HOST' and status()['configApplied'])
        s = status()
        assert s['latest']['codec']=='ZRLE', s
        assert s['latest']['periodMs']==100
        assert s['timeSource']=='HOST_RECEIPT'
        assert s['channels'][3]=='reserved_04'
        assert base64.b64decode(s['latest']['rawBase64'])==raw
        config('RAW',20)
        wait(lambda:status()['configApplied'] and status()['latest']['mode']=='RAW'
             and status()['latest']['periodMs']==20)
        assert status()['latest']['codec']=='RAW'
    finally:
        agent.send_signal(signal.SIGINT)
        stdout,stderr = agent.communicate(timeout=12)
        stop.set(); thread.join(timeout=2)
        os.close(master); os.close(slave)
        print(stdout,stderr)
    assert agent.returncode==0
    assert not errors, errors
    assert bytes(commands)==OPEN, 'legacy mode sent unexpected device commands: '+commands.hex()
    parser = LegacyParser(); captured = parser.feed(record.read_bytes())
    assert len(captured)>10
    assert all(item==raw for item in captured)
    assert parser.invalid_candidates>=1
    fixture = pathlib.Path(tmp)/'replay.legacy'
    fixture.write_bytes(bytes.fromhex('A0AC08BA99')+frame(raw)*50+bad)
    before = status()['acceptedFrames']
    subprocess.run([sys.executable,str(ROOT/'serial-agent/wheel_agent.py'),'--protocol','legacy',
                    '--replay',str(fixture),'--backend',BASE],check=True)
    s=status()
    assert s['acceptedFrames']-before==50
    assert s['inputMode']=='REPLAY' and s['compressionLocation']=='HOST'
    assert not s['configApplied']
    assert base64.b64decode(s['latest']['rawBase64'])==raw
    import urllib.request
    csv = urllib.request.urlopen(BASE+'/api/wheel/export.csv').read().decode()
    assert csv.startswith('host_sequence,host_elapsed_ms,') and 'reserved_04' in csv
result={'legacyPTY':'PASS','onlyDeviceCommand':OPEN.hex(),'rawBytesExact':'PASS',
        'hostAutoAndRawConfiguration':'PASS','serialRecording':'PASS','legacyReplayFrames':50,
        'csvLegacySemantics':'PASS','hardwareTested':False}
print(json.dumps(result,ensure_ascii=False,indent=2))
(ROOT/'tests/legacy-e2e-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
