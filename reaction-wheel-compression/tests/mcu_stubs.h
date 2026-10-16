#ifndef WHEEL_MCU_STUBS_H
#define WHEEL_MCU_STUBS_H
#include <stdint.h>
#include <string.h>
#include <stddef.h>
typedef struct { float x,y,z; } Vector;
typedef struct { struct { Vector filter; } gyro; Vector gyroAngle; } Imu;
typedef struct { uint8_t Print_flag, Protect_flag; float BatVin; } Cube;
typedef struct { float Speed_filter; } Encoder;
typedef struct { float Iq; } Foc;
typedef struct { float x_f,y_f; } Remote;
extern Cube Cubli;
extern Imu mpu6500;
extern Encoder M1_Encoder,M2_Encoder,M3_Encoder;
extern Foc M1_Foc,M2_Foc,M3_Foc;
extern Remote Rc;
extern volatile uint8_t Tx3_Flag;
uint32_t UART3_SendDataDMA(uint8_t *data,uint16_t length);
#endif
