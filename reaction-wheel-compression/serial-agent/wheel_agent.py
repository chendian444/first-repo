#!/usr/bin/env python3
"""Capture compressed UART telemetry or replay a recording into DataCompress_System."""
import argparse
import datetime
import json
import pathlib
import queue
import threading
import time
import urllib.error
import urllib.request
import uuid
import sys
from wheel_protocol import FrameParser, config_command

OPEN_TELEMETRY = bytes.fromhex('A0 AC 08 BA 66')


def http(base, path, data=None, headers=None, method=None):
    request = urllib.request.Request(base.rstrip('/') + path, data=data,
                                     headers=headers or {}, method=method)
    with urllib.request.urlopen(request, timeout=3) as response:
        return json.load(response)


def upload(base, session, batch_id, data):
    return http(base, '/api/wheel/frames', data,
                {'Content-Type': 'application/octet-stream',
                 'X-Wheel-Batch-Id': batch_id, 'X-Wheel-Session': session}, 'POST')


def replay(args):
    parser = FrameParser()
    session = 'replay-' + str(uuid.uuid4())
    batch, count = [], 0
    def send():
        nonlocal count
        if not batch:
            return
        batch_id = str(uuid.uuid4())
        # Same ID across retries makes ambiguous HTTP timeouts idempotent.
        for attempt in range(3):
            try:
                upload(args.backend, session, batch_id, b''.join(batch))
                count += len(batch)
                batch.clear()
                if args.pace:
                    time.sleep(args.pace)
                return
            except urllib.error.HTTPError as e:
                if 400 <= e.code < 500:
                    raise RuntimeError(f'HTTP {e.code}: {e.read().decode(errors="replace")}') from e
                if attempt == 2:
                    raise
            except (OSError, ValueError):
                if attempt == 2:
                    raise
            time.sleep(attempt + 1)
    with pathlib.Path(args.replay).open('rb') as source:
        while data := source.read(4096):
            for frame in parser.feed(data):
                batch.append(frame)
                if len(batch) >= 20:
                    send()
    send()
    print(f'历史回放完成: {count} 帧; 无效候选={parser.invalid_candidates}; '
          f'丢弃字节={parser.discarded_bytes}; 未完成尾部={len(parser.buffer)} 字节')
    if not count:
        raise RuntimeError('文件中没有 DCW1 遥测帧；旧版 0x23 协议请先使用原解析工具。')


def capture(args):
    try:
        import serial
    except ImportError as e:
        raise RuntimeError('请先执行 python -m pip install -r requirements.txt') from e
    if args.record:
        record = pathlib.Path(args.record)
    else:
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        record = pathlib.Path('runtime') / f'wheel-{stamp}.dcw'
    record.parent.mkdir(parents=True, exist_ok=True)
    pending = queue.Queue(maxsize=100)  # <=2000 frames; serial capture never waits for HTTP.
    stop = threading.Event()
    stats = {'uploaded': 0, 'queueDropped': 0}
    session = 'serial-' + str(uuid.uuid4())
    parser = FrameParser()
    with serial.Serial(args.port, args.baud, timeout=0.02, write_timeout=0.5) as port, record.open('xb') as log:
        print(f'串口 {args.port}@{args.baud}；原始记录 {record.resolve()}', flush=True)
        if args.enable_stream:
            port.write(OPEN_TELEMETRY)
        def worker():
            item = None
            next_control = 0.0
            while not stop.is_set():
                try:
                    if time.monotonic() >= next_control:
                        next_control = time.monotonic() + 2
                        cfg = http(args.backend, '/api/wheel/config')
                        port.write(config_command(cfg['mode'], cfg['periodMs']))
                    if item is None:
                        try:
                            item = pending.get(timeout=0.1)
                        except queue.Empty:
                            continue
                    batch_id, data, frames = item
                    upload(args.backend, session, batch_id, data)
                    stats['uploaded'] += frames
                    item = None
                except urllib.error.HTTPError as e:
                    print(f'HTTP {e.code}: {e.read(1000).decode(errors="replace")}', file=sys.stderr, flush=True)
                    if 400 <= e.code < 500 and item is not None:
                        stats['queueDropped'] += item[2]
                        item = None
                    stop.wait(2)
                except (OSError, ValueError, KeyError) as e:
                    print(f'网络/配置暂不可用，将重试；串口继续记录: {e}', file=sys.stderr, flush=True)
                    stop.wait(2)
        thread = threading.Thread(target=worker, name='wheel-http', daemon=True)
        thread.start()
        batch = []
        last_flush = last_report = time.monotonic()
        received = 0
        def enqueue():
            if not batch:
                return
            try:
                pending.put_nowait((str(uuid.uuid4()), b''.join(batch), len(batch)))
            except queue.Full:
                stats['queueDropped'] += len(batch)
            batch.clear()
        try:
            while True:
                data = port.read(min(max(port.in_waiting, 1), 4096))
                if data:
                    log.write(data)
                    for frame in parser.feed(data):
                        batch.append(frame)
                        received += 1
                        if len(batch) >= 20:
                            enqueue()
                now = time.monotonic()
                if now - last_flush >= 0.1:
                    enqueue(); log.flush(); last_flush = now
                if now - last_report >= 5:
                    print(f'接收={received} 上传={stats["uploaded"]} 无效候选={parser.invalid_candidates} '
                          f'未上传丢弃={stats["queueDropped"]} 待传批次={pending.qsize()}', flush=True)
                    last_report = now
        except KeyboardInterrupt:
            print('\n采集停止；未传数据可使用 --replay 从原始记录恢复。', flush=True)
        finally:
            stop.set()
            thread.join(timeout=7)


def main():
    p = argparse.ArgumentParser(description='动量轮 DCW1 串口接入/历史回放')
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument('--port', help='串口，例如 COM4 或 /dev/ttyUSB0')
    group.add_argument('--replay', help='回放 DCW1 二进制记录；不打开串口')
    p.add_argument('--backend', default='http://127.0.0.1:8082')
    p.add_argument('--baud', type=int, default=230400)
    p.add_argument('--record', help='串口原始记录路径；文件已存在时拒绝覆盖')
    p.add_argument('--enable-stream', action='store_true', help='发送原固件 08 开启遥测命令')
    p.add_argument('--pace', type=float, default=0, help='历史回放每 20 帧暂停秒数')
    args = p.parse_args()
    if args.pace < 0:
        p.error('--pace 不能小于 0')
    try:
        replay(args) if args.replay else capture(args)
    except KeyboardInterrupt:
        return 130
    except Exception as e:
        print(f'错误: {e}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
