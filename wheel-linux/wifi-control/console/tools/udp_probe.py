#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
udp_probe.py —— 命令行单发测试（不依赖 Flask）

用法:
  python tools/udp_probe.py --ip 192.168.0.9 --port 8888 --ping
  python tools/udp_probe.py --ip 192.168.0.9 --cmd edge_auto
  python tools/udp_probe.py --ip 192.168.0.9 --wx 100 --wy 0 --wz 0 --count 50 --hz 50
"""

import argparse
import json
import socket
import time

CMDS = {
    "edge_auto": {"btn": 0x40},
    "dot_auto": {"btn": 0x80},
    "manual_edge": {"btn": 0x10},
    "manual_dot": {"btn": 0x20},
    "stop": {"zr": 1},
    "power_off": {"zl": 1},
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ip", default="192.168.0.9")
    ap.add_argument("--port", type=int, default=8888)
    ap.add_argument("--local-port", type=int, default=9003)
    ap.add_argument("--wx", type=float, default=0.0)
    ap.add_argument("--wy", type=float, default=0.0)
    ap.add_argument("--wz", type=float, default=0.0)
    ap.add_argument("--cmd", default="")
    ap.add_argument("--ping", action="store_true")
    ap.add_argument("--count", type=int, default=1)
    ap.add_argument("--hz", type=float, default=50.0)
    ap.add_argument("--ms", type=int, default=150, help="按键脉冲时长")
    args = ap.parse_args()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("0.0.0.0", args.local_port))
    sock.settimeout(0.5)

    dst = (args.ip, args.port)

    if args.ping:
        sock.sendto(json.dumps({"type": "ping"}).encode(), dst)
        print(f"PING -> {dst}")
        try:
            data, _ = sock.recvfrom(1024)
            print("REPLY:", data.decode("utf-8", "ignore"))
        except socket.timeout:
            print("TIMEOUT (无响应)")
        return

    if args.cmd:
        if args.cmd not in CMDS:
            print("未知指令:", args.cmd, "可选:", ", ".join(CMDS))
            return
        pkt = {"type": "rc", "seq": 1, "btn": 0, "zl": 0, "zr": 0}
        pkt.update(CMDS[args.cmd])
        sock.sendto(json.dumps(pkt, separators=(",", ":")).encode(), dst)
        print(f"CMD {args.cmd} -> {dst} : {pkt}")
        try:
            data, _ = sock.recvfrom(1024)
            print("REPLY:", data.decode("utf-8", "ignore"))
        except socket.timeout:
            print("TIMEOUT (无响应)")
        return

    period = 1.0 / max(1e-3, args.hz)
    for i in range(args.count):
        pkt = {"type": "rc", "seq": i + 1,
               "wx": args.wx, "wy": args.wy, "wz": args.wz,
               "btn": 0, "zl": 0, "zr": 0}
        sock.sendto(json.dumps(pkt, separators=(",", ":")).encode(), dst)
        print(f"[{i+1}/{args.count}] {pkt}")
        time.sleep(period)


if __name__ == "__main__":
    main()
