# 多算法无损数据压缩方法库管理与可视化软件

独立 Java/Spring Boot 应用，有自己的界面、HTTP API、配置、依赖声明、启动脚本和测试；不依赖其他四个项目的目录或进程。源码位于 `src`，可运行文件为 `app.jar`。

## 直接运行

需要 Java 17 或更高版本。运行发布包不需要 Node、Python 或 Maven。

- Windows：双击 `start.bat`。
- Linux：`sh start.sh`。
- 通用命令：`java -jar app.jar`。

启动后在浏览器输入 `http://localhost:8104`。停止使用 Ctrl+C。端口冲突时可执行：

```sh
java -jar app.jar --server.port=8204
```

默认绑定所有网卡，可用 `--server.address=127.0.0.1` 仅绑定本机。

## 源码开发

需要 JDK 17+ 和 Maven 3.9+。在本工程目录运行 `mvn -B clean package`；回归测试会执行，得到 `target/04-compression-library-1.0.0.jar`。

`start.sh`/`start.bat` 优先运行已有 `app.jar`，源码改动后请运行新构建的 JAR，或用它替换 `app.jar`，避免运行旧产物。依赖版本沿用原系统，第三方库通过 Maven 解析；首次源码构建需要 Maven 仓库访问。

## 已验证

JDK 17 / Linux x86_64 上构建、单元回归、独立进程启动、真实 API 请求及 Chromium 核心交互均通过。Windows 脚本未在 Windows 实测。健康检查为 `/actuator/health`。

## 功能与操作

- 独立保留 NONE、GZIP、DEFLATE、ZIP、BZIP2、LZMA、LZ4、ZSTD、SNAPPY、BROTLI 共 10 个方法。
- 查看可用级别，按当前会话启用或停用方法。
- 上传文件进行真实基准测试，对每种方法执行压缩、解压和原始字节一致性校验。
- 比较体积比例、压缩/恢复耗时，并导出供策略软件使用的性能画像。
- 使用指定算法压缩为 `.dclib`，解压时验证原始长度和 SHA-256。

NONE 是不压缩基线。算法启停只影响后续压缩和基准，不影响已有包的恢复。启停状态重启后重置，不提供任意脚本/插件动态装载。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/library` | 列出算法和级别 |
| POST | `/api/library/{name}/enabled?value=false` | 停用方法 |
| POST multipart | `/api/library/benchmark` | `file` 真实基准与校验 |
| POST multipart | `/api/library/compress` | `file`, `algorithm`, 可选 `level` |
| POST multipart | `/api/library/restore` | `file` 为 `.dclib` 包 |

基准及单文件压缩上限为 8 MiB，恢复包上传上限为 16 MiB；界面会显示不支持或失败的方法，不会用假数据补齐。基准耗时包含首次原生库加载/JIT 开销，不作为跨硬件性能保证。

`.dclib` 是本软件定义的带算法与完整性信息的封装，不是通用 ZIP，也不兼容原单体系统的 DCCZ。封装不保留原文件名；浏览器通常根据 `.dclib` 文件名推导下载名。

原生依赖包含 Windows x86_64 和 Linux x86_64 的 Brotli 库。Linux x86_64 上的 10 种方法已实测。Windows 启动脚本已提供，但没有 Windows 运行实测；macOS/ARM 不保证所有原生方法可用。
