import base64
from binascii import crc_hqx
import csv
import json
import math
import os
from pathlib import Path
import pty
import random
import signal
import struct
import subprocess
import sys
import tempfile
import time
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT.parent/'reaction-wheel-compression-v1.1/serial-agent'))
from wheel_protocol import FrameParser,decode,encode
from capture import Spool
from analyze import analyze,moving_average

def rwt(raw,seq,ticks):
    body=struct.pack('<4sBBHII',b'RWT1',1,26,104,seq,ticks)+raw
    return body+struct.pack('<H',crc_hqx(body,0xffff))

class SystemTest(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.d=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def command(self,protocol,folder):
        folder.mkdir()
        return [os.environ.get('COLLECTOR_BINARY',str(ROOT/'build/collector')),'--protocol',protocol,'--dcw',str(folder/'out.dcw'),'--csv',str(folder/'out.csv'),'--raw',str(folder/'input.uart')]
    def collect(self,data,protocol='raw26',binary=None):
        source=self.d/'source';source.write_bytes(data);folder=self.d/'capture';cmd=self.command(protocol,folder)
        if binary:cmd[0]=str(binary)
        result=subprocess.run(cmd+['--file',str(source)],capture_output=True,check=True)
        return folder,json.loads(result.stderr.splitlines()[-1])
    def test_full_bit_exact_crc_resync_and_c_python_encoding(self):
        rng=random.Random(44);raws=[rng.randbytes(104) for _ in range(500)]+[bytes(104)]
        damaged=bytearray(rwt(bytes(104),0,0));damaged[-1]^=1
        data=b'noise'+damaged+b''.join(rwt(raw,i,i*10) for i,raw in enumerate(raws))+b'RWT'
        folder,stats=self.collect(data)
        frames=FrameParser().feed((folder/'out.dcw').read_bytes())
        self.assertEqual(len(frames),len(raws));self.assertGreater(stats['invalidCandidates'],0);self.assertEqual(stats['trailingBytes'],3)
        for i,(frame,raw) in enumerate(zip(frames,raws)):
            self.assertEqual(frame,encode(raw,i,i*10,source=2));self.assertEqual(decode(frame)['raw'],raw)
        self.assertEqual((folder/'input.uart').read_bytes(),data)
    def test_legacy_reserved_semantics_raw_fallback(self):
        raw=struct.pack('<16f',*([1,2,3]+[0]*11+[4,5]));legacy=b'\x23'+raw+bytes([sum(raw)&255])
        folder,_=self.collect(legacy*30,'legacy')
        frames=FrameParser().feed((folder/'out.dcw').read_bytes());self.assertEqual(len(frames),30)
        self.assertTrue(all(decode(f)['raw']==raw and decode(f)['source']==1 for f in frames))
        with (folder/'out.csv').open() as f:rows=list(csv.DictReader(f))
        self.assertIn('reserved_4',rows[0]);self.assertNotIn('battery_v',rows[0]);self.assertEqual(rows[0]['rc_y'],'5')
        report=analyze(folder/'out.csv',self.d/'legacy-analysis')
        self.assertIsNone(report['sampleRateHz']);self.assertIsNone(report['spectrum'])
        self.assertEqual(report['sampleRateBasis'],'unknown')
        with self.assertRaises(ValueError):analyze(folder/'out.csv',self.d/'reserved-analysis',channel='reserved_4')
    def test_real_termios_poll_fragmentation_and_command_boundary(self):
        master,slave=pty.openpty();folder=self.d/'capture'
        process=subprocess.Popen(self.command('raw26',folder)+['--serial',os.ttyname(slave),'--enable-stream'],stderr=subprocess.PIPE)
        try:
            import select
            self.assertTrue(select.select([master],[],[],3)[0]);self.assertEqual(os.read(master,100),bytes.fromhex('A0 AC 08 BA 66'))
            data=b''.join(rwt(struct.pack('<26f',*([i]*26)),i,i*10) for i in range(40))
            for i in range(0,len(data),13):os.write(master,data[i:i+13]);time.sleep(.001)
            deadline=time.time()+3
            while time.time()<deadline and (not (folder/'out.csv').exists() or len((folder/'out.csv').read_text().splitlines())<41):time.sleep(.05)
            self.assertEqual(len((folder/'out.csv').read_text().splitlines()),41)
            self.assertFalse(select.select([master],[],[],.1)[0],'unexpected downstream motor/config command')
            process.send_signal(signal.SIGTERM);_,stderr=process.communicate(timeout=5);self.assertEqual(process.returncode,0,stderr)
        finally:
            if process.poll() is None:process.kill();process.wait()
            os.close(master);os.close(slave)
    def test_spool_ack_loss_reopen_capacity_and_binding(self):
        path=self.d/'spool.db';spool=Spool(path,'java-local',1);spool.add('session',[b'test'])
        with self.assertRaises(RuntimeError):spool.add('session',[b'test'])
        committed=[]
        def lost(*args):committed.append(args);raise OSError('lost ACK')
        with self.assertRaises(OSError):spool.send_one(lost)
        reopened=Spool(path,'java-local');self.assertEqual(reopened.count(),1)
        reopened.send_one(lambda *args:self.assertEqual(args,committed[0]));self.assertEqual(reopened.count(),0)
        with self.assertRaises(ValueError):Spool(path,'another-server')
    def test_filter_fft_and_missing_time_boundaries(self):
        raw=[struct.pack('<26f',math.sin(2*math.pi*10*i/100),*([0]*25)) for i in range(1000)]
        folder,_=self.collect(b''.join(rwt(v,i,i*10) for i,v in enumerate(raw)))
        report=analyze(folder/'out.csv',self.d/'analysis',window=5)
        self.assertAlmostEqual(report['sampleRateHz'],100);self.assertAlmostEqual(report['spectrum']['peakHz'],10)
        self.assertAlmostEqual(report['nominalFullWindowDelayMs'],20)
        self.assertTrue((self.d/'analysis/analysis.png').stat().st_size>1000)
        vals=moving_average([1,3,float('nan'),8,10],2,{4});self.assertEqual(vals[1],2);self.assertEqual(vals[3],8);self.assertEqual(vals[4],10)
        with (folder/'out.csv').open() as f:rows=list(csv.DictReader(f));headers=list(rows[0])
        rows[500]['sequence']='9000'
        path=self.d/'gap.csv'
        with path.open('w') as f:w=csv.DictWriter(f,headers);w.writeheader();w.writerows(rows)
        report=analyze(path,self.d/'gap-analysis');self.assertIsNone(report['spectrum']);self.assertGreater(report['sequenceBreaks'],0)
    def test_no_overwrite_and_invalid_options(self):
        source=self.d/'source';source.write_bytes(b'');cmd=self.command('legacy',self.d/'out')
        subprocess.run(cmd+['--file',str(source)],check=True,capture_output=True)
        result=subprocess.run(cmd+['--file',str(source)],capture_output=True);self.assertNotEqual(result.returncode,0)
        result=subprocess.run(cmd+['--file',str(source),'--enable-stream'],capture_output=True);self.assertEqual(result.returncode,2)

if __name__=='__main__':unittest.main(verbosity=2)
