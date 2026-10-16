"""
AT32F403 平衡立方体 - Debug 串口数据解析工具
用法：python parse_debug.py COM4
协议：0x23 + 16个float(小端序,64B) + 1B校验和 = 66B/帧
"""
import serial
import struct
import sys
import time
from datetime import datetime

# --- 配置 ---
PORT = sys.argv[1] if len(sys.argv) > 1 else "COM4"
BAUD = 230400
TIMEOUT = 2.0

# 通道名称（与 Debug.c 中对应）
CH_NAMES = [
    "GyroX(°/s)", "GyroY(°/s)", "GyroZ(°/s)",  # data1~3
    "CH4(预留)",  "CH5(预留)",  "CH6(预留)",      # data4~6
    "CH7(预留)",  "CH8(预留)",  "CH9(预留)",      # data7~9
    "CH10(预留)", "CH11(预留)",                     # data10~11
    "CH12(预留)", "CH13(预留)", "CH14(预留)",      # data12~14
    "RC_X_F",    "RC_Y_F",                         # data15~16
]

def sync_and_read(ser):
    """同步帧头 0x23，读取完整一帧"""
    while True:
        b = ser.read(1)
        if b == b'\x23':
            raw = ser.read(65)  # 64B数据 + 1B校验
            if len(raw) < 65:
                print("[WARN] 帧不完整，丢弃")
                continue
            # 校验
            calc_sum = sum(raw[:64]) & 0xFF
            if calc_sum != raw[64]:
                print(f"[WARN] 校验失败 calc={calc_sum:02X} recv={raw[64]:02X}，丢弃")
                continue
            # 解析16个float (小端序)
            floats = struct.unpack('<16f', raw[:64])
            return floats

# AT32 串口校准命令协议 (Calibration.c Car_Cali)
# 帧格式: 0xA0 0xAC [CMD] [CRC] 0x66
# CRC = (0xA0 + 0xAC + CMD + 0x66) & 0xFF
# 应答: 同帧，尾字节变为 0x99
CMD_OPEN_PRINT = bytes([0xA0, 0xAC, 0x08, 0xBA, 0x66])  # 打开串口打印
ACK_TAIL       = bytes([0xA0, 0xAC, 0x08, 0xBA, 0x99])  # 预期应答

def send_cmd_and_wait_ack(ser, cmd, expected_ack, retries=5):
    """发送命令并等待应答"""
    for i in range(retries):
        ser.write(cmd)
        time.sleep(0.1)
        # 读取可能存在的应答
        ack = ser.read(5)
        if ack == expected_ack:
            return True
        if len(ack) > 0:
            # 可能有残留数据混入，清空缓冲区重试
            ser.reset_input_buffer()
    return False

def main():
    print(f"🔌 连接 {PORT} @ {BAUD} bps ...")
    try:
        ser = serial.Serial(PORT, BAUD, timeout=0.5)
    except Exception as e:
        print(f"❌ 无法打开串口: {e}")
        return

    # 发送打开串口打印命令
    print("📤 发送开启打印命令: A0 AC 08 BA 66 ...")
    if send_cmd_and_wait_ack(ser, CMD_OPEN_PRINT, ACK_TAIL):
        print("✅ 设备已应答，打印已开启！\n")
    else:
        print("⚠️  未收到应答，尝试继续监听数据...\n")

    # 清空缓冲区，准备接收 debug 数据
    ser.reset_input_buffer()
    ser.timeout = TIMEOUT

    print("📡 等待 Debug 数据... (Ctrl+C 停止)\n")
    print(f"{'时间':>12s}", end="")
    for name in CH_NAMES:
        print(f"  {name:>14s}", end="")
    print()

    try:
        while True:
            data = sync_and_read(ser)
            ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
            print(f"{ts:>12s}", end="")
            for v in data:
                print(f"  {v:14.4f}", end="")
            print()
    except KeyboardInterrupt:
        print("\n⏹ 用户停止")
    finally:
        ser.close()
        print("🔌 串口已关闭")

if __name__ == "__main__":
    main()
