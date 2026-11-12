"""Reuse the validated UART/PC compression codec without changing firmware."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'reaction-wheel-compression-v1.1' / 'serial-agent'))
from wheel_protocol import decode, FULL_CHANNELS, CHANNELS
from wheel_agent import InputStream, OPEN_TELEMETRY
LEGACY_CHANNELS = ['gyro_x','gyro_y','gyro_z'] + [f'reserved_{i}' for i in range(4,15)] + ['rc_x','rc_y']

def fields(frame):
    names = FULL_CHANNELS if frame['source'] == 2 else LEGACY_CHANNELS if frame['source'] == 1 else CHANNELS
    return dict(zip(names, frame['values']))
