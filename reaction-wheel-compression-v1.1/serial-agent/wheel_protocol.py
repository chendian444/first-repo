"""DCW1 transport and legacy 0x23 UART format; encoding runs on the PC."""
import struct
from binascii import crc_hqx

MAGIC = b'DCW1'
HEADER = struct.Struct('<4sBBHIIBHB')
FULL_CHANNELS = ['gyro_x','gyro_y','gyro_z','angle_x','angle_y',
    'wheel1_speed','wheel2_speed','wheel3_speed','encoder1_raw','encoder2_raw','encoder3_raw',
    'wheel1_id','wheel2_id','wheel3_id','wheel1_iq','wheel2_iq','wheel3_iq',
    'battery_v','battery_filtered_v','rc_x','rc_y','rc_z','protect_flag','auto_mode','manual_mode','calibrated']

CHANNELS = ['gyro_x', 'gyro_y', 'gyro_z', 'angle_x', 'angle_y', 'angle_z',
            'wheel1_speed', 'wheel2_speed', 'wheel3_speed', 'wheel1_iq',
            'wheel2_iq', 'wheel3_iq', 'battery_v', 'protect_flag', 'rc_x', 'rc_y']


def encode(raw, sequence, ticks_ms, mode='AUTO', period_ms=10, source=1):
    """Preserve 64/104 source bytes. source=1 legacy-PC, 2 raw26-PC, 0 device layout."""
    if len(raw) != (104 if source == 2 else 64) or mode not in ('RAW', 'AUTO') or source not in (0, 1, 2):
        raise ValueError('invalid payload, mode or source')
    if type(period_ms) is not int or not 10 <= period_ms <= 1000:
        raise ValueError('period must be an integer in 10..1000')
    packed = bytearray()
    pos = 0
    while pos < len(raw):
        start = pos
        zero = raw[pos] == 0
        while pos < len(raw) and (raw[pos] == 0) == zero:
            pos += 1
        packed.append((128 if zero else 0) | (pos - start - 1))
        if not zero:
            packed.extend(raw[start:pos])
    codec = int(mode == 'AUTO' and len(packed) < len(raw))
    payload = bytes(packed) if codec else bytes(raw)
    frame = HEADER.pack(MAGIC, codec, len(raw)//4, len(payload), sequence & 0xffffffff,
                        ticks_ms & 0xffffffff, int(mode == 'AUTO'), period_ms, source) + payload
    return frame + struct.pack('<H', crc_hqx(frame, 0xffff))


class LegacyParser:
    """0x23 + 64 payload bytes + sum(payload)%256. No source time/sequence exists."""
    def __init__(self):
        self.buffer = bytearray()
        self.invalid_candidates = 0
        self.discarded_bytes = 0

    def feed(self, data):
        self.buffer.extend(data)
        result = []
        while self.buffer:
            offset = self.buffer.find(b'\x23')
            if offset < 0:
                self.discarded_bytes += len(self.buffer)
                self.buffer.clear()
                break
            self.discarded_bytes += offset
            del self.buffer[:offset]
            if len(self.buffer) < 66:
                break
            if sum(self.buffer[1:65]) & 255 != self.buffer[65]:
                self.invalid_candidates += 1
                self.discarded_bytes += 1
                del self.buffer[0]
                continue
            result.append(bytes(self.buffer[1:65]))
            del self.buffer[:66]
        return result


def config_command(mode, period_ms):
    if mode not in ('RAW', 'AUTO') or type(period_ms) is not int or not 10 <= period_ms <= 1000:
        raise ValueError('mode must be RAW/AUTO, periodMs must be an integer in 10..1000')
    data = struct.pack('<2sBBH', b'CW', 1, int(mode == 'AUTO'), period_ms)
    return data + struct.pack('<H', crc_hqx(data, 0xffff))


def decode(frame):
    if len(frame) < 23:
        raise ValueError('short frame')
    magic, codec, channels, size, seq, ticks, mode, period, flags = HEADER.unpack_from(frame)
    raw_size = 104 if flags == 2 else 64
    if (magic != MAGIC or codec not in (0, 1) or channels != raw_size//4 or not 1 <= size <= raw_size
            or mode not in (0, 1) or not 10 <= period <= 1000 or flags not in (0, 1, 2)
            or len(frame) != 22 + size or (codec == 0 and size != raw_size)):
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
            if len(raw) + count > raw_size or (not token & 128 and pos + count > size):
                raise ValueError('invalid ZRLE length')
            if token & 128:
                raw.extend(b'\0' * count)
            else:
                raw.extend(payload[pos:pos+count])
                pos += count
        if len(raw) != raw_size:
            raise ValueError('invalid restored length')
        raw = bytes(raw)
    return {'sequence': seq, 'deviceMillis': ticks, 'codec': codec, 'mode': mode, 'source': flags,
            'periodMs': period, 'raw': raw, 'values': struct.unpack('<'+str(channels)+'f', raw)}


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
            raw_size = 104 if self.buffer[19] == 2 else 64
            if (not 1 <= size <= raw_size or self.buffer[5] != raw_size//4 or codec > 1 or mode > 1
                    or not 10 <= period <= 1000 or self.buffer[19] not in (0, 1, 2) or (codec == 0 and size != raw_size)):
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


class Raw26Parser:
    """RWT1 + schema(1) + channels(26) + length(104) + seq + ticks + RAW + CRC16."""
    def __init__(self):
        self.buffer = bytearray()
        self.invalid_candidates = 0
        self.discarded_bytes = 0

    def feed(self, data):
        self.buffer.extend(data)
        result = []
        while True:
            offset = self.buffer.find(b'RWT1')
            if offset < 0:
                remove = max(0, len(self.buffer)-3)
                self.discarded_bytes += remove
                del self.buffer[:remove]
                break
            self.discarded_bytes += offset
            del self.buffer[:offset]
            if len(self.buffer) < 16:
                break
            if self.buffer[4:8] != bytes([1, 26, 104, 0]):
                self.invalid_candidates += 1
                self.discarded_bytes += 1
                del self.buffer[0]
                continue
            if len(self.buffer) < 122:
                break
            frame = bytes(self.buffer[:122])
            if crc_hqx(frame[:-2], 0xffff) != struct.unpack_from('<H', frame, 120)[0]:
                self.invalid_candidates += 1
                self.discarded_bytes += 1
                del self.buffer[0]
                continue
            seq, ticks = struct.unpack_from('<II', frame, 8)
            result.append({'raw':frame[16:120], 'sequence':seq, 'deviceMillis':ticks})
            del self.buffer[:122]
        return result
