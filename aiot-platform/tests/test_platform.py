import base64
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import InputStream,decode
from wheel_protocol import encode
from gateway import Outbox,envelope,post
from server import Server
from scenarios import run_suite

class PlatformTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.server=Server(('127.0.0.1',0),self.root/'server.db','x'*32)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.base='http://127.0.0.1:'+str(self.server.server_port)
        self.cred=self.server.store.register('wheel-001','真实动量轮')
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.tmp.cleanup()
    def payload(self,values=None):
        values=values or [0.1]*26
        return envelope('session',[encode(struct.pack('<26f',*values),3,123,source=2)],'hardware')
    def send(self,data,token=None):
        return post(self.base,'/api/devices/wheel-001/telemetry',data,token or self.cred['token'])
    def test_auth_validation_atomicity_and_conflict(self):
        with self.assertRaises(urllib.error.HTTPError) as err:self.send(self.payload(),'wrong')
        self.assertEqual(err.exception.code,401)
        data=self.payload();data['frames'].append(base64.b64encode(b'bad').decode())
        with self.assertRaises(urllib.error.HTTPError):self.send(data)
        self.assertEqual(self.server.store.samples('wheel-001'),[])
        data=self.payload();self.assertEqual(self.send(data)['accepted'],1)
        self.assertTrue(self.send(data)['duplicate'])
        data['capturedAt']-=1
        with self.assertRaises(urllib.error.HTTPError):self.send(data)
        self.assertEqual(len(self.server.store.samples('wheel-001')),1)
    def test_admin_scope_and_disabled_device(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            post(self.base,'/api/devices',{'id':'another','name':'test'},self.cred['token'])
        self.assertEqual(e.exception.code,401)
        post(self.base,'/api/devices/wheel-001/disable',{},'x'*32)
        with self.assertRaises(urllib.error.HTTPError) as e:self.send(self.payload())
        self.assertEqual(e.exception.code,401)

    def test_outbox_restart_lost_ack_and_capacity(self):
        path=self.root/'outbox.db';box=Outbox(path,capacity=1);box.add(self.payload())
        with self.assertRaises(RuntimeError):box.add(self.payload())
        def lost_ack(data):self.send(data);raise OSError('ACK lost')
        with self.assertRaises(OSError):box.send_one(lost_ack)
        reopened=Outbox(path);self.assertEqual(reopened.size(),1)
        reopened.send_one(self.send)
        self.assertEqual(reopened.size(),0);self.assertEqual(len(self.server.store.samples('wheel-001')),1)
    def test_baseline_outlier_nonfinite_legacy_fields_and_persistence(self):
        for i in range(32):self.send(self.payload())
        values=[0.1]*26;values[0]=100;values[1]=float('nan');values[22]=1
        self.send(self.payload(values))
        kinds={a['kind'] for a in self.server.store.alerts('wheel-001')}
        self.assertTrue({'baseline_outlier','non_finite','protection_flag'}<=kinds)
        frame=encode(struct.pack('<16f',*([0.0]*16)),0,0,source=1)
        self.send(envelope('legacy',[frame],'replay'))
        row=self.server.store.samples('wheel-001')[0]
        self.assertEqual(row['timeSource'],'PC_RECEIPT');self.assertIn('reserved_4',row['values']);self.assertNotIn('battery_v',row['values'])
        from store import Store
        self.assertEqual(len(Store(self.root/'server.db').samples('wheel-001')),34)
    def test_six_weak_network_profiles(self):
        fixture=Path(__file__).resolve().parents[2]/'reaction-wheel-compression-v1.1/examples/full-telemetry26.rwt'
        report=run_suite(self.base,'wheel-001',self.cred['token'],fixture,'raw26',self.root)
        self.assertTrue(report['passed'],report)
        rows=self.server.store.samples('wheel-001',1000);self.assertEqual(len(rows),600)
        self.assertTrue(all(r['origin']=='replay' for r in rows))
        self.assertGreater(next(r for r in report['results'] if r['scenario']=='ack_loss')['duplicateACKs'],0)
        expected=[decode(f)['raw'] for f in InputStream('raw26').feed(fixture.read_bytes())][:100]
        with self.server.store.db() as db:
            for result in report['results']:
                got=[decode(r[0])['raw'] for r in db.execute('SELECT frame FROM samples WHERE session=? ORDER BY id',(result['session'],))]
                self.assertEqual(got,expected)
        dest=Path(os.environ.get('AIOT_TEST_EVIDENCE',self.root/'report.json'))
        dest.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    @unittest.skipIf(os.name=='nt','PTY test requires POSIX; real COM verification remains manual')
    def test_serial_gateway_real_process(self):
        import pty
        master,slave=pty.openpty();name=os.ttyname(slave)
        runtime=self.root/'gateway';env=dict(os.environ,AIOT_DEVICE_TOKEN=self.cred['token'])
        process=subprocess.Popen([sys.executable,str(Path(__file__).resolve().parents[1]/'gateway.py'),
            '--port',name,'--protocol','raw26','--device','wheel-001','--server',self.base,'--runtime',str(runtime)],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        try:
            fixture=Path(__file__).resolve().parents[2]/'reaction-wheel-compression-v1.1/examples/full-telemetry26.rwt'
            time.sleep(0.5)
            data=fixture.read_bytes()[:122*40]
            for i in range(0,len(data),17):os.write(master,data[i:i+17]);time.sleep(.001)
            deadline=time.time()+7
            while time.time()<deadline and len(self.server.store.samples('wheel-001'))<40:time.sleep(.1)
            self.assertEqual(len(self.server.store.samples('wheel-001')),40)
            self.assertTrue(all(s['origin']=='hardware' for s in self.server.store.samples('wheel-001')))
            # Hardware denotes gateway serial acquisition mode; PTY is still synthetic test evidence.
        finally:
            process.terminate();output=process.communicate(timeout=10)[0]
            os.close(master);os.close(slave)
            if process.returncode not in (0,-15):print(output.decode())

if __name__=='__main__':unittest.main(verbosity=2)
