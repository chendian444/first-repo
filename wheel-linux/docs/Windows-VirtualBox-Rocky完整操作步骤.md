# Windows + VirtualBox + Rocky + Xshell + VS Code 完整操作步骤

更新：2026-11-20。本手册替代Ubuntu命令作为你的主操作流程。默认Oracle VM VirtualBox、Rocky Linux 9近期小版本或Rocky 10、Windows本地VS Code Remote-SSH；“VS”在本文指VS Code，不是Visual Studio。已有SSH配置可正常工作时保留，不必重装虚拟机。

本版仅更新部署文档，采集/压缩/控制代码不变。此前软件验证在Linux环境完成，**未在你的Windows/VirtualBox/Rocky组合上实测**；下面每段均给出现场检查点。

## 1. 每个软件在哪里运行

| 位置 | 软件/任务 |
|---|---|
| Windows | VirtualBox、Xshell、VS Code本体、浏览器、原Wi-Fi控制台 |
| Rocky虚拟机 | GCC编译C采集器、USB-TTL串口、Python上传/分析、Java后端、Node页面 |
| 动量轮 | 原AT32固件、原ESP32 Wi-Fi控制程序，保持现有状态 |

```text
Windows浏览器 :9001 → Windows原Wi-Fi控制台 → Wi-Fi → ESP32 → 主控

动量轮AT32 Debug USART3 → USB-TTL（交给虚拟机）→ Rocky /dev/ttyUSB0
                                                      ↓ C采集/PC压缩
                                               Python + SQLite → Java :8082
                                                                  ↓
Windows浏览器 :18080 ← SSH隧道 ← Rocky 127.0.0.1:8080/wheel

Windows VS Code / Xshell → SSH → Rocky：编辑、终端、编译、调试
```

USB-TTL交给Rocky后，Windows不能同时打开COM6；这不会阻止Windows通过自身无线网卡继续Wi-Fi遥控。不要把Windows无线网卡也直通给虚拟机。

## 2. VirtualBox与Rocky基础配置

已有Rocky可启动就直接继续。新建虚拟机建议2个CPU、4GB以上内存、30GB以上磁盘；Windows主机内存足够时可给6GB。安装Rocky并创建普通用户，授予sudo权限，后续使用普通用户登录，不用root作为Remote-SSH工作账号。

以下以Rocky用户名wheel举例；实际不是wheel时，Windows命令和SSH配置都替换为你的用户名。

虚拟机“设置→网络→网卡1”：选择NAT并勾选网线连接。此方案不要求桥接，也不要求Rocky直接连接ESP32。Windows已有Wi-Fi控制继续走Windows网络。

关机配置或按VirtualBox界面支持方式，在NAT“高级→端口转发”添加：

| 名称 | 协议 | 主机IP | 主机端口 | 子系统IP | 子系统端口 |
|---|---|---|---:|---|---:|
| rocky-ssh | TCP | 127.0.0.1 | 2222 | 留空 | 22 |

只转发SSH。应用仍监听Rocky回环地址，通过SSH隧道访问；不要再加8080的NAT转发来替代SSH隧道。若主机2222已被占用，换成2223，并同步修改后续配置。

Rocky控制台执行：

```bash
cat /etc/rocky-release
uname -m
ip -br address
sudo dnf install -y openssh-server openssh-clients
sudo systemctl enable --now sshd
systemctl is-active sshd
```

若firewalld正在运行，查看活动zone并允许该网卡所在zone的ssh服务：

```bash
sudo firewall-cmd --get-active-zones
# 下例假设活动zone为public；若实际不同，把public替换为实际zone
sudo firewall-cmd --zone=public --permanent --add-service=ssh
sudo firewall-cmd --reload
```

firewalld未运行时不必执行其命令。不要关闭SELinux或整个防火墙排错。检查sshd：`sudo ss -lntp | grep ':22 '`；若Rocky无网络，先在VirtualBox检查NAT/网线和Rocky网络连接，再安装依赖。

## 3. Windows连接：先SSH，再Xshell和VS Code

### Windows PowerShell

Windows需启用OpenSSH客户端；可在“设置→可选功能”中安装。执行：

```powershell
ssh -V
ssh -p 2222 wheel@127.0.0.1
```

首次核对主机指纹后再确认；可在Rocky控制台用`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`核对对应ED25519指纹。输入Rocky普通用户密码。成功后提示符为Linux终端，执行`whoami`、`pwd`确认。密码输入时没有星号是正常现象。

### Xshell

新建SSH会话：主机127.0.0.1、端口2222、用户名wheel，使用你的Rocky密码或已配置SSH密钥。Xshell用于操作同一台Rocky，不是另一套Linux环境。

### VS Code Remote-SSH

在Windows VS Code安装Microsoft的Remote - SSH扩展。编辑Windows的`%USERPROFILE%\.ssh\config`，增加：

