# 五个独立数据压缩与网络传输软件

所有源码、可运行 JAR、独立界面和启动脚本位于 [five-software](five-software)。

| 软件 | 源码和使用说明 | 默认端口 |
| --- | --- | --- |
| 多源网络传输状态实时监测软件 | [01-network-monitor](five-software/01-network-monitor) | 8101 |
| 自适应数据压缩策略分析与优化软件 | [02-adaptive-strategy](five-software/02-adaptive-strategy) | 8102 |
| 基于时序特征的网络传输速率智能预测软件 | [03-rate-prediction](five-software/03-rate-prediction) | 8103 |
| 多算法无损数据压缩方法库管理与可视化软件 | [04-compression-library](five-software/04-compression-library) | 8104 |
| 数据压缩传输任务交互与全流程管理软件 | [05-transfer-manager](five-software/05-transfer-manager) | 8105 |

## 在桌面打开

安装 Java 17 或更高版本，将仓库完整下载或克隆至本机；如果是 ZIP，请先完整解压。

Windows 用户双击 `five-software/打开五个软件.bat`，启动器会检查各软件就绪并打开浏览器界面。结束使用后双击 `five-software/关闭五个软件.bat`。Windows 一键脚本尚未在 Windows 实机测试。

Linux 用户进入单个软件目录执行 `sh start.sh`，或使用 `java -jar app.jar`。运行预构建的软件不需要 Node、Python 或 Maven；源码开发需要 JDK 17+ 与 Maven 3.9+。

## 验证与功能边界

15 个回归测试、42 项功能和浏览器检查通过，另验证了 5 个隔离目录启动以及算法库与策略软件的离线画像交换。

原有业务源文件按职责唯一分配，通用启动入口、页面布局与第三方依赖仍有复用。任务管理软件独立采用 ZIP；原单体系统跨模块的 LSTM 多算法联动没有重复复制到任务软件。

详细信息见 [总体说明](five-software/README.md)、[验证报告](five-software/validation/验证报告.md) 和各软件 README。仓库原有文件保留。
