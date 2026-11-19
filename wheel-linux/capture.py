#!/usr/bin/env python3
"""Supervise Linux C acquisition; upload validated DCW1 with durable retries."""
import argparse
import base64
import fcntl
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'reaction-wheel-compression-v1.1/serial-agent'))
from wheel_protocol import FrameParser,decode

class Spool:
    def __init__(self,path,binding,capacity=10000):
        self.path=path;self.capacity=capacity
        db=self.connect()
        try:
          with db:
              db.execute('PRAGMA journal_mode=WAL')
              db.execute('CREATE TABLE IF NOT EXISTS metadata(binding TEXT)')
              old=db.execute('SELECT binding FROM metadata').fetchone()
              if old and old[0]!=binding:raise ValueError('runtime is bound to another target; choose a new runtime')
              if not old:db.execute('INSERT INTO metadata VALUES(?)',(binding,))
              db.execute('CREATE TABLE IF NOT EXISTS queue(id INTEGER PRIMARY KEY,session TEXT,batch TEXT,data BLOB,captured REAL)')
        finally:db.close()
    def connect(self):return sqlite3.connect(self.path,timeout=20)
    def add(self,session,frames):
        db=self.connect()
        try:
            with db:
                db.execute('BEGIN IMMEDIATE')
                if db.execute('SELECT COUNT(*) FROM queue').fetchone()[0]>=self.capacity:raise RuntimeError('spool full: acquisition stops, previous records retained')
                db.execute('INSERT INTO queue(session,batch,data,captured) VALUES(?,?,?,?)',(session,uuid.uuid4().hex,b''.join(frames),time.time()))
        finally:db.close()
    def count(self):
        db=self.connect()
        try:return db.execute('SELECT COUNT(*) FROM queue').fetchone()[0]
        finally:db.close()
    def send_one(self,sender):
        db=self.connect()
        try:
            row=db.execute('SELECT id,session,batch,data,captured FROM queue ORDER BY id LIMIT 1').fetchone()
            if not row:return False
            sender(*row[1:])
            with db:db.execute('DELETE FROM queue WHERE id=?',(row[0],))
            return True
        finally:db.close()

def send(base,target,device,session,batch,data,captured):
    frames=FrameParser().feed(data);headers={}
    if target=='java':
        body=data;path='/api/wheel/frames'
        headers={'Content-Type':'application/octet-stream','X-Wheel-Session':session,'X-Wheel-Batch-Id':batch}
    else:
        body=json.dumps({'session':session,'batch':batch,'capturedAt':captured,'origin':'replay' if session.startswith('replay-') else 'hardware',
                         'frames':[base64.b64encode(f).decode() for f in frames]}).encode()
        path='/api/devices/'+device+'/telemetry'
        headers={'Content-Type':'application/json','Authorization':'Bearer '+os.environ['AIOT_DEVICE_TOKEN']}
    req=urllib.request.Request(base.rstrip('/')+path,body,headers)
    with urllib.request.urlopen(req,timeout=5) as response:reply=json.load(response)
    if not (reply.get('duplicateBatch') is True or reply.get('duplicate') is True or reply.get('accepted')==len(frames)):
        raise ValueError('incomplete server ACK; batch retained, inspect backend session/sequence')
    return reply

def main():
    p=argparse.ArgumentParser(description=__doc__)
    group=p.add_mutually_exclusive_group(required=True);group.add_argument('--serial');group.add_argument('--file',type=Path);group.add_argument('--resume-only',action='store_true')
    p.add_argument('--protocol',choices=['legacy','raw26'],default='legacy');p.add_argument('--baud',type=int,default=230400)
    p.add_argument('--enable-stream',action='store_true');p.add_argument('--mode',choices=['AUTO','RAW'],default='AUTO')
    p.add_argument('--runtime',type=Path,default=ROOT/'runtime');p.add_argument('--backend',help='default: collect locally; set URL to upload')
    p.add_argument('--target',choices=['java','aiot'],default='java');p.add_argument('--device',default='wheel-001')
    p.add_argument('--drain-seconds',type=float,default=10);p.add_argument('--collector',type=Path,default=ROOT/'build/collector')
    args=p.parse_args()
    if args.drain_seconds<0:p.error('--drain-seconds must be >=0')
    if args.enable_stream and not args.serial:p.error('--enable-stream only with --serial')
    if args.target=='aiot':
        import re
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',args.device):p.error('invalid device ID')
        if not os.environ.get('AIOT_DEVICE_TOKEN'):p.error('set AIOT_DEVICE_TOKEN')
    args.runtime.mkdir(parents=True,exist_ok=True)
    lock=(args.runtime/'capture.lock').open('a')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:p.error('another capture process owns this runtime')
    spool=Spool(args.runtime/'spool.db',json.dumps([args.target,args.backend,args.device]))
    stopping=threading.Event();closing=threading.Event();process=None;error=None
    def worker():
        delay=.5
        while not closing.is_set():
            try:
                sent=spool.send_one(lambda *row:send(args.backend,args.target,args.device,*row))
                delay=.5
                if not sent:closing.wait(.1)
            except Exception as exc:
                print('Upload pending:',type(exc).__name__,str(exc)[:160],file=sys.stderr,flush=True)
                closing.wait(delay);delay=min(10,delay*2)
    thread=threading.Thread(target=worker,daemon=True) if args.backend else None
    if thread:thread.start()
    def stop(signum,frame):
        stopping.set()
        if process and process.poll() is None:process.send_signal(signal.SIGTERM)
    previous={sig:signal.signal(sig,stop) for sig in (signal.SIGINT,signal.SIGTERM)}
    try:
        if not args.resume_only:
            session=('serial-' if args.serial else 'replay-')+uuid.uuid4().hex
            folder=args.runtime/session;folder.mkdir()
            command=[str(args.collector),'--protocol',args.protocol,'--mode',args.mode,'--baud',str(args.baud),
                '--dcw',str(folder/'frames.dcw'),'--csv',str(folder/'samples.csv'),'--raw',str(folder/'input.uart'),'--emit']
            command+=['--serial',args.serial] if args.serial else ['--file',str(args.file)]
            if args.enable_stream:command+=['--enable-stream']
            print('Capture directory:',folder.resolve(),flush=True)
            process=subprocess.Popen(command,stdout=subprocess.PIPE,bufsize=0)
            parser=FrameParser();batch=[];count=0
            while data:=process.stdout.read(4096):
                for frame in parser.feed(data):
                    batch.append(frame);count+=1
                    if len(batch)==20:spool.add(session,batch);batch=[]
                # Preserve low-rate tails without waiting for 20 frames.
                if batch:spool.add(session,batch);batch=[]
            code=process.wait()
            if code:raise RuntimeError('collector failed with exit '+str(code))
            print('Validated frames:',count,flush=True)
        deadline=time.monotonic()+args.drain_seconds
        while thread and spool.count() and time.monotonic()<deadline and not stopping.is_set():closing.wait(.1)
    except Exception as exc:
        error=exc;print('Capture error:',str(exc),file=sys.stderr)
    finally:
        if process and process.poll() is None:process.terminate();process.wait(timeout=5)
        closing.set()
        if thread:thread.join(timeout=7)
        for sig,handler in previous.items():signal.signal(sig,handler)
        print('Pending durable batches:',spool.count(),flush=True);lock.close()
    return 1 if error else 0
if __name__=='__main__':raise SystemExit(main())
