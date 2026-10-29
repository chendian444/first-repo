#ifndef WHEEL_TELEMETRY_H
#define WHEEL_TELEMETRY_H
#include <stdint.h>
#include "WheelCodec.h"
extern volatile uint32_t WheelTelemetry_TicksMs;
void WheelTelemetry_Poll(void);
/* Called with received UART3 bytes; accepts only CW1 telemetry settings. */
void WheelTelemetry_HandleRx(const uint8_t *bytes, uint16_t length);
#endif
