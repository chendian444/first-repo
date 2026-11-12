import argparse
import csv
import hmac
import io
import json
import os
import secrets
import sqlite3
import threading
import uuid
import time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
from store import Store,identifier
from scenarios import run_suite,PROFILES

ROOT=Path(__file__).resolve().parent
class Server(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,address,path,token):
        super().__init__(address,Handler);self.store=Store(path);self.token=token
        self.test_lock=threading.Lock();self.runtime=Path(path).parent

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def reply(self,status,data,kind='application/json; charset=utf-8'):
        body=json.dumps(data,ensure_ascii=False,allow_nan=False).encode() if not isinstance(data,bytes) else data
        self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'")
        self.end_headers();self.wfile.write(body)
    def admin(self):return hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+self.server.token)
    def do_GET(self):self.dispatch('GET')
    def do_POST(self):self.dispatch('POST')
    def dispatch(self,method):
        try:self.route(method)
        except (ValueError,KeyError,TypeError,UnicodeError) as e:self.reply(400,{'error':str(e)[:200]})
        except sqlite3.IntegrityError:self.reply(409,{'error':'设备标识已存在'})
        except (BrokenPipeError,ConnectionResetError):pass
        except Exception:self.reply(500,{'error':'internal server error'})
    def route(self,method):
        url=urlsplit(self.path);path=url.path;store=self.server.store
        if method=='GET' and path in ('/','/app.js','/style.css'):
            name={'/':'index.html','/app.js':'app.js','/style.css':'style.css'}[path]
            return self.reply(200,(ROOT/'static'/name).read_bytes(),{'/':'text/html','/app.js':'application/javascript','/style.css':'text/css'}[path]+'; charset=utf-8')
        if method=='GET' and path=='/health':return self.reply(200,{'status':'ok'})
        parts=path.strip('/').split('/')
        device_route=len(parts)==4 and parts[:2]==['api','devices']
        if device_route:identifier(parts[2])
        if method=='POST' and device_route and parts[3] in ('telemetry','heartbeat'):
            token=self.headers.get('Authorization','').removeprefix('Bearer ')
            if not store.authenticate(parts[2],token):return self.reply(401,{'error':'invalid device credential'})
        elif not self.admin():return self.reply(401,{'error':'admin token required'})
        data=None
        if method=='POST':
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=100000:return self.reply(413,{'error':'body limit 100000 bytes'})
            self.connection.settimeout(10);data=json.loads(self.rfile.read(length))
            if not isinstance(data,dict):raise ValueError('JSON object required')
        if path=='/api/devices':
            if method=='GET':return self.reply(200,store.devices())
            return self.reply(201,store.register(data['id'],data['name']))
        if device_route:
            device,action=parts[2:]
            if method=='POST' and action=='telemetry':return self.reply(200,store.ingest(device,data))
            if method=='POST' and action=='heartbeat':store.heartbeat(device,data);return self.reply(200,{'ok':True})
            if method=='POST' and action=='disable':
                with store.db() as db:db.execute('UPDATE devices SET enabled=0 WHERE id=?',(device,))
                return self.reply(200,{'ok':True})
            if method=='GET' and action=='samples':return self.reply(200,store.samples(device))
            if method=='GET' and action=='alerts':return self.reply(200,store.alerts(device))
            if method=='GET' and action=='export.csv':
                # ID cursor export in bounded pages; no formula-capable user text columns.
                out=io.StringIO();writer=csv.writer(out);writer.writerow(['sample_id','session','origin','received_unix','captured_unix','sequence','ticks_ms','source','channel','value'])
                after=int(parse_qs(url.query).get('after',['0'])[0])
                with store.db() as db:rows=db.execute('SELECT * FROM samples WHERE device=? AND id>? ORDER BY id LIMIT 10000',(device,after)).fetchall()
                for row in rows:
                    for key,value in json.loads(row['values_json']).items():writer.writerow([row['id'],row['session'],row['origin'],row['received'],row['captured'],row['seq'],row['ticks'],row['source'],key,value])
                return self.reply(200,out.getvalue().encode('utf-8-sig'),'text/csv; charset=utf-8')
        if path=='/api/tests' and method=='GET':
            with store.db() as db:rows=[dict(r) for r in db.execute('SELECT * FROM runs ORDER BY created DESC LIMIT 20')]
            for row in rows:row['report']=json.loads(row['report'])
            return self.reply(200,rows)
        if path=='/api/tests' and method=='POST':
            profile=data.get('profile','all')
            if profile!='all' and profile not in PROFILES:raise ValueError('unknown profile')
            if not self.server.test_lock.acquire(blocking=False):return self.reply(409,{'error':'测试正在运行'})
            run=uuid.uuid4().hex
            with store.db() as db:db.execute('INSERT INTO runs VALUES(?,?,?,?)',(run,time.time(),'running','{}'))
            def work():
                try:
                    device='test-'+run[:16];credential=store.register(device,'自动化测试 / 合成回放')
                    fixture=ROOT.parent/'reaction-wheel-compression-v1.1/examples/full-telemetry26.rwt'
                    report=run_suite('http://127.0.0.1:'+str(self.server.server_port),device,credential['token'],fixture,'raw26',self.server.runtime,profiles=None if profile=='all' else [profile])
                    report['device']=device;status='passed' if report['passed'] else 'failed'
                    with store.db() as db:db.execute('UPDATE devices SET enabled=0 WHERE id=?',(device,))
                except Exception as e:report={'error':type(e).__name__};status='failed'
                finally:
                    with store.db() as db:db.execute('UPDATE runs SET status=?,report=? WHERE id=?',(status,json.dumps(report),run))
                    self.server.test_lock.release()
            threading.Thread(target=work,daemon=True).start()
            return self.reply(202,{'id':run})
        return self.reply(404,{'error':'not found'})

def main():
    p=argparse.ArgumentParser();p.add_argument('--host',default='127.0.0.1');p.add_argument('--port',type=int,default=8090)
    p.add_argument('--runtime',type=Path,default=ROOT/'runtime/server');args=p.parse_args();args.runtime.mkdir(parents=True,exist_ok=True)
    token=os.environ.get('AIOT_ADMIN_TOKEN')
    if not token:
        tokenfile=args.runtime/'admin-token.txt'
        if tokenfile.exists():token=tokenfile.read_text().strip()
        else:
            token=secrets.token_urlsafe(32)
            fd=os.open(tokenfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'w') as f:f.write(token)
        print('Admin token file:',tokenfile.resolve(),flush=True)
    if len(token)<24:p.error('AIOT_ADMIN_TOKEN must be at least 24 characters')
    server=Server((args.host,args.port),args.runtime/'platform.db',token)
    print('AIoT platform: http://'+args.host+':'+str(server.server_port),flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
if __name__=='__main__':main()
