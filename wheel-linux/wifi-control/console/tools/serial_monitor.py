#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
serial_monitor.py -- 鏌ョ湅 ESP32C3 涓插彛鏃ュ織 (115200)

鐢ㄦ硶:
    python tools/serial_monitor.py            # 榛樿 COM4
    python tools/serial_monitor.py --port COM5
    python tools/serial_monitor.py --port COM4 --baud 115200

閫€鍑�: 鎸� Ctrl+C
鎻愮ず: 鎵撳紑鐩戝惉鍚�, 鎸変竴涓� PCB 涓婄殑 SW2 澶嶄綅閿�, 鍙湅鍒板畬鏁寸殑寮€鏈烘棩蹇�
"""
import argparse
import sys
import time

import serial


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="COM4")
    ap.add_argument("--baud", type=int, default=115200)
    args = ap.parse_args()

    try:
        ser = serial.Serial(args.port, args.baud, timeout=0.1)
    except serial.SerialException as e:
        print("鎵撳紑 %s 澶辫触: %s" % (args.port, e), file=sys.stderr)
        print("鍙兘鍘熷洜: 绔彛琚崰鐢�(濡侫rduino涓插彛鐩戣鍣ㄦ湭鍏�) 鎴� 绔彛鍙蜂笉瀵�", file=sys.stderr)
        return 1

    print("鐩戝惉 %s @ %d bps ... (Ctrl+C 閫€鍑�)" % (args.port, args.baud), flush=True)
    print("鎻愮ず: 鎸変竴涓� PCB 鐨� SW2 澶嶄綅閿煡鐪嬪畬鏁村紑鏈烘棩蹇�", flush=True)
    print("=" * 62, flush=True)

    try:
        while True:
            d = ser.read(4096)
            if d:
                try:
                    print(d.decode("utf-8", "replace"), end="", flush=True)
                except Exception:
                    pass
            time.sleep(0.005)
    except KeyboardInterrupt:
        print("\n宸查€€鍑�", flush=True)
    finally:
        ser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
