> v1.1 构建修订：详见 [Keil构建修订说明](Keil构建修订说明.md)。已显式启用 C99 和芯片宏，新增本机预检查工具；C9511E 仍需修复 MDK 产品/授权环境，完整 Keil Rebuild 尚未验证。

# 动量轮数据压缩传输集成

基于 AT32F403A 平衡立方体与 DataCompress_System，实现单片机无损压缩、USART3 传输、Python 串口上传、Java 校验解压和 Vue 遥测监控。

2026-10-29 操作说明更新：已按 **CH340→COM5、STC 普通 USB-TTL→COM6、AT32 已焊在 PCB 上**重写[完整操作手册](完整压缩传输操作手册.md)，增加 CN3 接线、适配器自检、SWD 编译烧录、配置闭环及分阶段验收。只需择一 USB-TTL 采集；更新固件另需兼容的下载工具。新手册已更新至仓库，现有 ZIP 未重新打包，包中旧说明以仓库手册为准。

## 下载与使用

- [完整运行包（约 40 MB）](../deliverables/reaction-wheel-compression-v1.1-integration.zip)：包含完整源码、后端 JAR、前端 dist、网关依赖、串口工具及中文说明。点击文件页的下载按钮，或使用 [直接下载链接](https://github.com/chendian444/first-repo/raw/refs/heads/main/deliverables/reaction-wheel-compression-v1.1-integration.zip)。
- [完整压缩传输操作手册](完整压缩传输操作手册.md)：电脑环境、历史回放、Keil 编译烧录、串口接线、实机传输、远程接收、数据保存与排错。
- [集成说明](集成说明.md)：架构、通道、协议、接口及构建方法。
- [验证报告](验证报告.md)：已完成的软件测试与硬件验收边界。
- [压缩包 SHA-256](../deliverables/reaction-wheel-v1.1-SHA256SUMS.txt)。

本目录提供可浏览的完整工程源码；预构建 JAR、前端 dist 和网关 node_modules 放在上方完整运行包中。直接使用请先下载并完整解压该运行包；从 Git 获取源码后也可按《集成说明》重新构建。

## 运行包快速启动

在解压后包含 firmware、DataCompress_System、serial-agent 的根目录打开 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\DataCompress_System\run.ps1
```

浏览器访问 `http://localhost:8080/wheel`。另开终端进行历史回放：

```powershell
python .\serial-agent\wheel_agent.py --replay .\examples\historical-gyro.dcw --backend http://127.0.0.1:8082 --pace 0.2
```

接入真实硬件并确认新固件运行后安装 pyserial，优先使用 CH340（COM5）：

```powershell
python -m pip install -r .\serial-agent\requirements.txt
python .\serial-agent\wheel_agent.py --port COM5 --baud 230400 --enable-stream --backend http://127.0.0.1:8082
```

若改用 STC 普通 USB-TTL（COM6），先停止 COM5 采集并断电换线，再执行：

```powershell
python .\serial-agent\wheel_agent.py --port COM6 --baud 230400 --enable-stream --backend http://127.0.0.1:8082
```

同版本原理图的 CN3：1=GND、5=板端 TX（接适配器 RX）、6=板端 RX（接适配器 TX）。使用 3.3 V TTL 信号，适配器 VCC 不接；CN3-2 是电源相关脚，不能当 3.3 V VTref。实物版本、1 脚和插头方向须先核对，详情见手册。

依赖 Java 17、Node.js 18.17+、Python 3.9+。真实板卡需先使用 Keil/ARMCC 5.06 编译并烧录本包新源码。

## 验证状态

已通过 C/Python 协议无损往返、9 项 Java 测试、前端构建、模拟串口与 HTTP 端到端、浏览器页面验证。尚未完成真实 AT32 板上的 Keil 完整编译、烧录、控制时序和运行性能验收，包内没有已通过实机验收的新固件 BIN。

原作者许可证、源码注释和 FOC 库保留，第三方源码与库的使用遵循各自许可。
