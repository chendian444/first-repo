#include "mcu_stubs.h"
#include "WheelTelemetry.h"
#include <assert.h>
#include <stdio.h>
Cube Cubli;
Imu mpu6500;
Encoder M1_Encoder,M2_Encoder,M3_Encoder;
Foc M1_Foc,M2_Foc,M3_Foc;
Remote Rc;
volatile uint8_t Tx3_Flag;
static uint8_t captured[86];
static unsigned sends;
uint32_t UART3_SendDataDMA(uint8_t *data,uint16_t length)
{
    assert(length <= sizeof(captured));
    memcpy(captured,data,length); ++sends; return length;
}
static unsigned seq(void) {
    return captured[8] | ((unsigned)captured[9]<<8) | ((unsigned)captured[10]<<16) | ((unsigned)captured[11]<<24);
}
int main(void)
{
    uint8_t command[8]={'C','W',1,0,50,0,0,0};
    uint16_t crc;
    WheelTelemetry_TicksMs=100; WheelTelemetry_Poll(); assert(sends==0);
    Cubli.Print_flag=1; WheelTelemetry_Poll(); assert(sends==0);
    WheelTelemetry_TicksMs=109; WheelTelemetry_Poll(); assert(sends==0);
    WheelTelemetry_TicksMs=110; WheelTelemetry_Poll(); assert(sends==1 && seq()==0 && captured[4]==1);
    Tx3_Flag=1; WheelTelemetry_TicksMs=120; WheelTelemetry_Poll(); assert(sends==1);
    Tx3_Flag=0; WheelTelemetry_TicksMs=130; WheelTelemetry_Poll(); assert(sends==2 && seq()==2);
    crc=Wheel_Crc16(command,6); command[6]=(uint8_t)crc; command[7]=(uint8_t)(crc>>8);
    WheelTelemetry_HandleRx(command,3); WheelTelemetry_HandleRx(command+3,5);
    WheelTelemetry_TicksMs=179; WheelTelemetry_Poll(); assert(sends==2);
    WheelTelemetry_TicksMs=180; WheelTelemetry_Poll(); assert(sends==3 && captured[4]==0 && captured[16]==0 && captured[17]==50);
    command[3]=1; /* Bad CRC must not change mode. */
    WheelTelemetry_HandleRx(command,8);
    WheelTelemetry_TicksMs=230; WheelTelemetry_Poll(); assert(sends==4 && captured[16]==0);
    WheelTelemetry_TicksMs=430; WheelTelemetry_Poll(); assert(sends==5 && seq()==8); /* No catch-up burst. */
    Cubli.Print_flag=0; WheelTelemetry_TicksMs=480; WheelTelemetry_Poll(); assert(sends==5);
    puts("MCU telemetry scheduling, busy DMA, fragmented config and CRC rejection: PASS");
    return 0;
}
