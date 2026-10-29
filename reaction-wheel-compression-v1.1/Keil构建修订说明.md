# v1.1 Keil 构建修订说明

本版针对用户提供的 ARM Compiler 5.06 update 7 Rebuild 日志整理。日志中的 36 项错误均为 C9511E/A9511E，包含 Product: unknown 和 product not found；在该日志中编译器未进入源码检查阶段。

## 本版改动

- 工程显式定义 AT32F403ARCT7，减少对设备包自动注入芯片宏的依赖。
- 工程显式开启 C99，与新增编码模块使用的语言标准一致。
- 增加 tools/check_keil_build.py，检查工程引用文件，并可在本机实际调用 ARMCC5/armlink 编译链接一个最小探针程序。
- 保留原 ARMCC5、启动文件及 FOC 库，不未经验证切换到 Compiler 6，不改变电机控制逻辑。
- 不设置、篡改或绕过 MDK 许可证；本版不能仅靠源码消除本机的 C9511E。

这些工程设置改动是配置加固，不是对 C9511E 的许可证修复。旧日志不能证明原 C99 设置或芯片宏已造成编译错误。

## 先处理 C9511E

1. 在 µVision 的 File → License Management 确认授权有效，并支持实际选用的 Compiler 5 版本。
2. 如果仍显示 product not found，使用相应官方安装程序修复、完整安装并注册 MDK/ARMCC5；不要只复制 Bin 文件夹。
3. 在 Options for Target → Target 的编译器选择中使用已安装、注册且与授权兼容的 Compiler 5。原工程为 5.06 update 6；5.06 update 7 需要对应本机产品和授权支持。
4. 关闭并重新打开 µVision 后 Rebuild。不要根据 unset 列表随意批量设置环境变量，unset 本身不等于全部变量都需要手工填写。

## 使用预检查

在本版解压根目录打开 PowerShell：

```powershell
python .\tools\check_keil_build.py
python .\tools\check_keil_build.py --arm-bin 'D:\Keil\ARM\ARM_Compiler_5.06u7\Bin'
```

第一条仅检查工程 XML、文件路径、芯片宏和 C99 设置，不能证明 ARM 编译或许可证有效。第二条继承当前终端环境，使用临时目录实际编译、链接最小 C 程序，结束后删除临时产物；不会修改许可证、注册表、环境变量或工程源码。

命令行终端与 µVision 可能拥有不同的产品/授权环境。若命令行失败而 µVision 编译正常，应检查启动环境差异，不能据此认定项目源码错误。此探针不覆盖启动汇编和 FOC 库链接。

预检查通过后，仍需用 Keil 打开 firmware\USER\AT32F403A.uvprojx 执行完整 Rebuild，以生成新的 AXF 并确认 0 Error(s)。若仍有错误，请保留首条新的错误和最终汇总继续定位；不要公开许可证编号、激活码或授权文件内容。

## 本版实际验证

已完成：工程静态检查、引用文件完整性、GCC 对真实设备头文件的语法检查、C/Python 无损协议测试、遥测调度桩测试。当前 Linux 环境没有已授权的 ARMCC5/Keil 或真实板卡，未执行完整 Keil Rebuild、烧录或硬件时序验收，不能声称本版在用户电脑上必然零错误。

原 Java/Vue/串口链路保持原版行为，完整包继续包含已有上位机运行产物。本次没有重新构建 Java/Vue；以前的软件验证记录保留，并标注为历史记录。
