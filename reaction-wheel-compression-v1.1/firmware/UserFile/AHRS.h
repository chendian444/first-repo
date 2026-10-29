#ifndef __AHRS_H
#define __AHRS_H
#include "app.h" 

#define A2R  0.017453292519943f
#define R2A 57.295779513082320f
#define Motor_Install_Angle 29.99428144f //3个电机之间的角度
#define Cubli_Dot_Angle     35.26438968f //单点与地面之间的角度 

typedef struct
{
	float x;
	float y;
	float z;
	float t;
}float_3f;

typedef struct
{
	int16_t x;
	int16_t y;
	int16_t z;
}int16_3i;

typedef struct{    
  float_3f offset;    //陀螺角速度静止偏差值
	float_3f filter;    //滤波值  
	int16_3i Initial;   //初始值
	int16_3i data;      //原始数据
	float_3f Primitive; //原始值
}trans_t;


typedef struct
{
	float edge_cos;
	float edge_sin;
	float speed_cos;
	float speed_sin;
}axis_t;

typedef struct
{
	trans_t gyro;
	trans_t acc;
	float_3f gyroAngle;
	float_3f accAngle;
	int16_t TempData;
	float temp;
	int8_t gyro_temp;
	float LastTime;
	float tempRate;
	float tempRateFilter;
	
	float gyro_x;
	float gyro_y;
	float gyro_z;
	uint16_t Cali_Flag; 
	uint8_t Offset_Flag;
}mpu6500_t;

extern axis_t axis;

extern u8 IMU_Initial;
extern mpu6500_t mpu6500;
extern mpu6500_t sensor;
void IMU_handle(void);

#endif
