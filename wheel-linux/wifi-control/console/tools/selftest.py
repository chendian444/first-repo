#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
selftest.py —— Web 调试终端自检（无需硬件 / 无需 requests）

前提:
  1. 先启动 mock_esp32.py（监听 8888）
  2. 再启动 app.py（监听 9001）
  3. 运行本脚本

检查项:
  GET  /             -> 页面可访问
  POST /api/config   -> 指向 127.0.0.1:8888
  POST /api/ping     -> 发送 ping
  POST /api/state    -> 设置三轴角速度
  POST /api/enable   -> 开始 50Hz 发送
  GET  /api/status   -> sent/acks 增长
  POST /api/cmd      -> 触发功能键脉冲
"""

import json
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:9001"


def req(path, body=None, method=None):
    url = BASE + path
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    r = urllib.request.Request(url, data=data,
                               headers={"Content-Type": "application/json"},
                               method=method or ("POST" if data else "GET"))
    with urllib.request.urlopen(r, timeout=5) as resp:
        raw = resp.read()
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {"_raw_len": len(raw)}


def step(msg):
    print(f"  - {msg}")


def main():
    ok = True

    print("[1] GET / ")
    r = req("/", method="GET")
    step(f"html bytes = {r.get('_raw_len')}")
    ok &= r.get("_raw_len", 0) > 500

    print("[2] POST /api/config -> 127.0.0.1:8888 @50Hz")
    r = req("/api/config", {"esp32_ip": "127.0.0.1", "esp32_port": 8888, "send_hz": 50})
    step(f"cfg = {r.get('cfg', {}).get('esp32_ip')}:{r.get('cfg', {}).get('esp32_port')}")
    ok &= r.get("ok") is True

    print("[3] POST /api/ping")
    r = req("/api/ping", {})
    step(f"ok = {r.get('ok')}")
    ok &= r.get("ok") is True

    print("[4] POST /api/state (wx=150, wy=-80, wz=0)")
    r = req("/api/state", {"wx": 150, "wy": -80, "wz": 0})
    step(f"state = {r.get('state')}")
    ok &= r.get("ok") is True

    print("[5] POST /api/enable = true")
    r = req("/api/enable", {"enabled": True})
    step(f"enabled = {r.get('enabled')}")

    print("[6] 等待 1.2s 后检查 status")
    time.sleep(1.2)
    s = req("/api/status", method="GET")
    step(f"sent={s.get('sent')} acks={s.get('acks')} errs={s.get('errs')} seq={s.get('seq')}")
    ok &= (s.get("sent") or 0) > 20
    ok &= (s.get("acks") or 0) > 10

    print("[7] POST /api/cmd edge_auto")
    r = req("/api/cmd", {"cmd": "edge_auto"})
    step(f"ok = {r.get('ok')}")
    time.sleep(0.4)

    print("[8] 回中并停止发送")
    req("/api/state", {"wx": 0, "wy": 0, "wz": 0})
    r = req("/api/enable", {"enabled": False})
    step(f"enabled = {r.get('enabled')}")

    s = req("/api/status", method="GET")
    print("\n--- 最后 8 条日志 ---")
    for line in s.get("log", [])[-8:]:
        print("   ", line)

    print("\n结果:", "PASS ?" if ok else "FAIL ?")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
