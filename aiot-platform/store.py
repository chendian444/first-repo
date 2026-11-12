import base64
import hashlib
import hmac
import json
import math
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from common import decode, fields


def identifier(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value):
        raise ValueError('标识只允许 1–80 个字母、数字、下划线或横线')
    return value


class Store:
    def __init__(self, path):
        self.path = str(path)
        with self.db() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,name TEXT,token_hash TEXT,enabled INTEGER,last_seen REAL,status TEXT);
            CREATE TABLE IF NOT EXISTS batches(device TEXT,session TEXT,batch TEXT,digest TEXT,PRIMARY KEY(device,session,batch));
            CREATE TABLE IF NOT EXISTS samples(id INTEGER PRIMARY KEY,device TEXT,session TEXT,origin TEXT,received REAL,captured REAL,seq INTEGER,ticks INTEGER,source INTEGER,frame BLOB,values_json TEXT);
            CREATE INDEX IF NOT EXISTS samples_device ON samples(device,id);
            CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY,device TEXT,sample INTEGER,channel TEXT,kind TEXT,value REAL,baseline REAL,score REAL);
            CREATE TABLE IF NOT EXISTS models(device TEXT,session TEXT,source INTEGER,channel TEXT,n INTEGER,mean REAL,m2 REAL,PRIMARY KEY(device,session,source,channel));
            CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,created REAL,status TEXT,report TEXT);
            ''')

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        try:
            with db: yield db
        finally: db.close()

    def register(self, device, name):
        identifier(device)
        if not isinstance(name,str) or not 1 <= len(name) <= 100: raise ValueError('设备名称长度 1–100')
        token = secrets.token_urlsafe(32)
        with self.db() as db:
            db.execute('INSERT INTO devices VALUES(?,?,?,1,0,?)', (device,name,hashlib.sha256(token.encode()).hexdigest(),'{}'))
        return {'id':device,'token':token}

    def authenticate(self, device, token):
        with self.db() as db: row=db.execute('SELECT token_hash,enabled FROM devices WHERE id=?',(device,)).fetchone()
        return bool(row and row['enabled'] and hmac.compare_digest(row['token_hash'],hashlib.sha256(token.encode()).hexdigest()))

    def devices(self):
        with self.db() as db:
            rows=[dict(r) for r in db.execute('SELECT id,name,enabled,last_seen,status FROM devices ORDER BY id')]
            for r in rows:
                r['online']=bool(r['enabled'] and time.time()-r['last_seen']<15)
                r['gateway']=json.loads(r.pop('status'))
                r['samples']=db.execute('SELECT COUNT(*) FROM samples WHERE device=?',(r['id'],)).fetchone()[0]
                stats=db.execute('SELECT COALESCE(SUM(CASE WHEN source=2 THEN 104 ELSE 64 END),0), COALESCE(SUM(length(frame)),0),MAX(received) FROM samples WHERE device=?',(r['id'],)).fetchone()
                r['rawPayloadBytes'],r['dcwFrameBytes'],r['lastReceivedAt']=tuple(stats)
                r['frameVsPayloadSaving']=1-stats[1]/stats[0] if stats[0] else None
            return rows

    def heartbeat(self, device, status):
        if not isinstance(status,dict): raise ValueError('status must be an object')
        # Gateway reports are advisory, not proof the physical device is producing data.
        with self.db() as db: db.execute('UPDATE devices SET last_seen=?,status=? WHERE id=?',(time.time(),json.dumps(status,allow_nan=False),device))

    def ingest(self, device, payload):
        session=identifier(payload['session']);batch=identifier(payload['batch'])
        origin=payload['origin']
        if origin not in ('hardware','replay','synthetic'): raise ValueError('invalid origin')
        frames=payload['frames']
        if not isinstance(frames,list) or not 1<=len(frames)<=100:raise ValueError('batch needs 1..100 frames')
        captured=payload['capturedAt']
        if isinstance(captured,bool) or not isinstance(captured,(int,float)) or not math.isfinite(captured) or captured<0 or captured>time.time()+300:raise ValueError('invalid capture time')
        parsed=[]
        for encoded in frames:
            wire=base64.b64decode(encoded,validate=True)
            if len(wire)>126: raise ValueError('oversized frame')
            f=decode(wire);parsed.append((wire,f,fields(f)))
        digest=hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            old=db.execute('SELECT digest FROM batches WHERE device=? AND session=? AND batch=?',(device,session,batch)).fetchone()
            if old:
                if old[0]!=digest: raise ValueError('batch ID reused with different payload')
                return {'accepted':0,'duplicate':True}
            now=time.time()
            db.execute('INSERT INTO batches VALUES(?,?,?,?)',(device,session,batch,digest))
            for wire,f,values in parsed:
                safe={k:v if math.isfinite(v) else None for k,v in values.items()}
                sample=db.execute('INSERT INTO samples(device,session,origin,received,captured,seq,ticks,source,frame,values_json) VALUES(?,?,?,?,?,?,?,?,?,?)',
                    (device,session,origin,now,captured,f['sequence'],f['deviceMillis'],f['source'],wire,json.dumps(safe))).lastrowid
                self.detect(db,device,session,sample,f,values)
            db.execute('UPDATE devices SET last_seen=? WHERE id=?',(now,device))
        return {'accepted':len(parsed),'duplicate':False}

    def detect(self,db,device,session,sample,frame,values):
        for channel,value in values.items():
            if channel.startswith('reserved_'):continue
            kind=None;baseline=None;score=None
            if not math.isfinite(value):kind='non_finite';value=None
            elif channel=='protect_flag' and value!=0:kind='protection_flag'
            elif channel not in ('protect_flag','auto_mode','manual_mode','calibrated'):
                key=(device,session,frame['source'],channel)
                row=db.execute('SELECT n,mean,m2 FROM models WHERE device=? AND session=? AND source=? AND channel=?',key).fetchone()
                n,mean,m2=tuple(row) if row else (0,0.0,0.0)
                # Online unsupervised baseline. Freeze flagged outliers to avoid poisoning.
                if n>=30:
                    deviation=max(math.sqrt(m2/max(1,n-1)),0.01,abs(mean)*0.01)
                    score=abs(value-mean)/deviation
                    if score>6:kind='baseline_outlier';baseline=mean
                if not kind:
                    n+=1;delta=value-mean;mean+=delta/n;m2+=delta*(value-mean)
                    db.execute('INSERT OR REPLACE INTO models VALUES(?,?,?,?,?,?,?)',key+(n,mean,m2))
            if kind:db.execute('INSERT INTO alerts(device,sample,channel,kind,value,baseline,score) VALUES(?,?,?,?,?,?,?)',(device,sample,channel,kind,value,baseline,score))

    def samples(self,device,limit=200):
        with self.db() as db:
            rows=[dict(r) for r in db.execute('SELECT id,session,origin,received,captured,seq,ticks,source,values_json FROM samples WHERE device=? ORDER BY id DESC LIMIT ?',(device,limit))]
        for row in rows:row['values']=json.loads(row.pop('values_json'));row['timeSource']='PC_RECEIPT' if row['source']==1 else 'DEVICE'
        return rows

    def alerts(self,device):
        with self.db() as db:return [dict(r) for r in db.execute('SELECT * FROM alerts WHERE device=? ORDER BY id DESC LIMIT 200',(device,))]
