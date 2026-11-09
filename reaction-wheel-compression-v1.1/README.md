# 动量轮完整串口遥测与电脑压缩传输

当前任务保留现有无线控制，通过USART3将动量轮遥测导入压缩传输系统；压缩在电脑执行，不需要手机App。

**新增完整26通道**：角速度XYZ、姿态XY、三轮速度、三路编码器、三路Id和三路Iq、电池原始/滤波电压、遥控XYZ、保护及自动/手动/校准状态。页面支持全部字段、9类分组曲线及完整CSV导出。

重要：你上传的旧Debug.c把4～14通道填零，电脑不能凭空还原电流、电压等。完整26通道需一次性更新“仅扩展遥测”的AT32程序；继续用旧固件时仍可使用legacy模式接入原有数据。

- **[完整26通道运行包 v1.3](../deliverables/reaction-wheel-telemetry26-pc-v1.3.zip)**：新JAR、页面、代理、26通道固件完整源码、原始演示数据。
- [完整接线、固件准备、采集与导出手册](完整压缩传输操作手册.md)
- [26通道软件验证报告](26通道验证报告.md)
- [SHA-256](../deliverables/reaction-wheel-telemetry26-pc-v1.3-SHA256SUMS.txt)
- [不更新固件的旧协议手册](旧固件电脑压缩操作手册.md)

新包解压后，在根目录窗口A启动上位机：

```powershell
powershell -ExecutionPolicy Bypass -File .\DataCompress_System\run.ps1
```

打开 `http://localhost:8080/wheel`。若板端已下载并校验raw26固件，关闭XCOM，在窗口B启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-raw26.ps1 -Port COM6
```

还未更新板端时，可先使用1000帧合成演示验证全部字段，不接硬件：

```powershell
python .\serial-agent\wheel_agent.py --protocol raw26 --replay .\examples\full-telemetry26.rwt --backend http://127.0.0.1:8082 --pace 0.2
```

固件只扩展原始输出并增加CRC，不承担压缩；完整工程在运行包的firmware-raw26目录。现用无线控制源码若与附件不同，应从现用工程通过tools/prepare_raw26_firmware.py生成新副本，仅合并指定五处遥测改动，不替换现有控制模块。

本次已通过C/Python、Java、模拟串口/HTTP和页面验证，未进行完整Keil构建、烧录或真实动量轮运行验收。原许可证和FOC库保留。
