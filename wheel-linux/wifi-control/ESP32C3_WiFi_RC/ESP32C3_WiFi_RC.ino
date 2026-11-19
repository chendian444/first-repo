/*********************************************************
 *  ESP32C3_WiFi_RC.ino
 *  Cubli 平衡立方体 WiFi(UDP + JSON) 遥控网关
 *
 *  数据通路:
 *    PC(Flask :9001) --UDP JSON--> ESP32 --UART1 921600--> STM32 USART2(PA3)
 *
 *  ---- 文件编码：UTF-8（无 BOM）----
 *   请勿使用 GBK/ANSI 另存为
 *
 *  ==== 引脚依据：SCH_Cubli_Mcu_V1.5_2024-02-16.pdf ====
 *   ESP32-C3FH4 (U10) 实际接线如下：
 *     pin 4  XTAL_32K_P = GPIO0  -> 网络 TX1  -> STM32 PA3(USART2_RX)   [UART1 TX]
 *     pin 5  XTAL_32K_N = GPIO1  -> 网络 RX1  -> (预留)                  [UART1 RX]
 *     pin 7  CHIP_EN            -> R19 10K 上拉 + SW2 按键接 GND  = 复位键
 *     pin 14 GPIO8              -> R23 10K 上拉（strapping）
 *     pin 15 GPIO9              -> R107 10K 上拉 + SW3 按键接 GND = BOOT 键（严禁设为输出）
 *     pin 19 SPIHD = GPIO12     -> 网络 G_LED -> LED5 + R114 10K -> 3.3V = 唯一可控 LED（低电平亮）
 *     pin 27 U0RXD = GPIO20     -> R20 470R -> 网络 RX0 -> CN4 pin2
 *     pin 28 U0TXD = GPIO21     -> R18 470R -> 网络 TX0 -> CN4 pin3
 *     CN4 (BM04B-GHS 4pin): 1=GND  2=RX0  3=TX0  4=VCC(需实测)
 *
 *  !! 重要 !!
 *   GPIO9 是 ESP32-C3 的 BOOT 下载模式 strapping 引脚，板上 SW3 按下即接地。
 *   若把 GPIO9 设为 OUTPUT：
 *     - 输出高电平会与按键形成对拉（可能损伤 IO 引脚）
 *     - 输出低电平时，下次复位可能误入下载模式
 *   因此本固件绝不把 GPIO9 设为输出，仅在作为可选按键时设为 INPUT_PULLUP 模式
 *
 *  依赖库（库管理器安装）:
 *    - ArduinoJson (Benoit Blanchon) v6.x  —— 必须使用 6.x，7.x API 不同
 *  开发板:
 *    - esp32 by Espressif, 2.0.4（保持不变）
 *
 *  STM32 侧帧格式（见 USER/msg_trans.md / UserFile/RcData.c）:
 *    [0]=0x20 帧头1   [1]=0x0F 帧头2
 *    [3]=ch2(Y)       [5]=ch0(X)      [6]=ch1(Z)
 *    [7]=功能位       [10]=ZL(>250断电) [11]=ZR(>250停机)
 *    [14]=0x02 校验标记
 *********************************************************/

#include <WiFi.h>
#include <WiFiUdp.h>
#include <ArduinoJson.h>
#include "driver/uart.h"

/* ==================== 用户配置 ==================== */

/* ---- WiFi ---- */
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASS "YOUR_WIFI_PASSWORD"

/* ---- 静态 IP ---- */
#define USE_STATIC_IP 1
IPAddress STATIC_IP(192, 168, 0, 9);
IPAddress STATIC_GW(192, 168, 0, 1);      /* 网关，一般 x.x.x.1 */
IPAddress STATIC_MASK(255, 255, 255, 0);
IPAddress STATIC_DNS1(192, 168, 0, 1);

/* ---- UDP ---- */
#define UDP_LISTEN_PORT 8888               /* 对应 PC 或 console */

