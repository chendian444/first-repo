"""
AT32F403 Balance Cube - Gyro Real-time Waveform
Usage: python plot_gyro.py COM4             (auto-save to data/ folder)
       python plot_gyro.py COM4 mydata.csv  (custom filename)

Features:
  - Auto-send activation command to enable AT32 debug printing
  - Real-time plot of GyroX/Y/Z angular velocity curves
  - Auto-save all data to CSV file
  - Mouse zoom & pan support
"""
import sys
import os
import time
import struct
import threading
from collections import deque
from datetime import datetime

import serial
import matplotlib
matplotlib.rcParams['font.family'] = 'sans-serif'
matplotlib.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei', 'Arial']
matplotlib.rcParams['axes.unicode_minus'] = False

import matplotlib.pyplot as plt
import matplotlib.animation as animation
from matplotlib import style

# ============================================================
# Config
# ============================================================
PORT  = sys.argv[1] if len(sys.argv) > 1 else "COM4"
BAUD  = 230400
WIN   = 500        # Rolling window size (~2~5 sec)
YLIM  = 5.0        # Initial Y-axis range (+/- deg/s)

# Serial command protocol (Calibration.c)
CMD_OPEN_PRINT = bytes([0xA0, 0xAC, 0x08, 0xBA, 0x66])
ACK_PRINT      = bytes([0xA0, 0xAC, 0x08, 0xBA, 0x99])

# ============================================================
# Global data buffers (thread-safe)
# ============================================================
t_data  = deque(maxlen=WIN)
x_data  = deque(maxlen=WIN)
y_data  = deque(maxlen=WIN)
z_data  = deque(maxlen=WIN)
rx_data = deque(maxlen=WIN)   # RC X
ry_data = deque(maxlen=WIN)   # RC Y

_lock = threading.Lock()
_running = True
_frame_count = 0
_csv_file = None       # CSV file handle
_csv_path = ""         # CSV file path

# ============================================================
# Serial reader thread
# ============================================================
def serial_thread(ser):
    """Background thread: continuously read serial, parse 0x23 frames"""
    global _running, _frame_count, _csv_file
    buf = bytearray()

    while _running:
        try:
            chunk = ser.read(256)
            if not chunk:
                continue
            buf.extend(chunk)

            while len(buf) >= 66:
                idx = buf.find(b'\x23')
                if idx < 0:
                    buf.clear()
                    break
                if idx > 0:
                    del buf[:idx]

                if len(buf) < 66:
                    break

                calc = sum(buf[1:65]) & 0xFF
                if calc == buf[65]:
                    floats = struct.unpack('<16f', buf[1:65])
                    t = time.time()
                    with _lock:
                        t_data.append(t)
                        x_data.append(floats[0])   # GyroX
                        y_data.append(floats[1])   # GyroY
                        z_data.append(floats[2])   # GyroZ
                        rx_data.append(floats[14]) # RC_X
                        ry_data.append(floats[15]) # RC_Y
                        _frame_count += 1
                        # Write to CSV (flush every 100 frames)
                        if _csv_file:
                            ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
                            vals = ','.join(f'{v:.6f}' for v in floats)
                            _csv_file.write(f'{ts},{vals}\n')
                            if _frame_count % 100 == 0:
                                _csv_file.flush()
                del buf[:66]

        except serial.SerialException:
            break
        except Exception:
            continue

# ============================================================
# Matplotlib real-time plot
# ============================================================
style.use('dark_background')

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 8),
                                gridspec_kw={'height_ratios': [3, 1]})
fig.canvas.manager.set_window_title('AT32F403 Gyro Monitor')

# --- Upper plot: Gyro XYZ ---
line_x, = ax1.plot([], [], 'r-', lw=1.0, label='GyroX')
line_y, = ax1.plot([], [], 'g-', lw=1.0, label='GyroY')
line_z, = ax1.plot([], [], 'b-', lw=1.0, label='GyroZ')
ax1.set_ylabel('Angular Velocity (deg/s)')
ax1.set_title('MPU6500 Gyroscope - Filtered', fontsize=13, fontweight='bold')
ax1.legend(loc='upper right')
ax1.grid(True, alpha=0.3)
ax1.set_ylim(-YLIM, YLIM)
ax1.set_xlim(0, 5)
ax1.axhline(y=0, color='gray', lw=0.5, linestyle='--')

# --- Lower plot: RC X/Y ---
line_rx, = ax2.plot([], [], 'm-', lw=1.2, label='RC X')
line_ry, = ax2.plot([], [], 'c-', lw=1.2, label='RC Y')
ax2.set_xlabel('Time (s)')
ax2.set_ylabel('RC Value')
ax2.set_title('Remote Control (RC)', fontsize=11)
ax2.legend(loc='upper right')
ax2.grid(True, alpha=0.3)
ax2.set_ylim(-130, 130)
ax2.set_xlim(0, 5)
ax2.axhline(y=0, color='gray', lw=0.5, linestyle='--')

