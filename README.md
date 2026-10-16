# 三个独立的数据压缩与网络传输软件

当前源码、运行产物和启动脚本位于 [three-systems](three-systems)。完整交付包为 [three-systems-delivery.zip](three-systems-delivery.zip)。

| 软件 | 主界面端口 | 说明 |
| --- | --- | --- |
| 多源网络传输状态实时监测软件 | 8101 | [启动说明](three-systems/apps/monitor) |
| 自适应数据压缩策略分析与优化软件 | 8102 | [启动说明](three-systems/apps/adaptive) |
| 基于时序特征的网络传输速率智能预测软件 | 8103 | [启动说明](three-systems/apps/prediction) |

完整解压交付包，安装 Java 17+ 与 Node.js 18.17+，双击对应目录的“启动.bat”。三个主界面没有左侧导航；沿用原系统主题、字体和业务实现，共用代码只保留一份。

[使用与构建说明](three-systems/README.md) · [验证报告](three-systems/validation/验证报告.md)

上一个双系统版本可从仓库历史查看，本次请使用三系统交付包。


## 动量轮数据压缩传输集成

新增 AT32F403A 单片机压缩、USART3 传输和上位机解压监控工程，与原三个软件目录分别保存。

- [完整源码与说明](reaction-wheel-compression)
- [完整运行包（约 40 MB）](deliverables/reaction-wheel-compression-integration.zip)
- [完整压缩传输操作手册](reaction-wheel-compression/完整压缩传输操作手册.md)
- [验证报告](reaction-wheel-compression/验证报告.md)

软件链路已验证；真实 AT32 板上的 Keil 完整编译、烧录和控制时序验收仍需完成。