/* ---- UART1 -> STM32（原理图：TX1=GPIO0, RX1=GPIO1）---- */
#define UART_PORT UART_NUM_1
#define UART_TX_PIN 0                      /* GPIO0 = XTAL_32K_P = 网络 TX1 */
#define UART_RX_PIN 1                      /* GPIO1 = XTAL_32K_N = 网络 RX1 */
#define UART_BAUD (115200 * 8)             /* 921600 */

/* ---- 状态 LED ----
 * !! 重要 !!
 *   本芯片为 ESP32-C3FH4（内嵌 4MB Flash，esptool 实测确认）。
 *   内嵌 Flash 版本 GPIO12~GPIO17 是内部 Flash 的 SPI 引脚，
 *   其中 GPIO12 = SPIHD。若把 GPIO12 设为输出并驱动，会破坏
 *   Flash 总线，导致 CPU 取指失败、看门狗复位死循环（无任何串口输出）。
 *   因此这里默认禁用状态 LED。若硬件 LED 确实接在 GPIO12，
 *   该接线与内嵌 Flash 冲突，需改用其它空闲 GPIO（如 GPIO2~7/10）重新飞线。
 */
#define USE_STATUS_LED 0                   /* 0 = 不驱动 GPIO12（内嵌 Flash 引脚，禁用） */
#define LED_STATUS 12
#define LED_ON LOW
#define LED_OFF HIGH

/* ---- BOOT 按键（原理图 SW3 -> GPIO9）。仅允许输入，绝不可设为输出 ---- */
#define PIN_BOOT 9
#define USE_BOOT_BUTTON 0                  /* 只有 1 才把 BOOT 当普通按键读取 */

/* ---- 摇杆映射 ---- */
#define MAX_RATE_DEG_S 300.0f              /* ±300 deg/s 对应 ±127 */

/* ---- 保活 ---- */
#define KEEPALIVE_MS 500                   /* 超过该时间无包则发中位帧 */
#define KEEPALIVE_HZ 20

/* ---- 调试串口（UART0 -> CN4 115200）---- */
#define DEBUG_SERIAL 1

/* ==================== 协议常量 ==================== */

#define FRAME_LEN 16
#define HDR0 0x20
#define HDR1 0x0F
#define CHK_BYTE 0x02

/* 空闲（中位）帧：摇杆居中、无按键 */
static const uint8_t IDLE_FRAME[FRAME_LEN] = {
  0x20, 0x0F, 0x00, 0x80, 0x00, 0x80, 0x80, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00
};

/* ==================== 全局状态 ==================== */

WiFiUDP udp;

static uint8_t txFrame[FRAME_LEN];
static uint32_t rxCount = 0;
static uint32_t txCount = 0;
static uint32_t badCount = 0;
static uint32_t lastRxMs = 0;
static uint32_t lastKaMs = 0;
static bool wifiOk = false;

/* ==================== 工具函数 ==================== */

/* 角速度(deg/s) -> 0..255 摇杆原始值（中位 128） */
static inline uint8_t rate_to_ch(float degs) {
  float n = degs / MAX_RATE_DEG_S;
  if (n > 1.0f) n = 1.0f;
  if (n < -1.0f) n = -1.0f;

  float v = n * 127.0f;
  int iv = (v >= 0.0f) ? (int)(v + 0.5f) : (int)(v - 0.5f);
  int ch = iv + 128;

  if (ch < 0) ch = 0;
  if (ch > 255) ch = 255;
  return (uint8_t)ch;
}

/* 构建 16 字节消息 */
static void build_frame(uint8_t ch0, uint8_t ch1, uint8_t ch2,
                        uint8_t btn, uint8_t zl, uint8_t zr) {
  memset(txFrame, 0, FRAME_LEN);
  txFrame[0] = HDR0;
  txFrame[1] = HDR1;
  txFrame[3] = ch2; /* data[3] = Y */
  txFrame[5] = ch0; /* data[5] = X */
  txFrame[6] = ch1; /* data[6] = Z */
  txFrame[7] = btn;
  txFrame[10] = zl ? 0xFF : 0x00;
  txFrame[11] = zr ? 0xFF : 0x00;
  txFrame[14] = CHK_BYTE;
  txFrame[15] = 0x00;
}

