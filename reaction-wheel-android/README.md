# 动量轮助手 Android App v1.0

原生Android Java App，通过 **USB OTG＋CH340等USB串口适配器**连接现有AT32F403A旧固件。无需修改或烧录动量轮固件。本版为USB首版，不提供Wi-Fi/蓝牙运动控制。

- [下载可安装的开发测试APK](../deliverables/wheel-link-android-v1.0-debug.apk)
- [下载完整Android Studio源码工程](../deliverables/wheel-link-android-v1.0-source.zip)
- [SHA-256](../deliverables/wheel-link-android-v1.0-SHA256SUMS.txt)
- [验证报告](验证报告.md)

## 功能

- USB串口设备选择和授权，固定230400 / 8N1，无流控；默认探测器包含CH340、CP210x、FTDI等驱动，具体手机/适配器仍需现场验证。
- 手动开启旧固件遥测：`A0 AC 08 BA 66`。
- 停止电机按钮：`A0 AC 05 B7 66`。发送状态、固件命令回显和超时分开显示；回显不等于实际停转检测，也不是硬件急停。
- 解析旧协议`23 + 64字节 + sum8`，显示XYZ角速度、遥控rc_x/y、最近曲线、有效帧/坏候选/字节计数。
- CSV和原始`.legacy`记录，通过系统文件选择器导出，不申请全盘存储权限。最近文件可在重启App后导出，较早记录通过“选择历史记录导出”保存；卸载前请先导出。
- 演示模式：产生明确标注的演示数据；USB控制按钮不可用，CSV标DEMO，文件名前缀demo-wheel。

## 手机接线与使用

1. Android 8.0及以上，手机需要USB Host/OTG功能；部分机型需在设置里打开OTG。安装APK时按系统提示允许该下载来源安装。
2. 手机接OTG转接头，再接现有CH340 USB-TTL。适配器不能同时插在电脑上；Android不使用Windows的COM6名称，而是在App内选择USB设备。
3. 保持原接线：适配器GND→AT32 Debug GND、RXD→板端TXD、TXD→板端RXD，使用兼容3.3V的信号电平。板卡独立使用原电源；AT32 Debug电源脚、DIO和CLK不接。
4. 打开App，点击“选择并连接USB串口”，选择设备并允许USB访问。连接本身不会开启遥测或启动电机。
5. 点击“开启遥测”，观察有效帧增长。固件可能回显`A0 AC 08 BA 99`；旧协议输出不是可读文本。
6. 需要停止时点击“停止电机”，核对是否收到05回显，同时确认实物状态；原设备手柄/物理停机方式仍需保留，其他遥控输入可能改变板端状态。
7. 点击开始记录；结束后停止记录并分别导出CSV和原始数据。切到后台或打开系统导出界面会断开USB；返回App后需要重新连接。

离开App、USB拔出、手机断电及关闭页面都不保证电机停止。App不自动重连、不在重连时重发电机动作，也不发自动校准/转动指令。USB写入成功仅证明数据写入适配器；固件忙时回显可能缺失。

## 旧固件的能力边界

仓库旧固件USART3的08命令控制遥测，05命令将三个电机的Cali_flag置零。自动起立、单边/单点平衡和摇杆控制走USART2手柄协议，不是当前Debug串口的同一组命令。板载ESP32源码为BLE手柄接收端，没有现成Wi-Fi控制服务；本版不虚构运动方向/转速/起立按钮。

旧Debug.c只输出通道1～3角速度和15～16遥控值，4～14填零，不能当成姿态、轮速、电流或电压测量。CSV保留16个通道，预留列明确标为reserved。原始记录保留接收到的串口字节，包含回显和坏候选。

旧协议无设备采样时间/序号，CSV时间为手机会话经过毫秒，序号为手机解析有效帧后生成，不能用于证明串口无丢帧。sum8可能漏检错误；本版不声称位级协议检错等同CRC。

## 与电脑压缩系统配合

本版App用于本地USB控制与记录，不后台上传网络，也不取代已交付的电脑实时采集器。两者不能同时占用同一个适配器。App导出的原始USB `.legacy` 文件可在电脑通过现有程序压缩上传：

```powershell
python .\serial-agent\wheel_agent.py --protocol legacy --replay .\phone-record.legacy --backend http://127.0.0.1:8082 --pace 0.2
```

演示导出的原始文件同样符合旧协议，但必须按演示数据处理，不能标为实机记录；原始二进制协议本身不携带DEMO标记。

## Android Studio构建

用Android Studio打开本目录，使用JDK17、Android SDK Platform35、Build Tools35及Gradle8.9（wrapper已提供），等待同步后运行app。也可：

```powershell
.\gradlew.bat :app:assembleDebug
```

原生Java，无Kotlin、Compose或在线串口库依赖；第三方串口源码及编译注解已随工程提供。Gradle插件8.7.3首次同步需要网络。设置本机SDK路径使用不提交的local.properties。

本次APK采用独立Android SDK工具链构建，未执行Gradle assembleDebug。Linux/macOS在安装JDK17和SDK后可复现：

```bash
export JAVA_HOME=/path/to/jdk17
export ANDROID_SDK_ROOT=/path/to/android-sdk
bash build-sdk.sh
```

默认使用platforms/android-35和build-tools/35.0.0；必要时通过ANDROID_PLATFORM_JAR、ANDROID_BUILD_TOOLS指定路径。该脚本直接执行aapt2、javac、d8、zipalign、apksigner，输出app/build/sdk/wheel-link-debug.apk。

APK使用开发测试签名，非商店正式发布签名。私钥未上传；将来改用不同签名可能需要先导出数据、卸载旧App后安装。库许可见third_party/NOTICE.md。

## 本地协议测试

```bash
mkdir -p app/build/protocol-test
javac --release 8 -encoding UTF-8 -d app/build/protocol-test app/src/main/java/com/chendian/wheellink/WheelProtocol.java tests/ProtocolTest.java
java -cp app/build/protocol-test ProtocolTest ../reaction-wheel-compression-v1.1/examples/legacy-gyro.uart
```

本次已编译APK、验证签名与协议；没有Android真机/模拟器运行结果，USB权限、具体OTG设备和实物停止行为需现场验收。
