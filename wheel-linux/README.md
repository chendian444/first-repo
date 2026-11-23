# 基于动量轮的 Linux 数据采集与信号分析系统 v1.0

2026-11-23：旧协议仅5个有效字段时，使用[针对本ZIP的AT32两文件raw26补丁说明](../reaction-wheel-compression-v1.1/firmware-raw26-pack/替换说明.md)。不要把只适用于原始工程的Debug.c覆盖方案混用到本集成工程。

2026-11-23 PC自建热点配置：[ESP32 DHCP更新步骤](docs/PC热点连接与ESP32更新.md)。公开源码需从WiFiCredentials.h.example复制本地头文件并填写密码；旧完整运行包中的固件参考未同步此补丁。

保留你新增的 ESP32-C3 Wi-Fi 遥控；用 AT32 Debug 的 USART3 独立采集遥测。Linux C 负责协议解析、CSV与原始记录、电脑端ZRLE压缩；Python负责持久化上传和离线信号分析。现有Java/Vue数据压缩传输系统继续接收DCW1，不改变电机控制算法，不开发APP。

**[你的Windows + VirtualBox + Rocky完整步骤](docs/Windows-VirtualBox-Rocky完整操作步骤.md)** · [通用Linux步骤](docs/整体操作步骤.md) · [Wi-Fi链路核对](docs/WiFi链路核对.md) · [验证报告](evidence/验证报告.md)

```text
现有遥控浏览器 :9001 → Flask → UDP :8888 → ESP32-C3 → 控制UART → AT32
                                                                  │
AT32 Debug USART3 → USB-TTL → Linux C collector → 原始记录 / CSV / DCW1
                                                       │          │
                                               离线滤波/频谱    Python + SQLite
                                                                  │
                                                       Java :8082 → 页面 :8080/wheel
```

Wi-Fi链路的UART921600、ESP32调试UART115200、AT32遥测USART3默认230400是不同通道，不能混用。附件没有传感器Wi-Fi上行：ack/pong是控制网关回执，不是角速度或电池测量；GPIO1的回程接线在附件中标“预留”。本版按你的确认采用串口采集，不要求新增无线遥测。

## 快速演示（Ubuntu/Linux）

解压完整运行包，保留各目录同级。在wheel-linux目录：

```bash
sudo apt update
sudo apt install build-essential python3-venv python3-pip openjdk-17-jre nodejs npm
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
make
python tools/demo.py --output runtime/demo-01
```

读取 `runtime/demo-01/analysis/report.json`，打开 `analysis.png`。这是明确标注的100Hz/10Hz合成数据，不是实机。输出目录必须不存在，第二次换demo-02。

启动现有压缩系统（另开终端）：

```bash
bash tools/start-compression.sh
```

打开 http://127.0.0.1:8080/wheel。在wheel-linux目录运行：

```bash
source .venv/bin/activate
python capture.py --file ../reaction-wheel-compression-v1.1/examples/full-telemetry26.rwt --protocol raw26 --backend http://127.0.0.1:8082 --runtime runtime/replay-01
```

真正接板时，用已验证的AT32 Debug TXD/RXD/GND，确认Linux设备名后：

```bash
python capture.py --serial /dev/ttyUSB0 --protocol legacy --baud 230400 --enable-stream --backend http://127.0.0.1:8082 --runtime runtime/serial-01
```

raw26仅在AT32已运行26通道RWT1固件时替换protocol；Wi-Fi固件更新不会自动增加AT32遥测字段。旧固件仅gyroXYZ与rcXY有效，预留字段显示reserved，不生成虚假的电压/电流。此前电池电压异常须先确认安全；可先全程回放。

## 目录

- src/collector.c：Linux termios、poll、信号退出、分片/连续帧解析、sum8/CRC、C端ZRLE/RAW回退、原始日志与CSV；默认不发送串口数据，显式enable-stream仅发原08遥测开启命令。
- capture.py：调用C程序，独立线程上传，SQLite outbox，指数退避；默认只采集，不联网。支持现有Java接口，或可选已有aiot平台接口。
- analyze.py：滑动均值、统计与MAD离群提示、Hann窗频谱、PNG/JSON/CSV输出；分析副本不反馈控制器，不覆盖原始数据。
- wifi-control/console：附件控制终端源码副本；保留控制逻辑，只修正文档与ACK年龄标签；Linux运行使用python app.py，Windows仍可run.bat。
- wifi-control/ESP32C3_WiFi_RC/：附件固件参考副本，Wi-Fi凭据已替换为占位符，未改控制逻辑；现有Wi-Fi可用时无需烧录。
- tests/：C/Python一致性、Linux PTY、缓存恢复、采样/频谱边界自动化。
- tools/：本地演示、现有Java/Vue启动、端到端核验、打包。
- evidence/：软件验证、合成分析图及输入hash；无真实设备/无线验收声明。

Linux可执行程序由make现场构建；运行包不要求Keil、不包含新AT32二进制。原项目的26通道覆盖源码保留在同级旧工程，相关板端构建/下载仍需单独完成。
