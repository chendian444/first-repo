# 基于时序特征的网络传输速率智能预测软件

独立 Java/Spring Boot 应用，有自己的界面、HTTP API、配置、依赖声明、启动脚本和测试；不依赖其他四个项目的目录或进程。源码位于 `src`，可运行文件为 `app.jar`。

## 直接运行

需要 Java 17 或更高版本。运行发布包不需要 Node、Python 或 Maven。

- Windows：双击 `start.bat`。
- Linux：`sh start.sh`。
- 通用命令：`java -jar app.jar`。

启动后在浏览器输入 `http://localhost:8103`。停止使用 Ctrl+C。端口冲突时可执行：

```sh
java -jar app.jar --server.port=8203
```

默认绑定所有网卡，可用 `--server.address=127.0.0.1` 仅绑定本机。

## 源码开发

需要 JDK 17+ 和 Maven 3.9+。在本工程目录运行 `mvn -B clean package`；回归测试会执行，得到 `target/03-rate-prediction-1.0.0.jar`。

`start.sh`/`start.bat` 优先运行已有 `app.jar`，源码改动后请运行新构建的 JAR，或用它替换 `app.jar`，避免运行旧产物。依赖版本沿用原系统，第三方库通过 Maven 解析；首次源码构建需要 Maven 仓库访问。

## 已验证

JDK 17 / Linux x86_64 上构建、单元回归、独立进程启动、真实 API 请求及 Chromium 核心交互均通过。Windows 脚本未在 Windows 实测。健康检查为 `/actuator/health`。

## 功能与操作

- 输入按时间先后排列的速率点，或导入单列 CSV/TXT（允许一行列名）。
- 使用原系统 `rate-lstm.json` 权重与 Java LSTM 门计算，预测未来 12 个采样点。
- 样本不足时使用 FAST_HOLT_WARMUP；无新鲜输入时使用保守回退。
- 显示预测平均速率、安全预算、模型名称、降级原因、MAE/MAPE 和反馈样本数量。
- 提交与先前预测对应的实际值，更新原反馈校正及健康熔断机制。
- 导出预测 JSON。

“载入演示样本”只生成示例时序，不会采集当前机器的网络状态。采样间隔应由数据提供方保持一致，预测步长与输入采样步长相同。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST JSON | `/api/prediction` | `rates` 数组、`lossPercent`、`jitterMillis` |
| GET | `/api/prediction` | 当前输入的预测（过期时回退） |
| GET | `/api/prediction/health` | 校正健康状态 |
| POST JSON | `/api/prediction/feedback` | `predicted` 与 `actual`（均须为有限正数；0 不参与原反馈校正器，接口明确拒绝） |

支持 1–7200 个有限非负速率点，单位为 KiB/s。速率为 0 的点保留在输入图中，原预测器按原逻辑滤掉非正值用于模型计算。导入 CSV 仅支持单列，不会自动选择时间戳与速率混排的列。

模型加载和推理已验证，准确率仍需使用实际历史数据评估。没有重新训练或宣称新的准确率。原 `training/train_rate_model.py` 保留为参考，它只输出训练提示，不是完整训练程序；普通运行不需要 Python、NumPy 或 PyTorch。

时序与反馈校正在内存中，重启后清除。导出的 JSON 可作为记录。