```sshconfig
Host rocky-wheel
    HostName 127.0.0.1
    Port 2222
    User wheel
```

执行“Remote-SSH: Connect to Host...”选择rocky-wheel，平台选Linux。首次安装VS Code Server可能需要网络，按扩展日志定位下载问题，不要为了连接关闭主机指纹检查。

左下角应显示“SSH: rocky-wheel”。通过远程窗口“打开文件夹”选择Rocky内项目目录；此窗口的集成终端命令在Rocky执行。C/C++、Python扩展在提示时安装到SSH远端。不要在Windows PowerShell里执行dnf或Linux make命令。

## 4. Rocky安装依赖：不用apt

在Xshell或VS Code远程终端执行：

```bash
sudo dnf install -y gcc gcc-c++ make gdb git unzip curl usbutils
rpm -E '%{rhel}'
```

### Rocky 9（近期更新的小版本）

Rocky9默认python3可能为3.9，项目需要3.10+，因此使用并行安装的Python3.11，不替换系统Python：

```bash
sudo dnf install -y python3.11 python3.11-pip java-17-openjdk-headless
sudo dnf module list nodejs
```

Node已经>=18.17可继续；全新环境可在列表确认有22流后安装：

```bash
sudo dnf module install -y nodejs:22/common
```

若启用了别的Node流，不要直接覆盖或盲目reset；先检查现有版本与模块状态。若列表没有该流，先确认Rocky版本、AppStream仓库与网络；可使用满足>=18.17的受支持流。不要套用Ubuntu的Node安装命令。

### Rocky 10

```bash
sudo dnf install -y python3 python3-pip java-21-openjdk-headless nodejs npm
```

此处以Java21运行Java17目标JAR；仍需执行后面的本机启动检查。若不是Rocky9/10，先按实际发行版选择满足Python3.10+、Java17+、Node18.17+的软件包，不能把Rocky8默认Python直接拿来运行。

检查：

```bash
java -version
node --version
npm --version
gcc --version
```

Rocky9用`python3.11 --version`；Rocky10用`python3 --version`。Python3.11的venv创建方式如下节，进入后统一使用python即可。

## 5. 将完整运行包放到Rocky

下载仓库deliverables中的wheel-linux-data-analysis-v1.0.zip及同名SHA256SUMS文件。使用完整包，因为仅克隆源码通常没有JAR/dist等忽略的运行产物。

Windows PowerShell，先进入你保存ZIP的目录，示例：

```powershell
cd D:\Wheel
Get-FileHash .\wheel-linux-data-analysis-v1.0.zip -Algorithm SHA256
scp -P 2222 .\wheel-linux-data-analysis-v1.0.zip wheel@127.0.0.1:~/
```

hash与下载的SHA256SUMS对比，确认传输前文件完整。scp的大写-P是端口参数，与ssh小写-p不同。也可用Xftp/SFTP传到Rocky用户主目录；只用一种方式即可。

在Rocky执行：

```bash
mkdir -p ~/projects/wheel-system
unzip ~/wheel-linux-data-analysis-v1.0.zip -d ~/projects/wheel-system
cd ~/projects/wheel-system
ls
```

如果目录已放过旧版本，解压到另一个新目录，保留原记录，不覆盖。应看到wheel-linux、reaction-wheel-compression-v1.1、aiot-platform同级。不要只传wheel-linux一个目录。

VS Code远程打开`/home/wheel/projects/wheel-system`（用户名/主目录按实际替换）。在远程终端：

```bash
cd ~/projects/wheel-system/wheel-linux
# Rocky9：
python3.11 -m venv .venv
# Rocky10则只执行 python3 -m venv .venv，不要重复创建
source .venv/bin/activate
python --version
python -m pip install -r requirements.txt
make
```

用新终端时都需重新source；不要sudo pip，不把Windows的venv复制进Rocky。C采集器由Rocky本机编译，不复制其他Linux机器的build二进制。

## 6. 先验证回放与分析，不接硬件

在Rocky远程终端：

```bash
cd ~/projects/wheel-system/wheel-linux
source .venv/bin/activate
python tools/demo.py --output runtime/demo-01
make test
```

预期1000帧、采样100Hz、合成正弦峰10Hz。用VS Code远程资源管理器打开：

- runtime/demo-01/analysis/analysis.png
- runtime/demo-01/analysis/report.json
- runtime/demo-01/samples.csv

这些是明确标注的合成输入。无需在Rocky安装桌面或浏览器。第二次运行用demo-02等新目录，程序拒绝覆盖旧结果。

## 7. 启动Rocky压缩系统，并从Windows看页面

### Rocky终端A：保持服务运行

```bash
cd ~/projects/wheel-system/wheel-linux
source .venv/bin/activate
bash tools/start-compression.sh
```

