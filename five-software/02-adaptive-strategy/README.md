# 自适应数据压缩策略分析与优化软件

独立 Java/Spring Boot 应用，有自己的界面、HTTP API、配置、依赖声明、启动脚本和测试；不依赖其他四个项目的目录或进程。源码位于 `src`，可运行文件为 `app.jar`。

## 直接运行

需要 Java 17 或更高版本。运行发布包不需要 Node、Python 或 Maven。

- Windows：双击 `start.bat`。
- Linux：`sh start.sh`。
- 通用命令：`java -jar app.jar`。

启动后在浏览器输入 `http://localhost:8102`。停止使用 Ctrl+C。端口冲突时可执行：

```sh
java -jar app.jar --server.port=8202
```

默认绑定所有网卡，可用 `--server.address=127.0.0.1` 仅绑定本机。

## 源码开发

需要 JDK 17+ 和 Maven 3.9+。在本工程目录运行 `mvn -B clean package`；回归测试会执行，得到 `target/02-adaptive-strategy-1.0.0.jar`。

`start.sh`/`start.bat` 优先运行已有 `app.jar`，源码改动后请运行新构建的 JAR，或用它替换 `app.jar`，避免运行旧产物。依赖版本沿用原系统，第三方库通过 Maven 解析；首次源码构建需要 Maven 仓库访问。

## 已验证

JDK 17 / Linux x86_64 上构建、单元回归、独立进程启动、真实 API 请求及 Chromium 核心交互均通过。Windows 脚本未在 Windows 实测。健康检查为 `/actuator/health`。

## 功能与操作

1. 上传样本，独立实测 NONE 与 DEFLATE 1/6/9 级，测量压缩率和压缩/解压耗时并校验内容。
2. 或导入算法库软件导出的 JSON 画像：这是离线文件交换，不要求算法库同时运行。
3. 填写规划字节数、安全速率、丢包率、网络质量、优先级与保持时间。
4. 对比候选策略耗时、分块大小和缓存建议；再次分析时以上次结果作为当前策略。
5. 导出分析报告，或清除当前策略重新选择。

优化引擎保留原有目标函数、切换收益阈值及最短保持时间。默认最短保持时间为原代码的 1000 ms，切换收益阈值可使用 `--app.strategy.switch-gain-percent=3.0` 设置。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST multipart | `/api/strategy/measure` | `file` 样本实测 |
| POST JSON | `/api/strategy/analyze` | 根据画像选择和排名 |

分析字段：`profiles`, `bytes`, `safeRateKbps`, `packetLossPercent`, `quality`, `priority`, `alreadyCompressed`, `previous`, `heldMillis`。画像结构参见界面及算法库导出 JSON。

规划大小上限 64 MiB；`safeRateKbps` 采用 KiB/s。耗时为基于实测画像的模型估算，不会执行网络发送。导入另一台电脑的画像会受到硬件性能差异影响。

“预处理”保留为建议字段，没有新增真实列式编码或字典编码实现。当前独立界面使用 NONE 预处理，避免把建议计为已执行处理。

分析状态由当前页面保留，刷新页面后清除；报告可手动导出。
