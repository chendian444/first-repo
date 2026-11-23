#ifndef WHEEL_TELEMETRY_H
#define WHEEL_TELEMETRY_H
#include <stdint.h>
/* timer.c increments this counter in its existing 1 ms TMR7 interrupt. */
extern volatile uint32_t WheelTelemetry_TicksMs;
/* app.c already calls this poll function; do not add a second transmitter. */
void WheelTelemetry_Poll(void);
/* Compatibility with the existing UART3 ISR; no commands are executed here. */
void WheelTelemetry_HandleRx(const uint8_t *bytes, uint16_t length);
#endif