static void uart1_init(void) {
  uart_config_t cfg = {
    .baud_rate = UART_BAUD,
    .data_bits = UART_DATA_8_BITS,
    .parity = UART_PARITY_DISABLE,
    .stop_bits = UART_STOP_BITS_1,
    .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
    .rx_flow_ctrl_thresh = 0,
    .source_clk = UART_SCLK_APB,
  };
  uart_driver_install(UART_PORT, 256, 256, 0, NULL, 0);
  uart_param_config(UART_PORT, &cfg);
  uart_set_pin(UART_PORT, UART_TX_PIN, UART_RX_PIN,
               UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
}

/* ==================== WiFi ==================== */

static void wifi_begin(void) {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false); /* 关闭省电，降低遥控延迟抖动 */
#if USE_STATIC_IP
  WiFi.config(STATIC_IP, STATIC_GW, STATIC_MASK, STATIC_DNS1);
#endif
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

#if DEBUG_SERIAL
  Serial.print("[WiFi] connecting to ");
  Serial.println(WIFI_SSID);
#endif

  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
    delay(200);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    wifiOk = true;
    Serial.print("[WiFi] connected, ip=");
    Serial.println(WiFi.localIP());
  } else {
    wifiOk = false;
    Serial.println("[WiFi] connect timeout, will retry in loop()");
  }
}

/* 非阻塞地维护 WiFi 连接 */
static void wifi_tick(void) {
  static uint32_t lastCheck = 0;
  if (millis() - lastCheck < 1000) return;
  lastCheck = millis();

  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiOk) {
      wifiOk = true;
#if DEBUG_SERIAL
      Serial.print("[WiFi] reconnected, ip=");
      Serial.println(WiFi.localIP());
#endif
    }
  } else {
    wifiOk = false;
#if DEBUG_SERIAL
    Serial.println("[WiFi] lost, retry...");
#endif
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }
}

/* ==================== UDP 处理 ==================== */

static void send_reply(const char *json) {
  udp.beginPacket(udp.remoteIP(), udp.remotePort());
  udp.write((const uint8_t *)json, strlen(json));
  udp.endPacket();
}

static void handle_packet(uint8_t *buf, size_t len) {
  StaticJsonDocument<384> doc;
  DeserializationError err = deserializeJson(doc, buf, len);
  if (err) {
    badCount++;
#if DEBUG_SERIAL
    Serial.print("[UDP] bad json: ");
    Serial.println(err.c_str());
#endif
    return;
  }

  const char *type = doc["type"] | "rc";

  /* ---- ping / pong ---- */
  if (strcmp(type, "ping") == 0) {
    char rep[96];
    snprintf(rep, sizeof(rep),
             "{\"type\":\"pong\",\"ip\":\"%s\",\"uptime\":%lu}",
             WiFi.localIP().toString().c_str(), (unsigned long)(millis() / 1000));
    send_reply(rep);
    return;
  }

  if (strcmp(type, "rc") != 0) return;

  /* ---- 控制命令 ---- */
  uint32_t seq = doc["seq"] | 0;
  uint8_t btn = (uint8_t)(doc["btn"] | 0);
  uint8_t zl = (uint8_t)(doc["zl"] | 0);
  uint8_t zr = (uint8_t)(doc["zr"] | 0);

  uint8_t c0, c1, c2;
  bool raw = doc["raw"] | false;
  if (raw) {
    /* 调试直通：ch0/ch1/ch2 为 0..255 原始值 */
    c0 = (uint8_t)(doc["ch0"] | 128);
    c1 = (uint8_t)(doc["ch1"] | 128);
    c2 = (uint8_t)(doc["ch2"] | 128);
  } else {
    /* wx->X(ch0)  wy->Y(ch2)  wz->Z(ch1)，单位 deg/s */
    float wx = doc["wx"] | 0.0f;
    float wy = doc["wy"] | 0.0f;
    float wz = doc["wz"] | 0.0f;
    c0 = rate_to_ch(wx);
    c2 = rate_to_ch(wy);
    c1 = rate_to_ch(wz);
  }

  build_frame(c0, c1, c2, btn, zl, zr);
  uart_write_bytes(UART_PORT, txFrame, FRAME_LEN);

  rxCount++;
  txCount++;
  lastRxMs = millis();

#if DEBUG_SERIAL
  Serial.printf("[RC] seq=%lu x=%02X y=%02X z=%02X btn=%02X zl=%u zr=%u\n",
                (unsigned long)seq, c0, c2, c1, btn, zl, zr);
#endif

  /* ACK（回复给 PC 的源地址/端口） */
  char rep[80];
  snprintf(rep, sizeof(rep),
           "{\"type\":\"ack\",\"seq\":%lu,\"ok\":true}", (unsigned long)seq);
  send_reply(rep);
}

