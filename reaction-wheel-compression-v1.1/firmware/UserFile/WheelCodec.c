#include "WheelCodec.h"
#include <string.h>

static void put16(uint8_t *p, uint16_t v)
{ p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); }
static void put32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8);
    p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24);
}

uint16_t Wheel_Crc16(const uint8_t *data, size_t len)
{
    uint16_t crc = 0xffffu;
    size_t i;
    unsigned b;
    for (i = 0; i < len; ++i) {
        crc ^= (uint16_t)((uint16_t)data[i] << 8);
        for (b = 0; b < 8; ++b)
            crc = (uint16_t)((crc & 0x8000u) ?
                  ((uint32_t)crc << 1) ^ 0x1021u : (uint32_t)crc << 1);
    }
    return crc;
}

size_t Wheel_Encode(const uint8_t raw[WHEEL_RAW_BYTES], uint32_t sequence,
                    uint32_t ticks_ms, uint8_t mode, uint16_t period_ms,
                    uint8_t *out, size_t capacity)
{
    uint8_t packed[WHEEL_RAW_BYTES + 1u];
    size_t i = 0, n = 0, start, count, payload;
    uint8_t codec = 0;
    if (!raw || !out || capacity < WHEEL_MAX_FRAME || mode > WHEEL_MODE_AUTO ||
        period_ms < 10 || period_ms > 1000) return 0;
    if (mode == WHEEL_MODE_AUTO) {
        while (i < WHEEL_RAW_BYTES) {
            start = i;
            if (raw[i] == 0) {
                while (i < WHEEL_RAW_BYTES && raw[i] == 0) ++i;
                packed[n++] = (uint8_t)(0x80u | (i - start - 1u));
            } else {
                while (i < WHEEL_RAW_BYTES && raw[i] != 0) ++i;
                count = i - start;
                /* Stop before exceeding the scratch buffer: RAW will win. */
                if (n + 1u + count >= WHEEL_RAW_BYTES) { n = WHEEL_RAW_BYTES; break; }
                packed[n++] = (uint8_t)(count - 1u);
                memcpy(packed + n, raw + start, count); n += count;
            }
            if (n >= WHEEL_RAW_BYTES) break;
        }
        if (n < WHEEL_RAW_BYTES) codec = 1;
    }
    payload = codec ? n : WHEEL_RAW_BYTES;
    memcpy(out, "DCW1", 4);
    out[4] = codec; out[5] = 16;
    put16(out + 6, (uint16_t)payload);
    put32(out + 8, sequence); put32(out + 12, ticks_ms);
    out[16] = mode; put16(out + 17, period_ms); out[19] = 0;
    memcpy(out + WHEEL_HEADER_BYTES, codec ? packed : raw, payload);
    put16(out + WHEEL_HEADER_BYTES + payload,
          Wheel_Crc16(out, WHEEL_HEADER_BYTES + payload));
    return WHEEL_HEADER_BYTES + payload + 2u;
}
