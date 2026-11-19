#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_pulse.py —— 验证"按键指令只下发固定帧数"

流程:
  1. 指向上游（默认 127.0.0.1:8888 mock）
  2. 开启发送
  3. 触发一条指令，观察应只出现 pulse_frames 帧带 btn 的包
  4. 关闭发送

用法:
  python tools/check_pulse.py --cmd edge_auto --frames 2
"""

import argparse
import json
import time
import urllib.request

BASE = "http://127.0.0.1:9001"


def req(path, body):
    data = json.dumps(body).encode("utf-8")
    r = urllib.request.Request(BASE + path, data=data,
                               headers={"Content-Type": "application/json"},
                               method="POST")
    with urllib.request.urlopen(r, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def status():
    with urllib.request.urlopen(BASE + "/api/status", timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ip", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8888)
    ap.add_argument("--cmd", default="edge_auto")
    ap.add_argument("--frames", type=int, default=None,
                    help="覆盖默认帧数；不填用后端 CFG")
    args = ap.parse_args()

    req("/api/config", {"esp32_ip": args.ip, "esp32_port": args.port})
    req("/api/enable", {"enabled": False})
    time.sleep(0.1)
    req("/api/enable", {"enabled": True})
    time.sleep(0.4)

    body = {"cmd": args.cmd}
    if args.frames is not None:
        body["frames"] = args.frames
    r = req("/api/cmd", body)
    print("cmd  ->", r)

    # 采样 pulse_frames_left，应快速归零
    left_seq = []
    for _ in range(12):
        s = status()
        left_seq.append(s.get("pulse_frames_left"))
        time.sleep(0.1)

    time.sleep(0.3)
    req("/api/enable", {"enabled": False})

    print("pulse_frames_left 采样:", left_seq)
    print("最终 sent =", status().get("sent"))
    print("说明: 左侧出现递减并归 0，代表指令只发有限帧，不会持续下发")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
