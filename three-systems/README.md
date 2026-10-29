# 三个独立的数据压缩与网络传输软件

2026-10-29 最新材料：按用户新上传的监测说明书和采集表统一版式，重写另外两套系统的说明书与采集表，并分别生成三个系统的源码Word和单系统源码工程。见 [本次Word材料](copyright-materials-20261029/README.md)，或 [下载全部Word](../deliverables/three-systems-word-20261029.zip)。

2026-10-28：三个系统已按指定软著名称更新主页面、接收监控页及浏览器标题，并重新构建运行界面。各系统的操作说明书、登记信息采集表、源码Word、完整工程源码及核验记录见 [软著材料](copyright-materials/README.md)；登记主体和日期等按用户回复保留“待补充”，版本号按模板默认暂填V1.0。

从上传的原“数据压缩控制传输系统”拆分，沿用原 Vue 界面、Java 压缩传输业务、Node 网关与接收服务。三个软件共用一份源码和一个后端 JAR，分别运行独立进程、端口和数据目录。

| 软件 | 主页面内容 | 界面 / Java 后端 / 接收端端口 |
| --- | --- | --- |
| 工业网络传输状态实时感知与监测系统 | 上排发送配置与传输链路，下排简化接收状态与任务队列；保留实时关键指标 | 8101 / 8201 / 8301 |
| 运行监测数据自适应压缩传输控制决策与优化系统 | 发送配置、接收状态、压缩率–总耗时分析、放大的当前推荐策略、任务队列 | 8102 / 8202 / 8302 |
| 工业网络数据传输智能诊断与预测系统 | 发送配置、接收状态、预测对比曲线与 16 项指标，主体填满可用工作区 | 8103 / 8203 / 8303 |

三个主页面均没有左侧三页导航栏。原主题、字体、图表颜色及业务计算沿用，新增 CSS 仅安排布局、间距、面板大小和必要换行。

## 运行交付包

完整解压 `three-systems-delivery.zip`，保留整个 `three-systems` 目录。运行需要 **Java 17+ 与 Node.js 18.17+**；交付包已含共用 `backend.jar`、三个 UI 构建和网关 Node 依赖，不需要 Maven 或重新安装 npm 依赖。

Windows：分别双击 `apps/monitor/启动.bat`、`apps/adaptive/启动.bat`、`apps/prediction/启动.bat`。关闭时运行各自 `关闭.bat`。批处理调用的 Node 启动逻辑已在 Linux 验证，尚未在 Windows 实机验证。

Linux / macOS，在交付根目录执行：

```sh
node scripts/start.mjs monitor
node scripts/start.mjs adaptive
node scripts/start.mjs prediction
```

在桌面电脑浏览器打开对应界面端口。云环境使用本地请求及浏览器自动化验证，不提供云端 localhost 预览链接。

停止对应软件：

```sh
node scripts/stop.mjs monitor
node scripts/stop.mjs adaptive
node scripts/stop.mjs prediction
```

启动脚本检查后端健康、接收端响应和仪表盘数据。端口分配及发送端/接收端角色配置集中于 `scripts/software-config.mjs`，各软件共享原服务实现。

## 接收与数据源

每套软件会启动独立的本地接收服务。在接收端状态中填写 `127.0.0.1:8301`、`127.0.0.1:8302` 或 `127.0.0.1:8303`，点击“建立连接”。监测软件只显示地址、通信状态及连接/断开操作，其他接收信息不在主页面展开；原完整接收服务和 `/receiver` 页面仍可使用。

跨电脑接收：将完整交付目录复制到接收机，双击对应软件的 `接收端启动.bat`，或者运行 `node scripts/receiver.mjs monitor` / `adaptive` / `prediction`，只启动原接收网关，无需 Java 后端。发送端填写接收机实际 IP 与接收端口。需要改接收端口时，启动前设置 `RECEIVER_PORT`。不要在同一端口重复启动服务。

文件、文件夹、消息队列、API 回调、原大文件分片路径、自动/手动压缩、级别与优先级选择、开始/暂停/重置、任务选择、恢复文件与目录查看均沿用原实现。RabbitMQ 需要可达 Broker，可在启动前配置 `RABBITMQ_URL` 和 `RABBITMQ_QUEUE`。三套软件并行使用消息队列时，按业务配置队列，避免默认共用队列。

