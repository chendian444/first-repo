#include "app.h"
#include "WheelTelemetry.h"

volatile uint32_t WheelTelemetry_TicksMs = 0;
/* One aligned 32-bit access gives main/IRQ an atomic configuration snapshot. */
static volatile uint32_t settings = WHEEL_MODE_AUTO | (10u << 8);
static uint8_t command[8];
static uint8_t command_length = 0;

void WheelTelemetry_HandleRx(const uint8_t *bytes, uint16_t length)
{
    uint16_t i, period, crc;
    for (i = 0; i < length; ++i) {
        if (command_length == sizeof(command)) {
            memmove(command, command + 1, sizeof(command) - 1);
            --command_length;
        }
        command[command_length++] = bytes[i];
        if (command_length != sizeof(command)) continue;
        if (command[0] != 'C' || command[1] != 'W' || command[2] != 1 ||
            command[3] > WHEEL_MODE_AUTO) continue;
        period = (uint16_t)(command[4] | ((uint16_t)command[5] << 8));
        crc = (uint16_t)(command[6] | ((uint16_t)command[7] << 8));
        if (period >= 10 && period <= 1000 && Wheel_Crc16(command, 6) == crc)
            settings = command[3] | ((uint32_t)period << 8);
    }
}

void WheelTelemetry_Poll(void)
{
    static uint32_t last_ms = 0, sequence = 0;
    static uint8_t was_enabled = 0;
    uint32_t now = WheelTelemetry_TicksMs, cfg = settings, steps;
    uint16_t period = (uint16_t)(cfg >> 8);
    float samples[16];
    uint8_t frame[WHEEL_MAX_FRAME];
    size_t length;
    if (!Cubli.Print_flag) { was_enabled = 0; return; }
    if (!was_enabled) { last_ms = now; was_enabled = 1; return; }
    if ((uint32_t)(now - last_ms) < period) return;
    steps = (uint32_t)(now - last_ms) / period;
    last_ms += steps * period;
    sequence += steps;
    /* Skip busy DMA slots; sequence gaps remain visible to the receiver. */
    if (Tx3_Flag) return;
    samples[0] = mpu6500.gyro.filter.x;
    samples[1] = mpu6500.gyro.filter.y;
    samples[2] = mpu6500.gyro.filter.z;
    samples[3] = mpu6500.gyroAngle.x;
    samples[4] = mpu6500.gyroAngle.y;
    samples[5] = mpu6500.gyroAngle.z;
    samples[6] = M1_Encoder.Speed_filter;
    samples[7] = M2_Encoder.Speed_filter;
    samples[8] = M3_Encoder.Speed_filter;
    samples[9] = M1_Foc.Iq;
    samples[10] = M2_Foc.Iq;
    samples[11] = M3_Foc.Iq;
    samples[12] = Cubli.BatVin;
    samples[13] = (float)Cubli.Protect_flag;
    samples[14] = Rc.x_f;
    samples[15] = Rc.y_f;
    length = Wheel_Encode((const uint8_t *)samples, sequence - 1u, now,
                          (uint8_t)(cfg & 0xffu), period, frame, sizeof(frame));
    if (length) UART3_SendDataDMA(frame, (uint16_t)length);
}
