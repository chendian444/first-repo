# AIoT设备通信与弱网自动化测试平台 v0.1

面向约十天后的 AIOT 测试工程师实习面试：以 AT32 动量轮为真实设备，通过 USB-TTL → 电脑网关 → HTTP 平台接入，证明通信、可靠性、自动化与问题分析能力。保留原无线控制，不开发 Android APP，不远程下发电机动作。不是已验收的生产物联网云平台。

[十天面试准备](面试准备-十天计划.md) · [测试方案与验收](测试方案与验收.md) · [API说明](API.md)

## 实现范围

- 设备注册、独立设备令牌及禁用；管理员/设备权限分离，令牌哈希存储。
- 网关支持 legacy、raw26、dcw1；复用已有协议与电脑 ZRLE 压缩，保留设备序号/时间及原始帧位模式。
- SQLite 持久化 outbox、重启续传、指数退避；同一设备/会话/批次重试去重，内容冲突拒绝；服务端整批校验、事务提交。
- 网关心跳/在线状态与最后采集时间分别显示；设备列表、趋势、全部可用字段、CSV、持久化记录。
- 六种可复现应用层故障：基准、延迟抖动、请求丢失、ACK丢失、短时断开、带宽限制；独立测试身份，JSON报告、P95、重试、去重及恢复统计。
- 异常检测：按设备/会话/协议/通道维护 Welford 在线均值方差；30点预热后6σ检测，标记点不更新基线，另有保护状态及非有限值检查。属于无监督统计基线，不是深度学习或大模型；结果是调查线索。

## 启动（Windows / Python 3.10+）

解压运行包，保留两个同级目录 aiot-platform 与 reaction-wheel-compression-v1.1。在包根目录：

```powershell
cd .\aiot-platform
python .\server.py
```

浏览器打开 `http://127.0.0.1:8090`。从本机 `aiot-platform\runtime\server\admin-token.txt` 读取管理员令牌，填入页面后点击“连接平台”。令牌不写入浏览器持久存储；刷新后需重填。注册 `wheel-001`，保存仅显示一次的设备令牌。

第二个 PowerShell 在 aiot-platform 目录执行（不要公开真实令牌）：

```powershell
python -m pip install -r .\requirements.txt
$env:AIOT_DEVICE_TOKEN = '页面注册时生成的设备令牌'
# 旧固件优先，先关闭 XCOM 和其他串口进程
python .\gateway.py --device wheel-001 --port COM6 --protocol legacy --enable-stream
```

波特率默认230400、8N1。raw26仅在板端确实运行26通道固件时将 `--protocol legacy` 改为 `--protocol raw26`；本次不修改固件，不依赖解决 Keil 授权才能演示旧协议。USB-TTL接线沿用原验证方式，板卡独立供电。**此前电池13V与显示4.4V不一致尚未解决，应先确认供电安全再做实机试验；准备期可先回放。**

不接设备演示（建议注册另一个 wheel-replay 身份，令牌随之切换）：

```powershell
python .\gateway.py --device wheel-replay --replay ..\reaction-wheel-compression-v1.1\examples\full-telemetry26.rwt --protocol raw26 --runtime .\runtime\replay
```

回放与硬件接入不共用 runtime；每个设备/服务地址独立目录。默认上传失败持续重试，回放结束最多排空30秒，未确认批次留在SQLite中。下次启动会先续传旧批次，身份绑定防止误传给另一设备。意外退出留下 gateway.lock 时，确认进程已退出后才手动删除锁文件。

## 演示弱网与故障定位

在页面选择六种场景之一或全部，运行测试，等待状态 passed/failed，下载 JSON 报告。输入取自合成 .rwt，独立 test-* 设备，不占用 COM6、不下发控制、不改变系统网卡。每场景100帧/5批，固定种子2026，最长恢复窗口20秒。ACK丢失模拟在服务提交成功后抛出异常，重试保持原batch和内容。

判据：期望帧数与新增接受数一致，待传归零；自动化测试另对数据库逐帧解码、与源104字节比较。注入丢失是HTTP请求级，不是IP包丢失，带宽限制为应用等待预算，不能当tc/netem、Wi-Fi射频或蓝牙测试结果。P95仅代表这次小样本上传调用耗时，不能推广成产品指标。

## 数据口径与边界

legacy仅角速度XYZ及遥控XY有意义，4–14预留列明确标识，不生成电压/电流。legacy时间和序号来自PC；raw26保留板端字段。在线仅表示网关15秒内可达，不证明电机、传感器或固件正常。origin=hardware表示从串口路径接入，是网关自报，不是设备硬件认证；PTY自动化测试也走该路径，报告明确其合成来源。

每次新采集为新session。幂等范围是device/session/batch，主动整文件重放或重新封装不同batch可产生新记录，不宣称端到端exactly-once。断电前未落库的尾批与串口未收到的字节无法自动恢复；串口原始.uart用于追查。outbox最多10000批，满则停止采集并保留已有数据，不静默覆盖；数据库、原始日志需人工管理容量。无自动删除策略。

平台以Base64封装DCW1到JSON，网络总流量包含额外开销，不能把DCW1载荷收益等同HTTP带宽收益。CSV是长表（每样本/通道一行）；单次最多10000样本，可用API的after游标续导，不等于旧系统32列CSV。

默认仅监听本机；联网网关可将 --server 指向另一台部署的主机，服务需TLS反向代理与受控网络。当前不提供TLS终止、多租户、限流或高并发保障，不直接暴露公网。设备令牌相当于网关身份，AT32没有新增密码学设备认证。

统计模型不用于电池安全判定或电机控制，没有电池串数标定时不设充电阈值；启动工况污染基线、长期工况漂移可能造成漏报/误报。评估需另做带标注的真实故障集、精确率/召回率与误报率，不能把合成异常测试称为实机AI准确率。

## 验证

```powershell
python -m unittest discover -s .\tests -v
```

串口PTY集成项在Windows跳过，需要Linux+pyserial；其余可运行。见evidence软件证据。Linux软件自动化通过不代表Windows COM6、真实设备/无线控制/Keil烧录已验收。
