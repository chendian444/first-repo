#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_stale.py —— 验证停流期间的指令不会被缓存补发

流程:
  1. 关闭发送
  2. 尝试触发指令（应被拒绝 / 不作任何下发）
  3. 开启发送并保持一段时间，观察全程 btn 应为 0x00
"""

import json
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:9001"


def req(path, body):
    data = json.dumps(body).encode("utf-8")
    r = urllib.request.Request(BASE + path, data=data,
                               headers={"Content-Type": "application/json"},
                               method="POST")
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def status():
    with urllib.request.urlopen(BASE + "/api/status", timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    req("/api/config", {"esp32_ip": "127.0.0.1", "esp32_port": 8888})

    print("[1] 关闭发送")
    req("/api/enable", {"enabled": False})
    time.sleep(0.2)

    print("[2] 停流状态下触发指令 edge_auto(0x40)")
    code, body = req("/api/cmd", {"cmd": "edge_auto", "frames": 2})
    print("    HTTP", code, body)

    print("[3] 开启发送，保持 0.8s")
    req("/api/enable", {"enabled": True})
    time.sleep(0.8)

    print("[4] 关闭发送")
    req("/api/enable", {"enabled": False})
    time.sleep(0.2)

    print("pulse_frames_left =", status().get("pulse_frames_left"))
    print("判定: mock 日志中 btn=0x40 计数应为 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
