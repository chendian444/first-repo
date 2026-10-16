#ifndef __Control_H
#define __Control_H
#include "app.h" 

union sFaultBitTypeDef
{
	struct{     
		uint8_t IMU:1;   
		uint8_t rev0:1;    
		uint8_t rev1:1;     
		uint8_t rev2:1;     
	  
		uint8_t M1_Encoder:1;         
		uint8_t M2_Encoder:1;      
		uint8_t M1_Current:1;   
		uint8_t M2_Current:1;
		
		uint8_t rev3;                // ‘§¡Ù
		uint8_t rev4;                // ‘§¡Ù
		uint8_t rev5;                // ‘§¡Ù
		uint8_t rev6;                // ‘§¡Ù
		
		uint8_t rev7;                // ‘§¡Ù
		uint8_t rev8;                // ‘§¡Ù
		uint8_t rev9;                // ‘§¡Ù
		uint8_t rev10;               // ‘§¡Ù
	}bit;
	uint16_t all;
};

extern volatile union sFaultBitTypeDef FaultBit;

typedef struct _PIDFloat_Obj_
{ 
	volatile float Kp;
  volatile float Ki;
  volatile float Kd;
	
	volatile float Ki_Out;
	
	volatile float Kp_Min;
  volatile float Kp_Max;

	volatile float Ki_Min;
  volatile float Ki_Max;
	
	volatile float Kd_Min;
  volatile float Kd_Max;
	
  volatile float outMin;
  volatile float outMax;
 
	volatile float PID_Out;
} PID_Structure;

typedef struct
{
	uint16_t data;
	uint16_t  Spd_Offset_Flag;
	uint16_t  rev;
	uint16_t UpData;	
	int32_t  DiffeData;	
	float angle;
	float X_Speed;
	float Y_Speed;
	float Z_Speed;
	float Speed;
	float Speed_filter;
	float Speed_filterA;
}Encoder_t;

typedef struct
{
	float BatVin;
	float BatVin_filter;
	float ControlZ;
	uint16_t M1_M2_Cnt;
	uint8_t Cali_flag;
	uint8_t Cali_mode;
	uint8_t Protect_flag;
	uint8_t Mode;
	uint8_t Protect;
	uint8_t ProtectCnt;
	uint8_t Power_flag;
	uint8_t AutoStandUp;
	uint8_t ManualUp;
	uint8_t Print_flag;
	float data[2];
	float Mechanical_Median[3];
}Cubli_t;

extern Cubli_t Cubli;
extern PID_Structure GyroAnglePID_X;
extern PID_Structure GyroAnglePID_Y;
extern PID_Structure GyroAnglePID_Z;
extern PID_Structure X_SpeedPID;
extern PID_Structure Y_SpeedPID;
extern PID_Structure Z_SpeedPID;

extern PID_Structure M1SpeedPID;
extern PID_Structure M2SpeedPID;
extern PID_Structure M3SpeedPID;

extern PID_Structure M1CurrentIdPID;
extern PID_Structure M1CurrentIqPID;

extern PID_Structure M2CurrentIdPID;
extern PID_Structure M2CurrentIqPID;

extern PID_Structure M3CurrentIdPID;
extern PID_Structure M3CurrentIqPID;

extern Cubli_t Cubli;

extern Encoder_t M1_Encoder;
extern Encoder_t M2_Encoder;
extern Encoder_t M3_Encoder;

extern float gyroAngle_x,gyroAngle_y,gyroAngle_z,gyroAngle_t;

extern float CarSpeed;
extern float ControlOut_M1,ControlOut_M2,ControlOut_M3;
extern u8 dot_auto_up_flag,dot1_auto_flag,dot3_auto_flag;
extern u16 dot_auto_up_cnt;
extern u8 edge_auto_flag;
extern float adaptive_x,adaptive_y;
extern u16 CubeSpeedCnt;

void parameters_Init(void);

float PID_Adjust_T(PID_Structure* handle,float Given,float Feedback,float Gyro);

float PID_Adjust(PID_Structure* handle,float Given,float Feedback);

void M1SpeedControl(float speed);
void M2SpeedControl(float speed);
void M3SpeedControl(float speed);

void M1Voltage_ClosedLoop(float voltage);
void M2Voltage_ClosedLoop(float voltage);
void M3Voltage_ClosedLoop(float voltage);

void M1Current_ClosedLoop(float Current); // µÁ¡˜ª∑
void M2Current_ClosedLoop(float Current); // µÁ¡˜ª∑
void M3Current_ClosedLoop(float Current); // µÁ¡˜ª∑

void edge_auto_up(void);
void dot1_auto_up(void);
void dot3_auto_up(void);
void reset_pid(void);
void Stop_data(void);

void edge_balance(void);
void dot_balance(void);
void SpeedControl(void);
void AngleControl(void);
void SpeedCompute(Encoder_t* Speed, uint16_t Encoder_data);
#endif
