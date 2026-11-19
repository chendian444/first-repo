#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mock_esp32.py —— 模拟 ESP32 网关（无硬件时验证 Web 终端）

作用:
  在本机监听 UDP 8888，收到 JSON 控制包后：
    1. 打印解析出的摇杆/按键值
    2. 按 STM32 规则生成 16 字节帧并打印 HEX
    3. 回 ack 给发送方（让 Web 终端的 ACK 计数走动）

用法:
  python tools/mock_esp32.py                # 监听 0.0.0.0:8888
  python tools/mock_esp32.py --port 8888

配合 Web 终端:
  在页面把 "ESP32 IP" 改成 127.0.0.1，端口 8888，点应用 -> 启动发送
"""

import argparse
import json
import socket
import time

MAX_RATE = 300.0


def rate_to_ch(degs: float) -> int:
    n = max(-1.0, min(1.0, degs / MAX_RATE))
    v = int(round(n * 127))
    return max(0, min(255, v + 128))


def build_frame(pkt: dict) -> bytes:
    f = bytearray(16)
    f[0] = 0x20
    f[1] = 0x0F

    if pkt.get("raw"):
        c0 = int(pkt.get("ch0", 128))
        c1 = int(pkt.get("ch1", 128))
        c2 = int(pkt.get("ch2", 128))
    else:
        c0 = rate_to_ch(float(pkt.get("wx", 0)))
        c2 = rate_to_ch(float(pkt.get("wy", 0)))
        c1 = rate_to_ch(float(pkt.get("wz", 0)))

    f[3] = c2 & 0xFF          # Y
    f[5] = c0 & 0xFF          # X
    f[6] = c1 & 0xFF          # Z
    f[7] = int(pkt.get("btn", 0)) & 0xFF
    f[10] = 0xFF if pkt.get("zl") else 0x00
    f[11] = 0xFF if pkt.get("zr") else 0x00
    f[14] = 0x02
    return bytes(f)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8888)
    ap.add_argument("--quiet", action="store_true", help="只打印按键/直通变化")
    args = ap.parse_args()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("0.0.0.0", args.port))
    sock.settimeout(1.0)

    print("=" * 60)
    print(f"[mock-esp32] listening udp 0.0.0.0:{args.port}")
    print("[mock-esp32] 在 Web 终端把 ESP32 IP 设为 127.0.0.1")
    print("=" * 60)

    n = 0
    t0 = time.time()
    last_print = 0.0
    last_key = None

    while True:
        try:
            data, addr = sock.recvfrom(2048)
        except socket.timeout:
            continue
        except KeyboardInterrupt:
            break

        n += 1
        try:
            pkt = json.loads(data.decode("utf-8", "ignore"))
        except Exception:
            print(f"[mock-esp32] bad json from {addr}: {data[:60]!r}")
            continue

        t = pkt.get("type")
        if t == "ping":
            rep = json.dumps({"type": "pong", "ip": "127.0.0.1",
                              "uptime": int(time.time() - t0)})
            sock.sendto(rep.encode(), addr)
            print(f"[mock-esp32] PING from {addr} -> pong")
            continue

        if t != "rc":
            continue

        frame = build_frame(pkt)
        key = (pkt.get("btn", 0), pkt.get("zl", 0), pkt.get("zr", 0))

        now = time.time()
        if (not args.quiet) or key != last_key or now - last_print > 0.5:
            last_print = now
            last_key = key
            hexs = " ".join(f"{b:02X}" for b in frame)
            print(f"[#{n:05d}] wx={pkt.get('wx', 0):>7} wy={pkt.get('wy', 0):>7} "
                  f"wz={pkt.get('wz', 0):>7} btn=0x{pkt.get('btn', 0):02X} "
                  f"zl={pkt.get('zl', 0)} zr={pkt.get('zr', 0)}")
            print(f"        frame: {hexs}")

        ack = json.dumps({"type": "ack", "seq": pkt.get("seq", 0), "ok": True},
                         separators=(",", ":"))
        sock.sendto(ack.encode(), addr)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[mock-esp32] bye")