各软件 `runtime/<软件>` 保存自己的上传文件、日志、任务历史和缓存；真正接收落盘目录为 `receiver-received`，发送端文件查看缓存为 `received`。这些运行数据不包含在交付包中。

## 预测指标的数据来源

预测模型、预测健康、速率贴合度、趋势一致率和曲线直接使用原 `/api/dashboard/strategy`。

| 指标 | 来源 |
| --- | --- |
| 平均分片时延、平均传输速率、分片抖动 | 原 `/api/dashboard/effect` 的已完成任务统计 |
| 平均网络延迟、丢包率、网络抖动 | 原 `/api/dashboard/transmission` 的链路指标 |
| 平均有效吞吐率、网络吞吐率、重试次数、完整性校验 | 原传输仪表盘的关键指标 |
| 传输进度、已处理帧/总帧 | 原传输仪表盘的进度字段 |

预测页面通过共用发送配置组件的仪表盘快照事件获取实时指标，不另写计算公式或造样本。完成任务统计和链路实时数据在卡片下方分别标注。任务未完成时原完成统计显示 `—`；原 LSTM、回退预测器、健康判定及曲线交互均保持。

原系统未接外部遥测时使用内置动态采样，任务内部包含原传输耗时建模；跨电脑接收仍在恢复包生成后投递。本次没有改变这些行为。

## 代码分配

```text
apps/monitor/                  监测软件启动入口和独立 UI
apps/adaptive/                 策略软件启动入口和独立 UI
apps/prediction/               预测软件启动入口和独立 UI
frontend/src/views/
  NetworkMonitorSoftwareView.vue    监测页组合
  AdaptiveSoftwareView.vue          策略页组合
  StrategyAnalysisView.vue          原压缩分析与推荐展示
  PredictionSoftwareView.vue        原预测与扩充指标展示
  TransmissionMonitorView.vue       单份发送、接收、链路及进度代码
frontend/src/components/TransferTaskQueue.vue  单份原任务队列
frontend/src/style.css              原主题，未修改
frontend/src/sender-font-size.css   原字体尺寸，未修改
backend/                           原业务、算法、模型，单份复用
bridge/                            原网关及接收服务，单份复用
shared-runtime/backend.jar         一个共用运行产物
scripts/                           构建和三个系统的启动/停止
validation/                        检查脚本、报告、接口记录与截图
```

按构建模式只加载各自入口，监测 UI 不加载压缩分析或预测入口；独立系统不重复复制三份底层代码。原策略和预测与任务传输具有业务依赖，为保留原实现，对依赖的模块作单份复用。

原 `/transmission` 和 `/effect` 详细功能仍保留，任务名称可以进入原进程视图；详细视图提供“返回软件首页”。侧边三页选择栏已移除。监测主页面点击任务名会选择原任务并保持在监测页。

原上传刷新后选中项可能保持之前的值，请在“发送数据包”下拉框确认所选文件；本次没有顺带修改原业务脚本。

## 从源码构建

开发需要完整 JDK 17+、Maven 3.9+、Node.js 18.17+ 和 npm。Linux / macOS：

```sh
sh scripts/build.sh
```

Windows 可依次执行：

```bat
node scripts/install-node.mjs
cd frontend
npm run build -- --mode monitor --outDir ../apps/monitor/ui --emptyOutDir
npm run build -- --mode adaptive --outDir ../apps/adaptive/ui --emptyOutDir
npm run build -- --mode prediction --outDir ../apps/prediction/ui --emptyOutDir
cd ../backend
mvn -B package
cd ..
if not exist shared-runtime mkdir shared-runtime
copy backend\target\data-compress-control-system-v5-5.0.0.jar shared-runtime\backend.jar
```

原依赖锁文件指向腾讯镜像，当前云环境无法访问该镜像；安装器仅在临时目录把 URL 映射到官方 npm 源，保持原版本和 integrity，使用 `npm ci`，不改写源码锁文件，不关闭 TLS 或校验。

当前云快照已保留完整 JDK 21 与 Maven 3.9.11。运行 `sh scripts/cloud-install.sh` 安装依赖、构建三个 UI、运行 Java 与网关原测试。在其他电脑使用上面的标准构建步骤。

验证结果及边界见 [验证报告](validation/验证报告.md)，页面截图见 `validation/monitor-overview.png`、`adaptive-overview.png`、`prediction-overview.png`。
