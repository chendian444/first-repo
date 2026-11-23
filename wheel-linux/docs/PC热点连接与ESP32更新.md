# PC-Hotspot连接与ESP32配置更新

2026-11-23。目标：Windows自建2.4GHz热点PC-Hotspot，网关192.168.137.1，WPA2-Personal，ICS自动分配地址。UDP端口继续8888。密码仅放本地WiFiCredentials.h，不上传Git或公开运行包。

## 配置变化

- ESP32C3_WiFi_RC.ino通过同目录WiFiCredentials.h读取SSID/密码。
- USE_STATIC_IP=0，wifi_begin中显式启用DHCP；不再使用旧静态192.168.0.9。保留的192.168.137.9静态示例当前不会生效，不保证此IP无冲突，不要据此填写控制台。
- 不固定BSSID或信道，热点保持2.4GHz，ESP32自动按SSID连接。电脑热点重开后BSSID/信道可能变化，无需写死。
- GPIO0/1、控制UART921600、UDP协议、控制帧、500ms中位保活逻辑均未修改；不改AT32固件或USB遥测。

## 文件与保密

本聊天的本地配置包包含已填写的WiFiCredentials.h，仅供你使用，不要公开上传。GitHub公开源码只含WiFiCredentials.h.example：下载公开源码后复制为WiFiCredentials.h，在自己电脑填写热点密码。Arduino工程文件夹和主文件均为ESP32C3_WiFi_RC，头文件放同目录。

原v1.0完整系统ZIP保留历史固件参考，不会自动变成此热点配置；本次使用单独的PC热点补丁包替换对应ESP32工程。

## Windows操作顺序

1. 在遥控页面停止发送，按设备原流程停机、固定设备。保持PC-Hotspot开启、2.4GHz，确认实际网关仍为192.168.137.1。
2. 完整解压本聊天配置包到新目录。Arduino IDE打开ESP32C3_WiFi_RC/ESP32C3_WiFi_RC.ino，确认同目录有WiFiCredentials.h，避免只复制ino导致找不到头文件。
3. 使用之前成功的ESP32-C3板卡/端口设置，保持esp32开发板包2.0.4、ArduinoJson6.x。先编译，再上传到ESP32；本次不是AT32固件，不能通过AT32 Debug的DIO/CLK刷ESP32。沿用已验证的ESP32下载接线与供电，不猜测CN4电源脚。
4. 上传后退出下载模式并复位ESP32，用原ESP32调试串口115200查看开机日志。它与AT32遥测USART3的230400不是同一串口。若下载器被VirtualBox捕获，先释放回Windows；只释放实际ESP32下载设备，不必打断另一只CH340遥测设备。
5. 预期日志出现[WiFi] connected, ip=192.168.137.X和[UDP] listen on 192.168.137.X:8888。X由DHCP决定，不能预先承诺是9。也可在Windows热点已连接设备列表确认IP。
6. Windows控制台保持http://127.0.0.1:9001。把ESP32 IP从192.168.0.9改为日志里的实际IP，端口8888，点击应用；192.168.137.1是电脑，不是ESP32目标。
7. 先点Ping ESP32确认PONG，再按原设备流程进行受控测试。ACK说明网关处理指令，不证明AT32执行。不要只看ERR0。
8. 若ESP32已有IP但无PONG，检查热点仍开启、IP是否变化，Windows安全软件是否拦截该Python程序的UDP9002入站。只允许所需程序/受控网络，不关闭整个防火墙；页面9001可访问不代表UDP回程已放行。

未执行Arduino完整编译、刷写或真实热点连接。已完成配置静态核对与原控制逻辑未变比较；实际结果以编译日志、ESP32开机IP和PONG为准。若显示connecting/timeout，核对热点SSID/密码、安全模式、2.4GHz和实际开启状态，不能通过修改控制台目标IP替代ESP32入网。
