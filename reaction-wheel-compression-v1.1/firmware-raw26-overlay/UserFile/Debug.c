/* Raw telemetry only. No compression, motor command or control-law change. */
#include "app.h"
#include "Debug.h"
#include <stdint.h>
#include <string.h>

Print_data_t Print_data; /* Retained symbol for compatibility with the original project. */
volatile uint32_t WheelRaw26_TicksMs = 0;
#define RAW26_PERIOD_MS 10u
#define RAW26_BYTES 122u

static void raw26_put16(uint8_t *p, uint16_t v)
{ p[0]=(uint8_t)v; p[1]=(uint8_t)(v>>8); }
static void raw26_put32(uint8_t *p, uint32_t v)
{ p[0]=(uint8_t)v; p[1]=(uint8_t)(v>>8); p[2]=(uint8_t)(v>>16); p[3]=(uint8_t)(v>>24); }
static uint16_t raw26_crc(const uint8_t *data, uint16_t length)
{
    uint16_t crc=0xffffu,i;
    unsigned bit;
    for(i=0;i<length;i++) {
        crc^=(uint16_t)((uint16_t)data[i]<<8);
        for(bit=0;bit<8;bit++)crc=(uint16_t)((crc&0x8000u)?((uint32_t)crc<<1)^0x1021u:(uint32_t)crc<<1);
    }
    return crc;
}

void UsartPrint(void)
{
    static uint32_t last_ms=0,sequence=0;
    static uint8_t enabled=0;
    uint32_t now=WheelRaw26_TicksMs,steps;
    float samples[26];
    uint8_t frame[RAW26_BYTES];
    if(!Cubli.Print_flag){enabled=0;return;}
    if(!enabled){last_ms=now;enabled=1;return;}
    if((uint32_t)(now-last_ms)<RAW26_PERIOD_MS)return;
    steps=(uint32_t)(now-last_ms)/RAW26_PERIOD_MS;
    last_ms+=steps*RAW26_PERIOD_MS;sequence+=steps;
    if(Tx3_Flag)return; /* Busy slots stay visible as sequence gaps. */
    samples[0]=mpu6500.gyro.filter.x;
    samples[1]=mpu6500.gyro.filter.y;
    samples[2]=mpu6500.gyro.filter.z;
    samples[3]=mpu6500.gyroAngle.x;
    samples[4]=mpu6500.gyroAngle.y;
    samples[5]=M1_Encoder.Speed_filter;
    samples[6]=M2_Encoder.Speed_filter;
    samples[7]=M3_Encoder.Speed_filter;
    samples[8]=(float)M1_Foc.Encoder_data;
    samples[9]=(float)M2_Foc.Encoder_data;
    samples[10]=(float)M3_Foc.Encoder_data;
    samples[11]=M1_Foc.Id;
    samples[12]=M2_Foc.Id;
    samples[13]=M3_Foc.Id;
    samples[14]=M1_Foc.Iq;
    samples[15]=M2_Foc.Iq;
    samples[16]=M3_Foc.Iq;
    samples[17]=Cubli.BatVin;
    samples[18]=Cubli.BatVin_filter;
    samples[19]=Rc.x_f;
    samples[20]=Rc.y_f;
    samples[21]=Rc.z_f;
    samples[22]=(float)Cubli.Protect_flag;
    samples[23]=(float)Cubli.AutoStandUp;
    samples[24]=(float)Cubli.ManualUp;
    samples[25]=(float)Cubli.Cali_flag;
    memcpy(frame,"RWT1",4);frame[4]=1;frame[5]=26;
    raw26_put16(frame+6,104);
    raw26_put32(frame+8,sequence-1u);raw26_put32(frame+12,now);
    memcpy(frame+16,samples,104);
    raw26_put16(frame+120,raw26_crc(frame,120));
    UART3_SendDataDMA(frame,RAW26_BYTES);
}
