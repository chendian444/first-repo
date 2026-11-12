"""Serial acquisition, PC compression, bounded durable outbox and HTTP delivery."""
import argparse
import base64
import json
import os
import sqlite3
import threading
import time
import urllib.request
import urllib.error
import uuid
from contextlib import contextmanager
from pathlib import Path
from common import InputStream, OPEN_TELEMETRY


def post(base,path,payload,token):
    request=urllib.request.Request(base.rstrip('/')+path,json.dumps(payload,allow_nan=False).encode(),
        {'Content-Type':'application/json','Authorization':'Bearer '+token})
    with urllib.request.urlopen(request,timeout=5) as response:return json.load(response)


class Outbox:
    def __init__(self,path,capacity=10000):
        self.path=str(path);self.capacity=capacity
        with self.db() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY,payload TEXT)')
    @contextmanager
    def db(self):
        db=sqlite3.connect(self.path,timeout=20)
        try:
            with db:yield db
        finally:db.close()
    def add(self,payload):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT COUNT(*) FROM outbox').fetchone()[0]>=self.capacity:
                raise RuntimeError('outbox full: acquisition stopped; existing records preserved')
            db.execute('INSERT INTO outbox(payload) VALUES(?)',(json.dumps(payload),))
    def size(self):
        with self.db() as db:return db.execute('SELECT COUNT(*) FROM outbox').fetchone()[0]
    def send_one(self,sender):
        with self.db() as db:row=db.execute('SELECT id,payload FROM outbox ORDER BY id LIMIT 1').fetchone()
        if not row:return False
        payload=json.loads(row[1]);reply=sender(payload)
        if reply.get('duplicate') is not True and reply.get('accepted')!=len(payload['frames']):raise ValueError('invalid ACK')
        with self.db() as db:db.execute('DELETE FROM outbox WHERE id=?',(row[0],))
        return True


def envelope(session,frames,origin):
    return {'session':session,'batch':uuid.uuid4().hex,'origin':origin,'capturedAt':time.time(),
            'frames':[base64.b64encode(f).decode() for f in frames]}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--device',required=True);p.add_argument('--server',default='http://127.0.0.1:8090')
    group=p.add_mutually_exclusive_group(required=True);group.add_argument('--port');group.add_argument('--replay',type=Path)
    p.add_argument('--protocol',choices=['legacy','raw26','dcw1'],default='legacy')
    p.add_argument('--baud',type=int,default=230400);p.add_argument('--enable-stream',action='store_true')
    p.add_argument('--runtime',type=Path,default=Path('runtime/gateway'));p.add_argument('--drain-seconds',type=int,default=30)
    args=p.parse_args();token=os.environ.get('AIOT_DEVICE_TOKEN')
    if not token:p.error('set AIOT_DEVICE_TOKEN first')
    args.runtime.mkdir(parents=True,exist_ok=True)
    # One gateway process per runtime directory/device; retain outbox across restarts.
    lock=args.runtime/'gateway.lock'
    try:fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    except FileExistsError:p.error('gateway.lock exists: stop other gateway; remove stale lock only after confirming process exited')
    os.close(fd)
    stop=threading.Event();session=uuid.uuid4().hex;outbox=Outbox(args.runtime/'outbox.db')
    binding=args.runtime/'device-binding.txt'
    expected=args.server.rstrip('/')+'|'+args.device
    if binding.exists() and binding.read_text()!=expected:
        lock.unlink(missing_ok=True);p.error('runtime belongs to another device/server; choose another --runtime')
    binding.write_text(expected)
    stream=InputStream(args.protocol);status={'serialState':'starting','frames':0,'lastFrameAt':None,'origin':'replay' if args.replay else 'hardware'}
    endpoint='/api/devices/'+args.device
    def worker():
        retry=0.5;heartbeat=0
        while not stop.is_set():
            try:
                if time.monotonic()>heartbeat:
                    post(args.server,endpoint+'/heartbeat',dict(status,pendingBatches=outbox.size()),token);heartbeat=time.monotonic()+5
                sent=outbox.send_one(lambda data:post(args.server,endpoint+'/telemetry',data,token))
                retry=0.5
                if not sent:stop.wait(0.1)
            except urllib.error.HTTPError as e:
                print('HTTP delivery failed:',e.code,flush=True);stop.wait(retry);retry=min(10,retry*2)
            except (OSError,ValueError) as e:
                print('Delivery pending:',type(e).__name__,flush=True);stop.wait(retry);retry=min(10,retry*2)
    thread=threading.Thread(target=worker,daemon=True);thread.start()
    raw=None;port=None
    try:
        if args.port:
            import serial
            port=serial.Serial(args.port,args.baud,timeout=0.05,write_timeout=1)
            raw=(args.runtime/(session+'.uart')).open('xb')
            if args.enable_stream:port.write(OPEN_TELEMETRY)
        else:port=args.replay.open('rb')
        status['serialState']='reading'
        batch=[];last=time.monotonic()
        while True:
            data=port.read(4096 if args.replay else min(max(port.in_waiting,1),4096))
            if raw:raw.write(data)
            for frame in stream.feed(data):
                batch.append(frame);status['frames']+=1;status['lastFrameAt']=time.time()
                if len(batch)==20:outbox.add(envelope(session,batch,status['origin']));batch=[]
            if batch and (time.monotonic()-last>=0.1 or args.replay and not data):
                outbox.add(envelope(session,batch,status['origin']));batch=[];last=time.monotonic()
                if raw:raw.flush()
            if args.replay and not data:break
        status['serialState']='replay_complete'
        deadline=time.monotonic()+args.drain_seconds
        while outbox.size() and time.monotonic()<deadline:stop.wait(0.1)
    except KeyboardInterrupt:status['serialState']='stopped'
    finally:
        if port:port.close()
        if raw:raw.close()
        stop.set();thread.join(timeout=7);lock.unlink(missing_ok=True)
        print(json.dumps(dict(status,pendingBatches=outbox.size(),invalidCandidates=stream.parser.invalid_candidates)))

if __name__=='__main__':main()
