# Cubli WiFi 遥控调试终端

平衡立方体（Cubli）WiFi 遥控链路的 **PC 端调试终端**。用浏览器控制，通过 UDP + JSON
把指令发给 ESP32，由 ESP32 转成 16 字节串口帧透传给 STM32。

```
浏览器  http://127.0.0.1:9001
   │  HTTP (fetch)
   ▼
Flask app.py  ──UDP JSON 50Hz──►  ESP32 (192.168.0.9:8888)
                                     │ UART1 921600
                                     ▼
                                  STM32 USART2 (PA3)
```

---

## 1. 文件结构

```
console/
├─ app.py                 # Flask 后端（HTTP 接口 + 50Hz UDP 发送线程 + ACK 接收线程）
├─ requirements.txt       # 依赖（flask）
├─ run.bat                # 一键启动（自动装依赖）→ 双击即可
├─ build_exe.bat          # 打包成 dist\CubliConsole.exe
├─ templates/
│   └─ index.html         # 调试终端页面
├─ static/
│   ├─ style.css
│   └─ app.js
└─ tools/
    ├─ mock_esp32.py      # 模拟 ESP32：收 JSON→打印 16 字节帧→回 ACK
    ├─ udp_probe.py       # 命令行单发测试
    ├─ selftest.py        # 端到端自检（7 个检查项）
    └─ to_utf8.py         # 编码修复工具（Windows 下源文件被存成 GBK 时用）
```

---

## 2. 三种运行方式

### 方式 A：双击 `run.bat`（推荐日常使用）

自动检测 Python、缺失时安装 Flask，然后启动服务并打开浏览器。

### 方式 B：命令行

```bat
pip install -r requirements.txt
python app.py
```

### 方式 C：打包成 exe（Win10 绿色版，双击启动）

```bat
build_exe.bat
```

产物：`dist\CubliConsole.exe`，单文件、免装 Python，双击后弹出控制台窗口并自动打开浏览器。

> 开机自启：把 `CubliConsole.exe` 的**快捷方式**放进 `shell:startup` 目录即可。

---

## 3. 页面功能

| 区域 | 说明 |
|---|---|
| 启动/停止发送 | 控制 50Hz UDP 流是否在跑 |
| X / Y / Z 轴角速度 | 滑杆，单位 deg/s（±300），替代摇杆 |
| 键盘控制 | `A`/`D` 控 X，`W`/`S` 控 Y，`Q`/`E` 控 Z，`Space` 停机，`Esc` 回中 |
| 六个指令按钮 | 棱平衡·自动 / 点平衡·自动 / A 键 / B 键 / ZR 停机 / ZL 断电 |
| 链路状态 | 目标地址、已发送、ACK 数、距最近 ACK 的时间（不是RTT）、包序号 |
| 直通模式 | 直接发 `ch0/ch1/ch2` 原始 0~255，用于逐字节排查 |
| Ping ESP32 | 发 `{"type":"ping"}`，ESP32 回 pong 并写日志 |
| 日志 | 后端事件流（连接/指令/ACK） |

---

## 4. 协议

### 4.1 PC → ESP32（UDP，JSON，UTF-8）

控制包：

```json
{"type":"rc","seq":123,"wx":150.0,"wy":-80.0,"wz":0.0,"btn":0,"zl":0,"zr":0}
```

| 字段 | 含义 |
|---|---|
| `type` | 固定 `"rc"`；另有 `"ping"` |
| `seq` | 递增序号，用于配对 ACK |
| `wx` / `wy` / `wz` | 三轴角速度，单位 deg/s，映射到 ±127 |
| `btn` | 功能键：`0x40` 棱自动 / `0x80` 点自动 / `0x10` A / `0x20` B |
| `zl` | 1 = 断电（STM32 收到 >250 时拉低 PA15） |
| `zr` | 1 = 停机 |
| `raw` + `ch0/ch1/ch2` | 可选，直通模式，直接给 0~255 原始值 |

ESP32 回执：

```json
{"type":"ack","seq":123,"ok":true}
{"type":"pong","ip":"192.168.0.9","uptime":123}
```

### 4.2 ESP32 → STM32（UART1 921600，16 字节定长帧）

```
[0]=0x20 [1]=0x0F [2]=00 [3]=ch2(Y) [4]=00
[5]=ch0(X) [6]=ch1(Z) [7]=功能键 [8]=00 [9]=00
[10]=ZL(>250断电) [11]=ZR(>250停机) [12]=00 [13]=00
[14]=0x02 校验标记 [15]=00
```

角速度映射：`ch = round(w / 300 * 127) + 128`，即 ±300 deg/s → 1..255，0 → 128。

示例（`wx=150, wy=-80, wz=0, btn=0x40`）：

```
20 0F 00 5E 00 C0 80 40 00 00 00 00 00 00 02 00
```

---

## 5. 无硬件先跑通（推荐流程）

需要开两个窗口：

```bat
REM 窗口 1：模拟 ESP32
python tools\mock_esp32.py --port 8888

REM 窗口 2：启动 Web 终端
python app.py
```

然后在页面把 **ESP32 IP 改成 `127.0.0.1`**，端口 `8888`，点「应用」→「启动发送」。

mock 窗口会打印解析出的角速度与 16 字节帧，页面 ACK 计数会实时增长。

也可一键自检：

```bat
python tools\selftest.py
```

预期输出末行：`结果: PASS`

---

## 6. 接真机流程

1. 烧录 `ESP32C3_WiFi_RC/ESP32C3_WiFi_RC.ino`（需装库 `ArduinoJson` v6）。
2. 串口监视器确认打印 `[WiFi] connected, ip=192.168.0.9` 与 `[UDP] listen on 192.168.0.9:8888`。
3. PC 连同一个 WiFi（与你配置一致的SSID），确认能 `ping 192.168.0.9`。
4. 页面 IP 保持 `192.168.0.9`，点「Ping ESP32」，日志出现 `PONG from 192.168.0.9`。
5. 点「启动发送」，ACK 计数开始增长 → 链路通。
6. 最后接上 STM32，先点「A 键·棱手动」等确认动作正常，再试摇杆。

---

## 7. 注意事项

- **静态 IP 网段**：`192.168.0.0/24` 属于 RFC1918 私有网段，设备地址，需与路由器网段一致，否则改
  `ESP32C3_WiFi_RC.ino` 顶部的 `STATIC_IP / STATIC_GW`。
- **ESP32 只有一个射频**：本版固件只实现 WiFi；WiFi/BLE共存能力需按实际固件和工况验证，不能据此断言无法共存。
- **`esp32` 开发板包保持 2.0.4**，不要升级（`driver/uart.h` 结构体字段随版本变化）。
- **源文件编码**：Windows 中文环境下部分编辑器会把 `.py` 存成 GBK，Python 会报
  `SyntaxError: utf-8 codec can't decode`。执行 `python tools\to_utf8.py` 即可修复。


本交付仅修订文档，不改控制逻辑；ACK不代表AT32执行结果。UART0日志不是遥测。安全与原代码限制见../../docs/WiFi链路核对.md。
