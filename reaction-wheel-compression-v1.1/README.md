# 动量轮旧固件接入：电脑压缩传输

当前方案：**保留旧固件和现有USART3接线，在电脑上校验、无损压缩，再上传到压缩传输系统。无需烧录AT32，也无需SWD下载器。**

```text
AT32旧固件 → 66字节原始遥测 → USB-TTL / COM6
  → Python电脑压缩 → HTTP压缩帧 → Java解压 → 网页曲线与CSV
```

## 下载与启动

- [电脑压缩完整运行包 v1.2](../deliverables/reaction-wheel-pc-legacy-v1.2.zip)：完整源码、新JAR、前端dist、网关运行依赖、采集器及示例。
- [完整操作手册](完整压缩传输操作手册.md)：按当前旧固件、COM6情况操作。
- [电脑压缩验证报告](电脑压缩验证报告.md)：本次测试与实机验收边界。
- [运行包 SHA-256](../deliverables/reaction-wheel-pc-legacy-v1.2-SHA256SUMS.txt)。

解压新包，进入包含start-legacy.ps1的根目录；环境为Java17、Node.js18.17+、Python3.9+。先停止旧版本服务，在窗口A执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\DataCompress_System\run.ps1
```

打开 `http://localhost:8080/wheel`。关闭XCOM串口，在窗口B执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-legacy.ps1 -Port COM6
```

也可双击start-legacy.bat（默认COM6）。等效采集命令：

```powershell
python -m pip install -r .\serial-agent\requirements.txt
python .\serial-agent\wheel_agent.py --protocol legacy --port COM6 --baud 230400 --enable-stream --backend http://127.0.0.1:8082
```

回放验证，无需硬件：

```powershell
python .\serial-agent\wheel_agent.py --protocol legacy --replay .\examples\legacy-gyro.uart --backend http://127.0.0.1:8082 --pace 0.2
```

## 使用边界

- 原始64字节位模式保留；压缩在电脑，串口带宽不减少。AUTO使用ZRLE，无收益回退RAW。
- 旧通道4～14是预留，不作为姿态/轮速/电流/电压测量展示。
- 页面周期控制电脑组批上传，不控制板端采样；旧协议无设备时间/序号，时间与编号均由电脑生成。
- `.legacy`记录可重放；CSV只导出当前会话最近4000帧。Ctrl+C不控制电机停机。
- 新包含本次后端和页面；旧运行ZIP不能直接替代。Git源码下载需自行构建运行产物。
- 原板端DCW1方案仍可通过`--protocol dcw1`使用，见[历史手册](板端压缩操作手册-历史方案.md)及[集成说明](集成说明.md)。

软件链路已验证，未连接用户真实动量轮；现场还需确认旧固件通道含义、COM6有效帧和持续采集稳定性。原作者许可证与FOC库保留。
