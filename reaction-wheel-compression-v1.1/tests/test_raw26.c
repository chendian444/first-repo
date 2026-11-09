#include "mcu_stubs.h"
#include "Debug.h"
#include <assert.h>
#include <stdio.h>
Cube Cubli;
Imu mpu6500;
Encoder M1_Encoder,M2_Encoder,M3_Encoder;
Foc M1_Foc,M2_Foc,M3_Foc;
Remote Rc;
volatile uint8_t Tx3_Flag;
static uint8_t captured[128];
static unsigned sends;
uint32_t UART3_SendDataDMA(uint8_t *data,uint16_t length){assert(length==122);memcpy(captured,data,length);sends++;return length;}
static unsigned seq(void){return captured[8]|((unsigned)captured[9]<<8)|((unsigned)captured[10]<<16)|((unsigned)captured[11]<<24);}
int main(int argc,char **argv){
    unsigned i;float value;
    mpu6500.gyro.filter.x=1;mpu6500.gyro.filter.y=2;mpu6500.gyro.filter.z=3;
    mpu6500.gyroAngle.x=4;mpu6500.gyroAngle.y=5;
    M1_Encoder.Speed_filter=6;M2_Encoder.Speed_filter=7;M3_Encoder.Speed_filter=8;
    M1_Foc.Encoder_data=9;M2_Foc.Encoder_data=10;M3_Foc.Encoder_data=11;
    M1_Foc.Id=12;M2_Foc.Id=13;M3_Foc.Id=14;M1_Foc.Iq=15;M2_Foc.Iq=16;M3_Foc.Iq=17;
    Cubli.BatVin=18;Cubli.BatVin_filter=19;Rc.x_f=20;Rc.y_f=21;Rc.z_f=22;
    Cubli.Protect_flag=23;Cubli.AutoStandUp=24;Cubli.ManualUp=25;Cubli.Cali_flag=26;
    WheelRaw26_TicksMs=100;UsartPrint();assert(sends==0);
    Cubli.Print_flag=1;UsartPrint();assert(sends==0);
    WheelRaw26_TicksMs=109;UsartPrint();assert(sends==0);
    WheelRaw26_TicksMs=110;UsartPrint();assert(sends==1&&seq()==0);
    assert(memcmp(captured,"RWT1",4)==0&&captured[4]==1&&captured[5]==26&&captured[6]==104&&captured[7]==0);
    for(i=0;i<26;i++){memcpy(&value,captured+16+i*4,4);assert(value==(float)(i+1));}
    if(argc>1){FILE *f=fopen(argv[1],"wb");assert(f);assert(fwrite(captured,1,122,f)==122);fclose(f);}
    Tx3_Flag=1;WheelRaw26_TicksMs=120;UsartPrint();assert(sends==1);
    Tx3_Flag=0;WheelRaw26_TicksMs=130;UsartPrint();assert(sends==2&&seq()==2);
    WheelRaw26_TicksMs=330;UsartPrint();assert(sends==3&&seq()==22);
    Cubli.Print_flag=0;WheelRaw26_TicksMs=400;UsartPrint();assert(sends==3);
    puts("PASS: 26-field mapping, raw122 <= DMA128, 100Hz scheduling, busy-slot gaps and no catch-up burst");return 0;
}