# --- Status text ---
txt_info = ax1.text(0.02, 0.96, '', transform=ax1.transAxes,
                    fontsize=9, color='#aaaaaa', va='top',
                    fontfamily='monospace')

def update_plot(frame):
    """Animation callback: read buffer & update curves"""
    with _lock:
        if len(t_data) < 2:
            return line_x, line_y, line_z, line_rx, line_ry, txt_info

        t_arr  = list(t_data)
        x_arr  = list(x_data)
        y_arr  = list(y_data)
        z_arr  = list(z_data)
        rx_arr = list(rx_data)
        ry_arr = list(ry_data)
        count  = _frame_count

    t0 = t_arr[-1]
    rel_t = [t - t0 for t in t_arr]

    line_x.set_data(rel_t, x_arr)
    line_y.set_data(rel_t, y_arr)
    line_z.set_data(rel_t, z_arr)
    line_rx.set_data(rel_t, rx_arr)
    line_ry.set_data(rel_t, ry_arr)

    # Auto-scale X
    x_min, x_max = rel_t[0], rel_t[-1] + 0.1
    ax1.set_xlim(x_min, x_max)
    ax2.set_xlim(x_min, x_max)

    # Auto-scale Y for gyro
    all_gyro = x_arr + y_arr + z_arr
    mx = max(abs(min(all_gyro)), abs(max(all_gyro))) + 0.5
    ax1.set_ylim(-mx, mx)

    # Auto-scale Y for RC
    all_rc = rx_arr + ry_arr
    rc_mx = max(abs(min(all_rc)), abs(max(all_rc))) + 5
    if rc_mx < 10:
        rc_mx = 10
    ax2.set_ylim(-rc_mx, rc_mx)

    # Status text
    if x_arr:
        txt_info.set_text(
            f"Frames: {count}  |  "
            f"X:{x_arr[-1]:+7.2f}  Y:{y_arr[-1]:+7.2f}  Z:{z_arr[-1]:+7.2f} deg/s  |  "
            f"RC:({rx_arr[-1]:+.1f},{ry_arr[-1]:+.1f})  |  "
            f"{datetime.now().strftime('%H:%M:%S')}"
        )

    return line_x, line_y, line_z, line_rx, line_ry, txt_info

# ============================================================
# Main
# ============================================================
def main():
    global _running, _csv_file, _csv_path

    # Prepare CSV output path
    if len(sys.argv) > 2:
        csv_name = sys.argv[2]
    else:
        os.makedirs('data', exist_ok=True)
        csv_name = f"data/gyro_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

    _csv_path = os.path.abspath(csv_name)

    print(f"\nConnecting {PORT} @ {BAUD} bps ...")
    try:
        ser = serial.Serial(PORT, BAUD, timeout=0.5)
    except Exception as e:
        print(f"ERROR: Cannot open port: {e}")
        return

    # Open CSV file
    try:
        _csv_file = open(_csv_path, 'w', newline='', encoding='utf-8')
        ch_names = ','.join([
            'GyroX', 'GyroY', 'GyroZ',
            'CH4','CH5','CH6','CH7','CH8','CH9',
            'CH10','CH11','CH12','CH13','CH14',
            'RC_X','RC_Y'
        ])
        _csv_file.write(f'timestamp,{ch_names}\n')
        _csv_file.flush()
        print(f"CSV saving to: {_csv_path}")
    except Exception as e:
        print(f"WARNING: Cannot create CSV: {e}")
        _csv_file = None

    # Send activation command
    print("Sending activation command: A0 AC 08 BA 66 ...")
    ser.reset_input_buffer()
    for _ in range(5):
        ser.write(CMD_OPEN_PRINT)
        time.sleep(0.15)
        ack = ser.read(5)
        if ack == ACK_PRINT:
            print("Device acknowledged! Printing enabled.")
            break
    else:
        print("(No ACK - device may already be sending data)")

    ser.reset_input_buffer()
    ser.timeout = 0.2

    # Start serial reader thread
    th = threading.Thread(target=serial_thread, args=(ser,), daemon=True)
    th.start()

    print("Plotting... (close window to stop)\n")

    # Start animation
    ani = animation.FuncAnimation(
        fig, update_plot,
        interval=30,
        blit=True,
        cache_frame_data=False,
    )

    try:
        plt.tight_layout()
        plt.show()
    except KeyboardInterrupt:
        pass
    finally:
        _running = False
        th.join(timeout=1.0)
        ser.close()
        if _csv_file:
            _csv_file.close()
            size_kb = os.path.getsize(_csv_path) / 1024
            print(f"\nData saved: {_csv_path} ({size_kb:.1f} KB, {_frame_count} frames)")
        print("Serial closed. Exit.")

if __name__ == "__main__":
    main()

