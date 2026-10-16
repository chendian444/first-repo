#ifndef WHEEL_CODEC_H
#define WHEEL_CODEC_H
#include <stdint.h>
#include <stddef.h>

#define WHEEL_RAW_BYTES 64u
#define WHEEL_HEADER_BYTES 20u
#define WHEEL_MAX_FRAME 86u
#define WHEEL_MODE_RAW 0u
#define WHEEL_MODE_AUTO 1u

uint16_t Wheel_Crc16(const uint8_t *data, size_t len);
/* Raw is exactly 16 IEEE754 float32 values in little endian order.
 * Independent frames: no earlier frame is needed for decompression. */
size_t Wheel_Encode(const uint8_t raw[WHEEL_RAW_BYTES], uint32_t sequence,
                    uint32_t ticks_ms, uint8_t mode, uint16_t period_ms,
                    uint8_t *out, size_t capacity);
#endif