static void udp_poll(void) {
  int sz = udp.parsePacket();
  if (sz <= 0) return;

  uint8_t buf[512];
  int n = udp.read(buf, sizeof(buf) - 1);
  if (n <= 0) return;
  buf[n] = 0;

  handle_packet(buf, (size_t)n);
}

/* ==================== 保活 ==================== */

static void keepalive_tick(void) {
  /* 只有在“曾经收到过包”之后才开始保活，避免上电就狂发保活帧 */
  if (rxCount == 0) return;

  uint32_t now = millis();
  if (now - lastRxMs < KEEPALIVE_MS) return;
  if (now - lastKaMs < (1000 / KEEPALIVE_HZ)) return;

  lastKaMs = now;
  uart_write_bytes(UART_PORT, IDLE_FRAME, FRAME_LEN);
  txCount++;
}

/* ==================== 状态 LED ==================== */

static void led_tick(void) {
#if USE_STATUS_LED
  static uint32_t last = 0;
  static bool on = false;

  uint32_t now = millis();

  if (!wifiOk) {
    /* WiFi 未连接：500ms 慢闪 */
    if (now - last >= 500) {
      last = now;
      on = !on;
      digitalWrite(LED_STATUS, on ? LED_ON : LED_OFF);
    }
    return;
  }

  if (rxCount == 0) {
    /* 已连 WiFi 但还没有控制包：常亮 */
    digitalWrite(LED_STATUS, LED_ON);
    return;
  }

  if (now - lastRxMs < 1000) {
    /* 最近 1s 内有控制包：100ms 快闪，表示数据在流动 */
    if (now - last >= 100) {
      last = now;
      on = !on;
      digitalWrite(LED_STATUS, on ? LED_ON : LED_OFF);
    }
  } else {
    /* 已连 WiFi、曾有数据但当前无数据：常亮 */
    digitalWrite(LED_STATUS, LED_ON);
  }
#endif
}

/* ==================== setup / loop ==================== */

void setup(void) {
#if USE_STATUS_LED
  /* 状态 LED：GPIO12（G_LED），低电平点亮（内嵌 Flash 引脚，默认禁用） */
  pinMode(LED_STATUS, OUTPUT);
  digitalWrite(LED_STATUS, LED_OFF);
#endif

#if USE_BOOT_BUTTON
  /* BOOT 键仅作输入使用，绝不设为输出 */
  pinMode(PIN_BOOT, INPUT_PULLUP);
#endif

  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("==== Cubli ESP32C3 WiFi-RC Gateway ====");

  uart1_init();
  Serial.printf("[UART] UART%d TX(GPIO%d)=TX1 RX(GPIO%d)=RX1 baud=%d\n",
                UART_PORT, UART_TX_PIN, UART_RX_PIN, UART_BAUD);
  Serial.printf("[LED ] status LED on GPIO%d (active low)\n", LED_STATUS);

  wifi_begin();

  udp.begin(UDP_LISTEN_PORT);
  Serial.printf("[UDP] listen on %s:%d\n",
                WiFi.localIP().toString().c_str(), UDP_LISTEN_PORT);

  lastRxMs = millis();
  Serial.println("[SYS] ready");
}

void loop(void) {
  wifi_tick();
  udp_poll();
  keepalive_tick();
  led_tick();

  delay(1);
}
