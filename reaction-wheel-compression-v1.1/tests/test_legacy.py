"""Old UART framing and PC compression: no hardware or HTTP server needed."""
import pathlib
import random
import struct
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'serial-agent'))
from wheel_protocol import LegacyParser, FrameParser, encode, decode
from wheel_agent import InputStream


def legacy(raw):
    return b'\x23' + raw + bytes([sum(raw) & 255])


class LegacyTest(unittest.TestCase):
    def test_fragmentation_echo_corruption_and_resync(self):
        a, b = bytes(64), bytes(range(64))
        bad = bytearray(legacy(a)); bad[-1] ^= 1
        stream = bytes.fromhex('A0AC08BA99') + legacy(a) + bad + b'junk' + legacy(b)
        for size in (1, 3, 17, 66, 4096):
            parser = LegacyParser(); frames = []
            for pos in range(0, len(stream), size):
                frames.extend(parser.feed(stream[pos:pos+size]))
            self.assertEqual([a, b], frames)
            self.assertGreater(parser.invalid_candidates, 0)
            self.assertLess(len(parser.buffer), 66)

    def test_random_and_special_bit_patterns_are_preserved(self):
        rng = random.Random(20261102)
        fixtures = [bytes(64), bytes([0x23])*64, bytes(range(64)),
                    struct.pack('<16I', *([0x80000000, 0x7fc01234, 0x7f800000, 0xff800000]*4))]
        fixtures += [bytes(rng.randrange(256) if rng.random() < .5 else 0 for _ in range(64))
                     for _ in range(5000)]
        stream = InputStream('legacy')
        for raw in fixtures:
            frames = list(stream.feed(legacy(raw)))
            self.assertEqual(1, len(frames))
            d = decode(frames[0])
            self.assertEqual(raw, d['raw'])
            self.assertEqual(1, d['source'])

    def test_compression_fallback_modes_and_transport_parser(self):
        self.assertEqual(23, len(encode(bytes(64), 0, 0)))
        self.assertEqual(86, len(encode(bytes([255])*64, 0, 0)))
        frame = encode(bytes(64), 0, 0, mode='RAW')
        self.assertEqual(86, len(frame))
        self.assertEqual([frame], FrameParser().feed(frame))
        with self.assertRaises(ValueError): encode(bytes(63), 0, 0)
        with self.assertRaises(ValueError): encode(bytes(64), 0, 0, period_ms=1)

    def test_batch_period_does_not_drop_samples(self):
        stream = InputStream('legacy')
        stream.apply({'mode':'RAW', 'periodMs':1000})
        frames = list(stream.feed(legacy(bytes(64))*30))
        self.assertEqual(list(range(30)), [decode(f)['sequence'] for f in frames])
        self.assertTrue(all(decode(f)['periodMs'] == 1000 for f in frames))
        self.assertTrue(all(decode(f)['codec'] == 0 for f in frames))
        with self.assertRaises(ValueError): stream.apply({'mode':'MOTOR', 'periodMs':10})

    def test_long_garbage_stays_bounded_and_incomplete_tail_waits(self):
        p = LegacyParser()
        self.assertEqual([], p.feed(b'\x00'*100000))
        self.assertEqual(0, len(p.buffer))
        frame = legacy(bytes(64))
        self.assertEqual([], p.feed(frame[:-1]))
        self.assertEqual([bytes(64)], p.feed(frame[-1:]))


if __name__ == '__main__': unittest.main(verbosity=2)
