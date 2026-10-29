import ctypes
import pathlib
import random
import struct
import subprocess
import sys
import unittest
import json

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'serial-agent'))
from wheel_protocol import FrameParser, decode, config_command
BUILD = ROOT / 'tests' / 'build'


class ProtocolTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        BUILD.mkdir(exist_ok=True)
        subprocess.run(['gcc', '-std=c99', '-Wall', '-Wextra', '-Werror', '-O2', '-shared', '-fPIC',
                        str(ROOT / 'firmware/UserFile/WheelCodec.c'), '-o', str(BUILD / 'codec.so')], check=True)
        cls.lib = ctypes.CDLL(str(BUILD / 'codec.so'))
        cls.lib.Wheel_Encode.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32,
                                       ctypes.c_uint8, ctypes.c_uint16, ctypes.c_void_p, ctypes.c_size_t]
        cls.lib.Wheel_Encode.restype = ctypes.c_size_t
        cls.lib.Wheel_Crc16.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
        cls.lib.Wheel_Crc16.restype = ctypes.c_uint16

    def encode(self, raw, seq=0, ticks=123, mode=1, period=10, capacity=86):
        source = ctypes.create_string_buffer(raw)
        output = ctypes.create_string_buffer(86)
        n = self.lib.Wheel_Encode(source, seq, ticks, mode, period, output, capacity)
        return output.raw[:n]

    def test_cross_language_bit_exact(self):
        rng = random.Random(20261016)
        fixtures = [bytes(64), bytes(range(64)), bytes([255])*64,
                    struct.pack('<16I', *([0x80000000, 0x7fc01234, 0x7f800000, 0xff800000]*4))]
        for _ in range(5000):
            fixtures.append(bytes(0 if rng.random() < .6 else rng.randrange(256) for _ in range(64)))
        for seq, raw in enumerate(fixtures):
            frame = self.encode(raw, seq=seq)
            restored = decode(frame)
            self.assertEqual(raw, restored['raw'])
            self.assertLessEqual(len(frame), 86)
            self.assertEqual(seq, restored['sequence'])
        self.assertEqual(23, len(self.encode(bytes(64))))
        self.assertEqual(86, len(self.encode(bytes(64), mode=0)))
        vectors = []
        for raw in fixtures[:24]:
            frame = self.encode(raw, seq=len(vectors), ticks=len(vectors)*10)
            vectors.append({'frameHex': frame.hex(), 'rawHex': raw.hex()})
        (ROOT/'tests/vectors.json').write_text(json.dumps(vectors, indent=2))

    def test_corruption_fragmentation_resync(self):
        good1 = self.encode(bytes(64), seq=1)
        good2 = self.encode(bytes(range(64)), seq=2)
        bad = bytearray(good1); bad[-1] ^= 1
        stream = bytes.fromhex('A0AC08BA99') + good1 + bad + good2[:-7] + b'garbage' + good2
        for chunk_size in (1, 3, 7, 86, 4096):
            parser = FrameParser(); result = []
            for start in range(0, len(stream), chunk_size):
                result.extend(parser.feed(stream[start:start+chunk_size]))
            self.assertEqual([good1, good2], result)
            self.assertGreater(parser.invalid_candidates, 0)
            self.assertLessEqual(len(parser.buffer), 85)

    def test_limits_crc_config(self):
        self.assertEqual(0x29b1, self.lib.Wheel_Crc16(b'123456789', 9))
        self.assertEqual(b'', self.encode(bytes(64), capacity=85))
        self.assertEqual(b'', self.encode(bytes(64), mode=2))
        self.assertEqual(b'', self.encode(bytes(64), period=1))
        self.assertEqual(8, len(config_command('AUTO', 10)))
        with self.assertRaises(ValueError): config_command('AUTO', 1)
        with self.assertRaises(ValueError): config_command('AUTO', 10.5)

    def test_historical_capture(self):
        import csv
        source = ROOT/'examples/historical-gyro.csv'
        if not source.exists(): self.skipTest('historical fixture absent')
        frames = []
        with source.open() as f:
            for seq, row in enumerate(csv.DictReader(f)):
                raw = struct.pack('<16f', *[float(v) for v in list(row.values())[1:]])
                frames.append(self.encode(raw, seq=seq, ticks=seq*10))
        (ROOT/'examples/historical-gyro.dcw').write_bytes(b''.join(frames))
        raw_bytes = len(frames)*64
        wire = sum(map(len, frames))
        payload = wire-len(frames)*22
        result = {'source': 'user-supplied historical gyro CSV, legacy channel layout',
                  'frames': len(frames), 'rawPayloadBytes': raw_bytes,
                  'compressedPayloadBytes': payload, 'wireBytes': wire,
                  'payloadSavingPercent': (1-payload/raw_bytes)*100,
                  'framedSavingPercent': (1-wire/(len(frames)*86))*100,
                  'note': 'Historical CSV has reserved zero channels; not a new 16-channel hardware benchmark.'}
        (ROOT/'examples/historical-result.json').write_text(json.dumps(result, indent=2))
        self.assertTrue(frames)

if __name__ == '__main__': unittest.main(verbosity=2)