服务使用Rocky的127.0.0.1:8080与8082；日志在runtime/services。另开Rocky终端验证：

```bash
curl -f http://127.0.0.1:8082/api/wheel/status
curl -I http://127.0.0.1:8080/wheel
```

### Windows PowerShell：保持隧道运行

```powershell
ssh -p 2222 -N -o ExitOnForwardFailure=yes -L 127.0.0.1:18080:127.0.0.1:8080 wheel@127.0.0.1
```

登录后窗口无输出并保持占用属于正常状态。Windows浏览器打开：

```text
http://127.0.0.1:18080/wheel
```

**Windows的127.0.0.1与Rocky的127.0.0.1不是同一台机器。** 这里18080是Windows端，8080是Rocky端；Linux采集上传仍填`http://127.0.0.1:8082`，不填Windows18080。

如果使用Xshell隧道，在会话属性→SSH→隧道中新增本地转发：侦听127.0.0.1:18080，目标127.0.0.1:8080；与上述PowerShell命令二选一，避免争用端口。VS Code Ports也可转发8080，但要以其实际分配的本地地址为准。

### Rocky终端B：上传合成回放

```bash
cd ~/projects/wheel-system/wheel-linux
source .venv/bin/activate
python capture.py --file ../reaction-wheel-compression-v1.1/examples/full-telemetry26.rwt --protocol raw26 --backend http://127.0.0.1:8082 --runtime runtime/replay-01
```

Windows页面可见26字段和曲线，队列最终归零。先完成此步骤，再做USB与实机，便于区分软件问题和硬件问题。

## 8. USB-TTL直通VirtualBox

1. Windows关闭XCOM、Arduino串口监视器、其他采集进程；确认转接器型号，不选择ESP32下载口。
2. VirtualBox安装与当前版本完全匹配的Oracle Extension Pack（使用USB2/3功能时），关机后在虚拟机“设置→USB”启用相应USB控制器。Guest Additions不是USB直通的替代品；用SSH/scp不需要先安装共享文件夹组件。
3. 启动Rocky，在VirtualBox虚拟机窗口“设备→USB”勾选对应CH340/USB-SERIAL转接器。也可添加仅匹配该设备VID/PID的过滤器，别捕获所有USB设备。
4. 设备交给虚拟机后，Windows COM6可能消失或不可用，这是正常的；Rocky应出现新的ttyUSB设备。

在Rocky检查：

```bash
lsusb
sudo journalctl -k -n 60 --no-pager
ls -l /dev/serial/by-id/
ls -l /dev/ttyUSB* /dev/ttyACM* 2>/dev/null
```

CH340常见Linux驱动ch341、设备/dev/ttyUSB0，但以实际输出为准。只有lsusb没有tty时，先查内核日志与驱动；两个都没有时先查VirtualBox设备是否成功捕获。Windows已安装CH340驱动并不等于USB已直通Rocky。

## 9. Rocky串口权限

不要默认套用Ubuntu的dialout组。先检查实际属组：

```bash
stat -c '%A %U %G %n' /dev/ttyUSB0
id
```

如果设备属组确实是dialout，且组存在：

```bash
getent group dialout
sudo usermod -aG dialout "$USER"
```

退出Xshell、VS Code远程连接并重新登录后检查id。仅source不会刷新补充组，VS Code Server可能保留旧用户组；最简单是保存工作后重启Rocky，再重连。

如果设备属组是root，不要把自己加入root组。可以建立专用设备组与udev规则：

```bash
sudo groupadd -f wheelserial
sudo usermod -aG wheelserial "$USER"
sudoedit /etc/udev/rules.d/70-wheel-serial.rules
```

写入一行（以下仅针对实际lsusb确认为1a86:7523的CH340；其他型号必须替换为其真实VID/PID）：

```text
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", GROUP="wheelserial", MODE="0660"
```

随后：

```bash
sudo udevadm control --reload-rules
```

在VirtualBox释放并重新捕获转接器，让规则生效；重登录/重启后检查id与设备权限。规则按VID/PID可能匹配多个同型号设备，多个转接器时再按设备序列号缩小匹配。不要chmod777或长期sudo运行采集器。

## 10. 保留Windows原Wi-Fi遥控

在Windows运行你原先可用的console/run.bat，浏览器打开http://127.0.0.1:9001；设备目标IP按实际配置。现有ESP32程序可用时不重刷。参考副本移除了SSID/密码，不能原样刷入后期待自动连接原网络。

WindowsWi-Fi控制与RockyUSB采集各走各的通道。ESP32控制UART921600、ESP32日志115200、AT32遥测230400不相同。ACK/pong不是传感器数据，也不是主控执行确认。不要通过按自动平衡/断电按钮来“测试Linux采集是否连接”。

