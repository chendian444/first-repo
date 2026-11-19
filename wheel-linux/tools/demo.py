#!/usr/bin/env python3
"""Generate explicitly synthetic 100 Hz / 10 Hz signal, then collect and analyze."""
import argparse
from binascii import crc_hqx
import json
import math
from pathlib import Path
import random
import struct
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from analyze import analyze
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False)
rng=random.Random(2026);data=bytearray()
for i in range(1000):
    x=2*math.sin(2*math.pi*10*i/100)+rng.gauss(0,.05)
    values=[x,x/2,-x,2,-3,60,120,180,1000,2000,3000,.1,.2,.3,.4,.5,.6,23.9,23.8,0,0,0,0,0,0,1]
    frame=struct.pack('<4sBBHII26f',b'RWT1',1,26,104,i,i*10,*values);data.extend(frame+struct.pack('<H',crc_hqx(frame,0xffff)))
(a.output/'synthetic.rwt').write_bytes(data)
command=[str(ROOT/'build/collector'),'--protocol','raw26','--file',str(a.output/'synthetic.rwt'),'--dcw',str(a.output/'frames.dcw'),'--csv',str(a.output/'samples.csv'),'--raw',str(a.output/'input.uart')]
r=subprocess.run(command,capture_output=True,text=True,check=True)
(a.output/'collector.json').write_text(r.stderr)
report=analyze(a.output/'samples.csv',a.output/'analysis',window=5)
(a.output/'ORIGIN.txt').write_text('SYNTHETIC SOFTWARE INPUT. Not measured from the wheel. 100 Hz sampling, 10 Hz sine; random seed 2026.\n')
print(json.dumps({'origin':'synthetic','frames':1000,'sampleRateHz':report['sampleRateHz'],'peakHz':report['spectrum']['peakHz']},indent=2))
