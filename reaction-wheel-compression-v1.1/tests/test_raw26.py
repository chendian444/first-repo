import json,pathlib,random,struct,subprocess,sys,unittest
from binascii import crc_hqx
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'serial-agent'))
from wheel_protocol import Raw26Parser,FrameParser,encode,decode,FULL_CHANNELS
from wheel_agent import InputStream

def raw_frame(raw,seq=0,ticks=0):
    frame=struct.pack('<4sBBHII',b'RWT1',1,26,104,seq,ticks)+raw
    return frame+struct.pack('<H',crc_hqx(frame,0xffff))

class Raw26Test(unittest.TestCase):
    def test_real_c_mapping_and_crc(self):
        build=ROOT/'tests/build';build.mkdir(exist_ok=True)
        subprocess.run(['gcc','-std=c99','-Wall','-Wextra','-Werror','-D__app_H','-include',str(ROOT/'tests/mcu_stubs.h'),
                        '-I'+str(ROOT/'firmware-raw26-overlay/UserFile'),'-I'+str(ROOT/'firmware/UserFile'),
                        str(ROOT/'firmware-raw26-overlay/UserFile/Debug.c'),str(ROOT/'tests/test_raw26.c'),'-o',str(build/'raw26')],check=True)
        subprocess.run([str(build/'raw26'),str(build/'raw26.rwt')],check=True)
        data=(build/'raw26.rwt').read_bytes();frames=Raw26Parser().feed(data)
        self.assertEqual(1,len(frames));self.assertEqual(tuple(range(1,27)),struct.unpack('<26f',frames[0]['raw']))
        self.assertEqual(0,frames[0]['sequence']);self.assertEqual(110,frames[0]['deviceMillis'])

    def test_fragmentation_crc_and_resync(self):
        a=raw_frame(bytes(104),7,123);bad=bytearray(a);bad[-1]^=1
        stream=bytes.fromhex('A0AC08BA99')+a+bad+b'junk'+a
        for chunk in (1,3,16,66,122,4096):
            p=Raw26Parser();frames=[]
            for i in range(0,len(stream),chunk):frames+=p.feed(stream[i:i+chunk])
            self.assertEqual(2,len(frames));self.assertGreater(p.invalid_candidates,0);self.assertLess(len(p.buffer),122)

    def test_host_compression_preserves_104_bytes_and_device_clock(self):
        rng=random.Random(20261109)
        fixtures=[bytes(104),bytes(range(104)),bytes([255])*104,struct.pack('<26I',*([0x80000000,0x7fc01234]*13))]
        fixtures += [bytes(0 if rng.random()<.5 else rng.randrange(256) for _ in range(104)) for _ in range(5000)]
        stream=InputStream('raw26');stream.apply({'mode':'AUTO','periodMs':100})
        vectors=[]
        for i,raw in enumerate(fixtures):
            wire=list(stream.feed(raw_frame(raw,i,i*10)))[0];d=decode(wire)
            self.assertEqual(raw,d['raw']);self.assertEqual(2,d['source']);self.assertEqual(i,d['sequence']);self.assertEqual(i*10,d['deviceMillis'])
            self.assertEqual(100,d['periodMs']);self.assertEqual([wire],FrameParser().feed(wire));self.assertLessEqual(len(wire),126)
            if i<24:vectors.append({'frameHex':wire.hex(),'rawHex':raw.hex()})
        path=ROOT/'DataCompress_System/backend/src/test/resources/wheel-full-vectors.json'
        path.write_text(json.dumps(vectors,indent=2)+'\n')
        self.assertEqual(26,len(FULL_CHANNELS))
        self.assertEqual(23,len(encode(bytes(104),0,0,source=2)))
        self.assertEqual(126,len(encode(bytes(104),0,0,mode='RAW',source=2)))
        with self.assertRaises(ValueError):encode(bytes(64),0,0,source=2)
        with self.assertRaises(ValueError):encode(bytes(104),0,0,source=1)

if __name__=='__main__':unittest.main(verbosity=2)
