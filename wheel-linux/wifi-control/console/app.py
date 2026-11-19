#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Cubli WiFi 遥控调试终端 (Win10)

链路:
    浏览器 http://127.0.0.1:9001
        -> Flask
        -> UDP JSON (默认 50Hz)
        -> ESP32 (默认 192.168.0.9:8888)
        -> UART1
        -> STM32 USART2

设计要点:
  1. 后台线程以固定频率发送 UDP，浏览器只更新状态，不直接刷新
  2. 按键类指令按"帧数"计数下发（默认 2 帧），发完立即归零，
     不会像定时脉冲那样在高频下连发 7~8 帧
  3. 任何启停切换都会作废未发完的指令，避免"停流时点指令、启动后补发"
  4. 指令还带 pulse_ttl 兜底过期
  5. 独立接收线程处理 ESP32 回传的 ack / pong
"""

import json
import os
import socket
import sys
import threading
import time
from collections import deque

from flask import Flask, jsonify, render_template, request


def resource_path(rel: str) -> str:
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, rel)


app = Flask(
    __name__,
    template_folder=resource_path("templates"),
    static_folder=resource_path("static"),
)
app.config["JSON_AS_ASCII"] = False

CFG = {
    "esp32_ip": "192.168.0.9",
    "esp32_port": 8888,
    "local_port": 9002,
    "http_port": 9001,
    "send_hz": 50,
    "max_rate": 300.0,
    # 按键指令下发帧数：2 帧 = 一下一帧还有一帧兜底，且不会重复消费命令
    "pulse_frames": 2,
    # 脉冲有效期（秒）：超过则丢弃
    "pulse_ttl": 2.0,
}

CMD_MAP = {
    "edge_auto":   {"btn": 0x40, "label": "棱平衡·自动"},
    "dot_auto":    {"btn": 0x80, "label": "点平衡·自动"},
    "manual_edge": {"btn": 0x10, "label": "A 键·棱手动"},
    "manual_dot":  {"btn": 0x20, "label": "B 键·点手动"},
    "stop":        {"zr": 1,     "label": "ZR 鍋滄満"},
    "power_off":   {"zl": 1,     "label": "ZL 断电"},
}

_lock = threading.Lock()

_state = {
    "wx": 0.0, "wy": 0.0, "wz": 0.0,
    "raw": False,
    "ch0": 128, "ch1": 128, "ch2": 128,
}

# frames: 还需要发送几帧；expire: 兜底过期时间戳
_pulse = {"btn": 0, "zl": 0, "zr": 0, "frames": 0, "expire": 0.0}

_stats = {
    "enabled": False,
    "seq": 0,
    "sent": 0,
    "recv": 0,
    "acks": 0,
    "errs": 0,
    "last_ack_seq": 0,
    "last_ack_ms": 0,
    "last_tx_ms": 0,
}

_log = deque(maxlen=200)


def log(msg: str) -> None:
    ts = time.strftime("%H:%M:%S")
    line = "[%s] %s" % (ts, msg)
    _log.append(line)
    print(line, flush=True)


def _clear_pulse() -> None:
    """作废未发完的按键指令（调用方需持锁）。"""
    _pulse.update({"btn": 0, "zl": 0, "zr": 0, "frames": 0, "expire": 0.0})


_udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
_udp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
_udp.bind(("0.0.0.0", CFG["local_port"]))
_udp.settimeout(0.2)


def _build_payload() -> dict:
    now = time.time()
    with _lock:
        _stats["seq"] += 1
        seq = _stats["seq"]

        if (_pulse["frames"] > 0) and (now < _pulse["expire"]):
            btn, zl, zr = _pulse["btn"], _pulse["zl"], _pulse["zr"]
            _pulse["frames"] -= 1
            if _pulse["frames"] <= 0:
                _clear_pulse()
        else:
            btn = zl = zr = 0
            if _pulse["frames"] > 0:
                _clear_pulse()      # 已过期，作废

        pkt = {"type": "rc", "seq": seq, "btn": btn, "zl": zl, "zr": zr}

        if _state["raw"]:
            pkt["raw"] = True
            pkt["ch0"] = int(_state["ch0"])
            pkt["ch1"] = int(_state["ch1"])
            pkt["ch2"] = int(_state["ch2"])
        else:
            pkt["wx"] = round(float(_state["wx"]), 2)
            pkt["wy"] = round(float(_state["wy"]), 2)
            pkt["wz"] = round(float(_state["wz"]), 2)
    return pkt


def sender_loop() -> None:
    log("sender thread started")
    while True:
        period = 1.0 / max(1, int(CFG["send_hz"]))
        t_next = time.time()
        while True:
            t_next += period
            gap = t_next - time.time()
            if gap > 0:
                time.sleep(gap)
            else:
                t_next = time.time()

            if not _stats["enabled"]:
                continue

            pkt = _build_payload()
            data = json.dumps(pkt, separators=(",", ":")).encode("utf-8")
            try:
                _udp.sendto(data, (CFG["esp32_ip"], int(CFG["esp32_port"])))
                _stats["sent"] += 1
                _stats["last_tx_ms"] = int(time.time() * 1000)
            except Exception as exc:
                _stats["errs"] += 1
                if _stats["errs"] % 50 == 1:
                    log("UDP send error: %s" % exc)


def receiver_loop() -> None:
    log("receiver thread listening udp:%d" % CFG["local_port"])
    while True:
        try:
            data, _addr = _udp.recvfrom(1024)
        except socket.timeout:
            continue
        except Exception as exc:
            log("UDP recv error: %s" % exc)
            continue

        _stats["recv"] += 1
        try:
            doc = json.loads(data.decode("utf-8", "ignore"))
        except Exception:
            continue

        t = doc.get("type")
        if t == "ack":
            _stats["acks"] += 1
            _stats["last_ack_seq"] = doc.get("seq", 0)
            _stats["last_ack_ms"] = int(time.time() * 1000)
        elif t == "pong":
            log("PONG from %s uptime=%ss" % (doc.get("ip"), doc.get("uptime")))


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/status")
def api_status():
    with _lock:
        now_ms = int(time.time() * 1000)
        last_ack = _stats["last_ack_ms"]
        lat = (now_ms - last_ack) if last_ack else -1
        snap = {
            "enabled": _stats["enabled"],
            "seq": _stats["seq"],
            "sent": _stats["sent"],
            "recv": _stats["recv"],
            "acks": _stats["acks"],
            "errs": _stats["errs"],
            "last_ack_seq": _stats["last_ack_seq"],
            "ack_age_ms": lat,
            "state": dict(_state),
            "pulse_frames_left": _pulse["frames"],
            "cfg": {
                "esp32_ip": CFG["esp32_ip"],
                "esp32_port": CFG["esp32_port"],
                "send_hz": CFG["send_hz"],
                "max_rate": CFG["max_rate"],
                "pulse_frames": CFG["pulse_frames"],
            },
            "cmds": dict((k, v["label"]) for k, v in CMD_MAP.items()),
            "log": list(_log)[-40:],
        }
    return jsonify(snap)


@app.post("/api/state")
def api_state():
    d = request.get_json(force=True, silent=True) or {}
    with _lock:
        if "raw" in d:
            _state["raw"] = bool(d["raw"])
        for k in ("wx", "wy", "wz"):
            if k in d:
                try:
                    _state[k] = float(d[k])
                except (TypeError, ValueError):
                    pass
        for k in ("ch0", "ch1", "ch2"):
            if k in d:
                try:
                    _state[k] = max(0, min(255, int(d[k])))
                except (TypeError, ValueError):
                    pass
        snap = dict(_state)
    return jsonify(ok=True, state=snap)


@app.post("/api/cmd")
def api_cmd():
    d = request.get_json(force=True, silent=True) or {}
    name = d.get("cmd", "")
    try:
        frames = int(d.get("frames", CFG["pulse_frames"]))
    except (TypeError, ValueError):
        frames = CFG["pulse_frames"]
    frames = max(1, min(50, frames))

    if name not in CMD_MAP:
        return jsonify(ok=False, msg="unknown cmd: %s" % name), 400

    entry = CMD_MAP[name]
    with _lock:
        queued = _stats["enabled"]
        if queued:
            _pulse.update({
                "btn": entry.get("btn", 0),
                "zl": entry.get("zl", 0),
                "zr": entry.get("zr", 0),
                "frames": frames,
                "expire": time.time() + float(CFG["pulse_ttl"]),
            })
        else:
            # 未在发送状态，指令不下发，避免启动后突然补发
            _clear_pulse()

    if not queued:
        log("CMD %s 被忽略（未启动发送）" % name)
        return jsonify(ok=False, ignored=True, msg="streaming disabled"), 409

    log("CMD %s -> btn=0x%02X zl=%d zr=%d (%d frame%s)"
        % (name, entry.get("btn", 0), entry.get("zl", 0),
           entry.get("zr", 0), frames, "" if frames == 1 else "s"))
    return jsonify(ok=True, frames=frames)


@app.post("/api/enable")
def api_enable():
    d = request.get_json(force=True, silent=True) or {}
    on = bool(d.get("enabled"))
    with _lock:
        _stats["enabled"] = on
        if on:
            _stats["sent"] = 0
            _stats["acks"] = 0
        # 任何启停切换都作废未发完的指令
        _clear_pulse()
    log("STREAM " + ("START" if on else "STOP"))
    return jsonify(ok=True, enabled=on)


@app.post("/api/config")
def api_config():
    d = request.get_json(force=True, silent=True) or {}
    if d.get("esp32_ip"):
        CFG["esp32_ip"] = str(d["esp32_ip"]).strip()
    if "esp32_port" in d:
        try:
            CFG["esp32_port"] = int(d["esp32_port"])
        except (TypeError, ValueError):
            pass
    if "send_hz" in d:
        try:
            CFG["send_hz"] = max(1, min(100, int(d["send_hz"])))
        except (TypeError, ValueError):
            pass
    log("CONFIG -> %s:%d @ %dHz"
        % (CFG["esp32_ip"], CFG["esp32_port"], CFG["send_hz"]))
    return jsonify(ok=True, cfg=CFG)


@app.post("/api/ping")
def api_ping():
    msg = json.dumps({"type": "ping"}, separators=(",", ":")).encode()
    try:
        _udp.sendto(msg, (CFG["esp32_ip"], int(CFG["esp32_port"])))
        log("PING -> %s:%d" % (CFG["esp32_ip"], CFG["esp32_port"]))
        return jsonify(ok=True)
    except Exception as exc:
        return jsonify(ok=False, msg=str(exc)), 500


@app.post("/api/reset")
def api_reset():
    with _lock:
        _state.update({"wx": 0.0, "wy": 0.0, "wz": 0.0,
                       "ch0": 128, "ch1": 128, "ch2": 128})
        _clear_pulse()
    log("RESET state -> neutral")
    return jsonify(ok=True)


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    threading.Thread(target=sender_loop, daemon=True).start()
    threading.Thread(target=receiver_loop, daemon=True).start()

    log("=" * 56)
    log("Cubli WiFi 遥控调试终端")
    log("  浏览器打开: http://127.0.0.1:%d" % CFG["http_port"])
    log("  ESP32 目标: %s:%d" % (CFG["esp32_ip"], CFG["esp32_port"]))
    log("  本机 UDP  : 0.0.0.0:%d" % CFG["local_port"])
    log("  发送频率  : %d Hz" % CFG["send_hz"])
    log("  指令帧数  : %d 帧（仅在发送状态生效）" % CFG["pulse_frames"])
    log("=" * 56)

    try:
        if not os.environ.get("CUBLI_NO_BROWSER"):
            import webbrowser
            threading.Timer(
                1.2,
                lambda: webbrowser.open("http://127.0.0.1:%d" % CFG["http_port"]),
            ).start()
    except Exception:
        pass

    app.run(host="127.0.0.1", port=CFG["http_port"],
            threaded=True, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
