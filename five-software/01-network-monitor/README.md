# 多源网络传输状态实时监测软件

独立 Java/Spring Boot 应用，有自己的界面、HTTP API、配置、依赖声明、启动脚本和测试；不依赖其他四个项目的目录或进程。源码位于 `src`，可运行文件为 `app.jar`。

## 直接运行

需要 Java 17 或更高版本。运行发布包不需要 Node、Python 或 Maven。

- Windows：双击 `start.bat`。
- Linux：`sh start.sh`。
- 通用命令：`java -jar app.jar`。

启动后在浏览器输入 `http://localhost:8101`。停止使用 Ctrl+C。端口冲突时可执行：

```sh
java -jar app.jar --server.port=8201
```

默认绑定所有网卡，可用 `--server.address=127.0.0.1` 仅绑定本机。

## 源码开发

需要 JDK 17+ 和 Maven 3.9+。在本工程目录运行 `mvn -B clean package`；回归测试会执行，得到 `target/01-network-monitor-1.0.0.jar`。

`start.sh`/`start.bat` 优先运行已有 `app.jar`，源码改动后请运行新构建的 JAR，或用它替换 `app.jar`，避免运行旧产物。依赖版本沿用原系统，第三方库通过 Maven 解析；首次源码构建需要 Maven 仓库访问。

## 已验证

JDK 17 / Linux x86_64 上构建、单元回归、独立进程启动、真实 API 请求及 Chromium 核心交互均通过。Windows 脚本未在 Windows 实测。健康检查为 `/actuator/health`。

## 功能与操作

- 数据源注册、各源独立遥测、历史曲线及 RTT/抖动/丢包状态。
- 上报低速或断连状态会生成告警，可在界面确认处理。
- 每秒刷新界面，10 秒未更新则显示遥测过期。
- 默认关闭模拟；没有上报时显示未接入。可为单个源显式开启演示。

“注册数据源”仅记录来源信息；不会自动连接 MQTT、RTSP 等地址。采集端需要通过 HTTP 上报已经测得的指标。遥测是用户上报的数据，不是浏览器自动测速。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET / POST | `/api/sources` | 数据源列表 / 注册 |
| GET | `/api/monitor` | 多源快照与新鲜程度 |
| GET | `/api/monitor/{sourceId}/history?limit=120` | 源历史 |
| POST | `/api/monitor/{sourceId}/telemetry` | 上报遥测 |
| POST | `/api/monitor/{sourceId}/demo?enabled=true` | 开启该源演示 |
| GET | `/api/alarms` | 告警列表 |
| POST | `/api/alarms/{id}/resolve` | 确认处理 |

遥测 JSON 示例：

```json
{"throughputKbps":1200,"rttMillis":30,"jitterMillis":5,"packetLossPercent":0,"connectionState":"CONNECTED"}
```

为兼容原字段保留 `throughputKbps` 名称，其数值单位沿用原系统的 KiB/s（1024 字节/秒），不是千比特/秒。

源配置、遥测与告警保存在当前进程内存，重启后重新接入。原系统内置的数据源名称为示例，不表示已建立连接。
