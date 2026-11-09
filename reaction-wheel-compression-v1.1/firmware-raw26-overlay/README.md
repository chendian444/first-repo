# 原始26通道遥测覆盖文件

不要把这两个文件直接覆盖到现有板端压缩工程。请用tools/prepare_raw26_firmware.py针对此次上传的原始balanced-cube-v1.02工程生成新副本，工具同时处理1ms计数及USART3 DMA忙检查。

只修改Debug.c/h、timer.c、usart.c/h。不会修改PID/FOC、无线控制、应用调度顺序或ESP32源码。串口RWT1固定122字节，26通道顺序见完整操作手册；压缩仅在电脑端进行。

运行包中已包含由该工具生成的完整firmware-raw26工程；旧BIN/AXF等产物不携带，需要用户在Keil完成完整构建、下载和Verify。若现用无线工程不同，请从现用工程生成新副本或合并指定五处改动。原项目GPL-3.0许可证见LICENSE。
