//***************************************************************************************
// 请勿改动本文件
// 请勿改动本文件
// 请勿改动本文件

// M1_Foc.Cali_flag = 0 电机停止
// M1_Foc.Cali_flag = 1 电机正常闭环并执行M1_Control()函数
// M1_Foc.Cali_flag = 2 电角度校准，2秒后M1_Foc.Cali_Status = 1，M1_Foc.Cali_flag = 1;
// M1_Foc.Cali_flag = 3 电机开环旋转（强拖旋转）M1_Foc.Cali_Status = 3;
// M2电机同上

//***************************************************************************************

#ifndef _AT32F403A_FOC_LIB_H_
#define _AT32F403A_FOC_LIB_H_

#include "at32f403a_407.h"
#include "math.h"

typedef struct 
{
	uint16_t ThetaOffset;
	uint16_t Cali_flag;
	uint16_t Cali_Status;
	
	uint16_t Encoder_data;
	float Angle;
	
	float SinValue;
	float CosValue;
	
	float Vd;
  float Vq;

  float Valpha;
  float Vbeta;

  float Ia;
  float Ib;
  float Ic;

  float Ialpha;
  float Ibeta;

  float Id;
  float Iq;
	
	float theta;
	
	int8_t temp;
}FocData_t;

extern FocData_t M1_Foc;
extern FocData_t M2_Foc;
extern FocData_t M3_Foc;

extern uint8_t Cubli_Cali_Status,Music_flag;
extern uint16_t Music_Ld;

void adaptive(float *adaptive_out,float speed_input,float speed_set,float limit);
	
void M1_Control(void); //需要自己写C函数
void M2_Control(void); //需要自己写C函数
void M3_Control(void); //需要自己写C函数

void edge_auto_up(void);
void dot1_auto_up(void);
void dot3_auto_up(void);

void M1_FOC_handle(uint16_t EncoderValue);
void M2_FOC_handle(uint16_t EncoderValue);
void M3_FOC_handle(uint16_t EncoderValue);

	
#endif