## 11. Rocky实机采集

先解决此前电池电压/显示不一致的问题，确认独立供电与固定方式。USB-TTL只接AT32 Debug：RXD→板TXD、TXD→板RXD、GND共地；5V/DIO/CLK不接。不能从电量显示异常直接推定需要修改采集代码。

在Rocky终端B执行：

```bash
cd ~/projects/wheel-system/wheel-linux
source .venv/bin/activate
python capture.py --serial /dev/ttyUSB0 --protocol legacy --baud 230400 --enable-stream --backend http://127.0.0.1:8082 --runtime runtime/serial-01
```

实际设备路径不同则替换；可用/dev/serial/by-id/稳定链接。默认legacy适用于原0x23旧遥测。只有板端确实运行RWT1/26通道固件才改`--protocol raw26`。Wi-Fi程序更新不会自动增加AT32遥测字段。

旧协议有效字段只有gyroXYZ、rcXY，预留值不解释成电压、电流。完整26通道需要额外AT32遥测代码构建/下载/校验，不能靠Linux软件从零值恢复。采集器显式enable-stream仅发原08遥测开启命令，不发送电机控制动作。

Ctrl+C结束采集，但不等于停止电机。查看程序打印的采集目录，里面input.uart、frames.dcw、samples.csv分别为原始字节、压缩帧体、未滤波样本。原始记录保存在Rocky磁盘，不在Windows的D盘。

## 12. 分析实测数据与下载结果

Rocky终端，替换下面serial-实际ID为程序打印的真实目录名：

```bash
python analyze.py runtime/serial-01/serial-实际ID/samples.csv --channel gyro_x --window 5 --output runtime/analysis-01
```

legacy没有设备采样时间，默认不做FFT；仅有独立依据确定采样率时才加--fs，例如100Hz假设应写作`--fs 100`，报告注明假设，不把PC接收间隔当板端采样率。raw26在设备序号/时间规则且至少32个有限点时才做FFT；有缺口/异常不插值伪造。

用VS Code远程打开analysis.png/report.json/filtered.csv。也可在WindowsPowerShell下载整个结果目录：

```powershell
scp -P 2222 -r wheel@127.0.0.1:~/projects/wheel-system/wheel-linux/runtime/analysis-01 .
```

需要完整原始记录时下载对应serial目录。不要将实测数据、网络密码或令牌提交到Git。

## 13. 网络恢复、验证与结束顺序

同一backend/同一runtime恢复待传队列，不打开串口：

```bash
python capture.py --resume-only --backend http://127.0.0.1:8082 --runtime runtime/serial-01 --drain-seconds 60
```

队列最多10000批，满则停止并保留已有数据；Java仅内存保留最近256批幂等记录，重启后不保证永久去重。主机与虚拟机同机localhost上传，Windows断开互联网通常不会中断这段虚拟机内部链路，不能据此声称已测弱网。

额外验证：

```bash
make test
# 可选；若缺libasan/libubsan，按DNF提供的软件包补齐后再运行
make sanitize
python tools/check_java.py --backend http://127.0.0.1:8082 --output runtime/java-check-01
```

结束顺序：按原设备流程停机→Ctrl+C采集→检查/备份记录→Ctrl+C服务终端A→关闭WindowsSSH隧道→保存VS Code文件→在Rocky正常关机。不在写盘或USB采集中直接关闭虚拟机电源。

## 14. 常见问题速查

| 现象 | 优先检查 |
|---|---|
| Xshell连接127.0.0.1:2222失败 | 虚拟机是否运行、NAT转发、sshd22、防火墙、主机端口占用 |
| Remote-SSH成功但make找不到文件 | 是否远程窗口、打开的是否Rocky项目目录、是否cd wheel-linux |
| Python版本还是3.9 | Rocky9用python3.11建venv；检查which python和python --version |
| Windows18080打不开 | Rocky服务是否启动、SSH隧道是否保持、18080是否冲突；别直接访问Rocky的localhost |
| COM6消失 | USB已经交给Rocky，检查/dev/ttyUSB0，而不是在Windows重新打开COM6 |
| lsusb无转接器 | VirtualBox USB捕获/过滤器/Extension Pack版本、Windows占用 |
| tty存在但permission denied | 实际属组、补充组是否重登录、udev规则VID/PID是否匹配 |
| ACK增加但遥测没数据 | 控制与遥测分离；检查AT32 Debug、230400、协议和08开关 |
| 上传pending增加 | Rocky8082服务、URL与日志；与Windows9001控制台无关 |
| 图里没有频谱 | legacy采样率未知、有效点不足、设备序号/时间不规则；不是安装失败 |

本手册只重写环境流程；代码保持v1.0，真实Rocky/USB/无线控制仍需按检查点逐项验收。一般协议与字段定义见原整体操作步骤及验证报告。
