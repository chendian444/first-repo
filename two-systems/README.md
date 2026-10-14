# 两个独立的压缩分析与速率预测软件

依据用户上传的 `DataCompress_System(2).7z.001` 至 `.006` 完整解压后的系统拆分。保留原 Vue 界面、Java 压缩传输后端、Node 网关和接收服务；业务算法与模型没有重写。

| 软件 | 默认展示 | 界面 / 后端 / 接收端端口 |
| --- | --- | --- |
| 自适应数据压缩策略分析与优化软件 | 发送端配置、接收端连接状态、当前推荐策略、压缩率–总耗时分析、传输任务队列 | 8102 / 8202 / 8302 |
| 基于时序特征的网络传输速率智能预测软件 | 发送端配置、接收端连接状态、预测与实际速率曲线、预测模型、预测健康、速率贴合度、趋势一致率、平均分片时延、平均传输速率、分片抖动 | 8103 / 8203 / 8303 |

## 启动

运行预构建版本需要 **Java 17+ 和 Node.js 18.17+**。完整解压交付包，保留整个 `two-systems` 目录结构。交付包包含一个共用 JAR、两个独立前端构建以及网关的 Node 依赖，正常运行无需 Maven。

Windows：分别双击 `apps/adaptive/启动.bat`、`apps/prediction/启动.bat`。关闭时使用各目录的 `关闭.bat`。启动器目前仅完成 Linux 下的对应 Node 逻辑验证，尚未在 Windows 实机测试。

Linux / macOS：

```sh
node scripts/start.mjs adaptive
node scripts/start.mjs prediction
```

启动脚本等待 Java 健康检查、接收服务响应和真实仪表盘数据就绪。停止：

```sh
node scripts/stop.mjs adaptive
node scripts/stop.mjs prediction
```

在桌面电脑浏览器访问该电脑的 8102 或 8103 端口。云环境通过本地请求和浏览器自动化验证；本说明不提供云端 localhost 预览链接。

## 接收与配置

每套软件会启动自己的本地接收服务。要验证本机接收，在对应界面的“接收端状态”中填写 `127.0.0.1:8302` 或 `127.0.0.1:8303`，点击“建立连接”。接收页面使用接收端端口的 `/receiver` 路径。

跨电脑接收沿用原系统网关，无需改变协议。把完整交付目录复制到接收机后，双击对应软件的 `接收端启动.bat`，或者在根目录运行 `node scripts/receiver.mjs adaptive` / `node scripts/receiver.mjs prediction`，只启动接收网关，无需在接收机运行 Java 后端。关闭该终端或按 Ctrl+C 即可停止。

发送端填写接收机的实际 IP 和 8302 / 8303 端口；若接收端口需要更改，在接收机启动前设置 `RECEIVER_PORT`。不要在同一电脑的同一端口重复启动本地接收服务。接收页面位于接收端端口的 `/receiver` 路径。独立接收启动与状态接口已在当前机器验证，跨电脑网络可达性需在实际部署中验证。

两套软件的 `runtime/adaptive` 与 `runtime/prediction` 分别保存日志、上传与任务历史；真正接收落盘的文件位于各自的 `receiver-received`，发送端查看文件的缓存位于 `received`。没有远端连接时仍支持原系统的本地压缩、恢复与完整性校验流程。

消息队列、API 回调、文件/文件夹、大文件分片、自动/手动控制、级别与优先级选择、开始/暂停/重置均沿用原实现。真实 RabbitMQ 模式需要先提供可达 Broker，并在启动前配置 `RABBITMQ_URL`；同时运行两套软件时按业务配置 `RABBITMQ_QUEUE`，避免默认共用队列。不要在聊天或源码中写入凭据。

## 拆分与代码复用

```text
two-systems/
  apps/adaptive/             自适应策略软件的启动入口及独立 UI
  apps/prediction/           速率预测软件的启动入口及独立 UI
  frontend/src/views/
    AdaptiveSoftwareView.vue     压缩软件入口
    StrategyAnalysisView.vue     原压缩耗时计算、推荐策略、任务队列
    PredictionSoftwareView.vue   原预测曲线与原效果接口指标的独立展示
    TransmissionMonitorView.vue  唯一一份共用的发送配置、接收连接与传输监控
  frontend/src/components/  原图表与面板组件，单份复用
  frontend/src/style.css    原主题，未修改
  frontend/src/sender-font-size.css  原字体尺寸，未修改
  backend/                  原 Java 业务源码、算法及模型，单份复用
  bridge/                   原网关及接收源码，单份复用
  shared-runtime/backend.jar  唯一一份构建产物
  scripts/                  构建、启动、关闭及云环境初始化
  validation/               验证报告、源文件哈希、接口结果与界面截图
```

压缩软件的主页面不再展示预测面板，预测软件的主页面不展示压缩推荐与耗时面板。各构建仅包含对应独立入口的代码块。两边共同需要的发送配置和连接操作只有一份源码；原业务后端具有策略与预测的依赖关系，为保留原行为，通过共享依赖复用，而不重复复制或删改底层实现。

原“传输监控”“效果展示”和接收页面继续可用，以保留原任务进度、恢复文件查看、队列和结果展示能力。原图表、配色、字体、图例、交互、公式与预测健康判定均沿用。新增 `split-layout.css` 仅安排面板位置。

## 数据含义及原行为

预测曲线来自原 `/api/dashboard/strategy`，任务统计来自原 `/api/dashboard/effect`。未完成任务时显示空曲线或 `—`，完成后显示原接口结果。保留原预训练 LSTM、回退预测器和健康判定，未重新训练或修改预测分数。

原系统未接入外部遥测时使用内置动态采样，任务内部还包含原有传输耗时建模；跨电脑接收是在恢复包生成后投递到接收机。拆分没有将这些原行为改写成新的测量或传输算法。

原上传流程刷新选项后可能仍显示上传前的数据包选中项；请在“发送数据包”下拉框确认所选文件。本次保留了原业务脚本，没有顺带修复该行为。

## 从源码构建

需要完整 JDK 17+、Maven 3.9+、Node.js 18.17+ 和 npm。Linux / macOS：

```sh
sh scripts/build.sh
```

Windows 可依次执行：

```bat
node scripts/install-node.mjs
cd frontend
npm run build -- --mode adaptive --outDir ../apps/adaptive/ui --emptyOutDir
npm run build -- --mode prediction --outDir ../apps/prediction/ui --emptyOutDir
cd ../backend
mvn -B package
cd ..
if not exist shared-runtime mkdir shared-runtime
copy backend\target\data-compress-control-system-v5-5.0.0.jar shared-runtime\backend.jar
```

原锁文件指向腾讯镜像，当前云环境访问该镜像被拒绝。安装器只在临时目录把下载地址映射到官方 npm 源，保持包版本和 `integrity` 字段，使用 `npm ci`，并保留源码目录中的锁文件。TLS、包完整性、Debian 签名和校验均未关闭。

云环境已准备完整 JDK 21 和 Maven 3.9.11，执行 `sh scripts/cloud-install.sh` 刷新依赖、构建两份前端、运行 Java 测试和网关测试。云脚本使用已准备快照内 `/workspace/scratch` 的工具链；在其他电脑请使用上面的标准构建步骤。

验证详情见 [验证报告](validation/验证报告.md)。
