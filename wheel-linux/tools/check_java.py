"""Actual C -> durable uploader -> Java decompression verification (synthetic input)."""
import argparse
import base64
import json
from pathlib import Path
import subprocess
import sys
import urllib.request
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT.parent/'reaction-wheel-compression-v1.1/serial-agent'))
from wheel_protocol import FrameParser,decode
p=argparse.ArgumentParser();p.add_argument('--backend',default='http://127.0.0.1:8082');p.add_argument('--output',type=Path,required=True);a=p.parse_args()
source=ROOT.parent/'reaction-wheel-compression-v1.1/examples/full-telemetry26.rwt'
r=subprocess.run([sys.executable,str(ROOT/'capture.py'),'--file',str(source),'--protocol','raw26','--backend',a.backend,'--runtime',str(a.output),'--drain-seconds','20'],capture_output=True,text=True,timeout=40)
assert r.returncode==0,r.stderr
folder=next(a.output.glob('replay-*'))
expected=[decode(frame) for frame in FrameParser().feed((folder/'frames.dcw').read_bytes())]
with urllib.request.urlopen(a.backend+'/api/wheel/status') as resp:status=json.load(resp)
with urllib.request.urlopen(a.backend+'/api/wheel/history?limit=1000') as resp:history=json.load(resp)
assert status['channels'][17]=='battery_v',status
assert len(history)==len(expected)==1000,(len(history),len(expected))
for frame,sample in zip(expected,history):
    assert base64.b64decode(sample['rawBase64'])==frame['raw']
    assert sample['sequence']==frame['sequence'] and sample['deviceMillis']==frame['deviceMillis']
import sqlite3
with sqlite3.connect(a.output/'spool.db') as db:assert db.execute('SELECT COUNT(*) FROM queue').fetchone()[0]==0
report={'origin':'synthetic_fixture','hardwareTested':False,'cFrames':len(expected),'javaFrames':len(history),'all104BytesExact':True,'deviceTimeExact':True,'spoolEmpty':True}
(a.output/'java-result.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
