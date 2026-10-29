"""DCW1 wire format shared by capture, replay and verification tools."""
import struct
from binascii import crc_hqx

MAGIC = b'DCW1'
HEADER = struct.Struct('<4sBBHIIBHB')
CHANNELS = ['gyro_x', 'gyro_y', 'gyro_z', 'angle_x', 'angle_y', 'angle_z',
            'wheel1_speed', 'wheel2_speed', 'wheel3_speed', 'wheel1_iq',
            'wheel2_iq', 'wheel3_iq', 'battery_v', 'protect_flag', 'rc_x', 'rc_y']


def config_command(mode, period_ms):
    if mode not in ('RAW', 'AUTO') or type(period_ms) is not int or not 10 <= period_ms <= 1000:
        raise ValueError('mode must be RAW/AUTO, periodMs must be an integer in 10..1000')
    data = struct.pack('<2sBBH', b'CW', 1, int(mode == 'AUTO'), period_ms)
    return data + struct.pack('<H', crc_hqx(data, 0xffff))


def decode(frame):
    if len(frame) < 23:
        raise ValueError('short frame')
    magic, codec, channels, size, seq, ticks, mode, period, flags = HEADER.unpack_from(frame)
    if (magic != MAGIC or codec not in (0, 1) or channels != 16 or not 1 <= size <= 64
            or mode not in (0, 1) or not 10 <= period <= 1000 or flags != 0
            or len(frame) != 22 + size or (codec == 0 and size != 64)):
        raise ValueError('invalid header')
    if crc_hqx(frame[:-2], 0xffff) != struct.unpack_from('<H', frame, len(frame)-2)[0]:
        raise ValueError('CRC mismatch')
    payload = frame[20:-2]
    if codec == 0:
        raw = payload
    else:
        raw = bytearray()
        pos = 0
        while pos < size:
            token = payload[pos]
            pos += 1
            count = (token & 127) + 1
            if len(raw) + count > 64 or (not token & 128 and pos + count > size):
                raise ValueError('invalid ZRLE length')
            if token & 128:
                raw.extend(b'\0' * count)
            else:
                raw.extend(payload[pos:pos+count])
                pos += count
        if len(raw) != 64:
            raise ValueError('invalid restored length')
        raw = bytes(raw)
    return {'sequence': seq, 'deviceMillis': ticks, 'codec': codec, 'mode': mode,
            'periodMs': period, 'raw': raw, 'values': struct.unpack('<16f', raw)}


class FrameParser:
    """Accept fragmented/mixed UART input; discard one byte after a bad candidate."""
    def __init__(self):
        self.buffer = bytearray()
        self.invalid_candidates = 0
        self.discarded_bytes = 0

    def feed(self, data):
        self.buffer.extend(data)
        result = []
        while True:
            offset = self.buffer.find(MAGIC)
            if offset < 0:
                remove = max(0, len(self.buffer)-3)
                self.discarded_bytes += remove
                del self.buffer[:remove]
                break
            self.discarded_bytes += offset
            del self.buffer[:offset]
            if len(self.buffer) < 20:
                break
            size = struct.unpack_from('<H', self.buffer, 6)[0]
            codec, mode, period = self.buffer[4], self.buffer[16], struct.unpack_from('<H', self.buffer, 17)[0]
            if (not 1 <= size <= 64 or self.buffer[5] != 16 or codec > 1 or mode > 1
                    or not 10 <= period <= 1000 or self.buffer[19] != 0 or (codec == 0 and size != 64)):
                self.invalid_candidates += 1
                self.discarded_bytes += 1
                del self.buffer[0]
                continue
            total = size + 22
            if len(self.buffer) < total:
                break
            frame = bytes(self.buffer[:total])
            try:
                decode(frame)
            except ValueError:
                self.invalid_candidates += 1
                self.discarded_bytes += 1
                del self.buffer[0]
                continue
            result.append(frame)
            del self.buffer[:total]
        return result
