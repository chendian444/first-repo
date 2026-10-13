# 数据压缩传输任务交互与全流程管理软件

独立 Java/Spring Boot 应用，有自己的界面、HTTP API、配置、依赖声明、启动脚本和测试；不依赖其他四个项目的目录或进程。源码位于 `src`，可运行文件为 `app.jar`。

## 直接运行

需要 Java 17 或更高版本。运行发布包不需要 Node、Python 或 Maven。

- Windows：双击 `start.bat`。
- Linux：`sh start.sh`。
- 通用命令：`java -jar app.jar`。

启动后在浏览器输入 `http://localhost:8105`。停止使用 Ctrl+C。端口冲突时可执行：

```sh
java -jar app.jar --server.port=8205
```

默认绑定所有网卡，可用 `--server.address=127.0.0.1` 仅绑定本机。

## 源码开发

需要 JDK 17+ 和 Maven 3.9+。在本工程目录运行 `mvn -B clean package`；回归测试会执行，得到 `target/05-transfer-manager-1.0.0.jar`。

`start.sh`/`start.bat` 优先运行已有 `app.jar`，源码改动后请运行新构建的 JAR，或用它替换 `app.jar`，避免运行旧产物。依赖版本沿用原系统，第三方库通过 Maven 解析；首次源码构建需要 Maven 仓库访问。

## 已验证

JDK 17 / Linux x86_64 上构建、单元回归、独立进程启动、真实 API 请求及 Chromium 核心交互均通过。Windows 脚本未在 Windows 实测。健康检查为 `/actuator/health`。

## 功能与操作

1. 选择单文件、多文件或文件夹，保留文件名和目录层级。
2. 配置任务名称、业务场景、优先级和 ZIP 0–9 级，提交至优先级队列。
3. 执行真实 ZIP 压缩，通过 HTTP 投递压缩包，等待接收端 SHA-256 校验 ACK。
4. 接收端解压并落盘；发送端再次逐文件恢复和核对 SHA-256。
5. 查看压缩/传输/恢复耗时，下载压缩包及来自实际恢复目录的恢复包。
6. 支持暂停、继续、取消、失败后重试及 3 次自动链路重试。

默认接收地址为空时，实际 HTTP 请求发送至本实例 `/api/receive`，即使其他四个软件都未启动也能运行全流程。这是本机接收验证，不表示已经跨互联网发送。

跨电脑传输：在另一台电脑启动本软件，填写完整接收地址，例如 `http://接收端IP:8105/api/receive`。没有要求接收端配置其他软件。跨电脑连通性仍取决于实际网络条件；本次验证覆盖本机 HTTP 与测试接收端，未验证用户现场网络。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST multipart | `/api/tasks` | `files` 可重复；可选 `name`, `kind`, `scene`, `priority`, `level`, `receiver` |
| GET | `/api/tasks` | 任务与历史 |
| GET | `/api/tasks/{id}` | 详情 |
| POST | `/api/tasks/{id}/{action}` | `pause`, `resume`, `cancel`, `retry` |
| GET | `/api/tasks/{id}/download/compressed` | 实际生成的 ZIP |
| GET | `/api/tasks/{id}/download/restored` | 实际恢复目录重新打包的 ZIP |
| POST application/zip | `/api/receive` | `X-Task-Id` UUID、`X-Checksum-Sha256` |

单任务原始文件总大小上限为 64 MiB。单实例使用一个任务 worker，普通/重要/关键任务按原分类策略排序。文件夹名称通过浏览器相对路径保留。

## 持久化与行为边界

- `runtime/jobs/{id}`：原始 DCCPKG、任务元数据、压缩 ZIP、实际恢复目录。
- `runtime/received/{id}/files`：接收端恢复文件；旁边 `transport.zip` 为收到的包。
- 可使用 `--tasks.storage=/path/to/data` 改变目录。
- 完成任务及下载在重启后保留。被进程中断的未完成任务标记失败，用户可重试原始任务，不会伪装为自动断点续传。
- 暂停在文件块或阶段边界生效，已发出的 HTTP 请求需先返回；取消不撤销接收端已经保存的文件。
- 重试重新执行任务，而不是字节级网络断点续传。
- 为保持独立运行并避免复制算法库/预测/优化代码，本软件独立模式仅采用标准 ZIP 封装与手动级别。原单体系统跨功能的在线 LSTM 自适应多算法调度没有复制到这里；策略分析和多算法实测分别由软件 2、4 提供。
