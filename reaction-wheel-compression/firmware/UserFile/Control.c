
#include "app.h"

PID_Structure GyroAnglePID_X;
PID_Structure GyroAnglePID_Y;
PID_Structure GyroAnglePID_Z;
PID_Structure X_SpeedPID;
PID_Structure Y_SpeedPID;
PID_Structure Z_SpeedPID;

PID_Structure M1SpeedPID;
PID_Structure M2SpeedPID;
PID_Structure M3SpeedPID;

PID_Structure M1CurrentIdPID;
PID_Structure M1CurrentIqPID;

PID_Structure M2CurrentIdPID;
PID_Structure M2CurrentIqPID;

PID_Structure M3CurrentIdPID;
PID_Structure M3CurrentIqPID;

Encoder_t Encoder;
Encoder_t M1_Encoder;
Encoder_t M2_Encoder;
Encoder_t M3_Encoder;

Cubli_t Cubli;

volatile union sFaultBitTypeDef FaultBit;


#define CurrentLimit  10.0f // 电流限制

#define IqId 0.8f // 最大为1.0

#define GyroAngleLimit 0.8f 
#define GyroAngleLimit_Z 0.5f 
#define SpeedLimit   15.0f 

void parameters_Init(void) //
{
/*************************************************************/		
	X_SpeedPID.Kp = 0.0005f; // 单边 0.0005f; 
	X_SpeedPID.Ki = 0.0f; 
	X_SpeedPID.Kd = 0.0f;
	
	X_SpeedPID.Ki_Out = 0.0f;
	
	X_SpeedPID.Kp_Min = -SpeedLimit;
	X_SpeedPID.Kp_Max =  SpeedLimit;
	
	X_SpeedPID.Kd_Min = -SpeedLimit;
	X_SpeedPID.Kd_Max =  SpeedLimit;
	
	X_SpeedPID.Ki_Min = -SpeedLimit;
	X_SpeedPID.Ki_Max =  SpeedLimit;
	
	X_SpeedPID.outMin = -SpeedLimit;
	X_SpeedPID.outMax =  SpeedLimit;
	
	X_SpeedPID.PID_Out = 0.0f;
/*************************************************************/	

/*************************************************************/		
	Y_SpeedPID.Kp = 0.0005f; 
	Y_SpeedPID.Ki = 0.0f; 
	Y_SpeedPID.Kd = 0.0f;
	
	Y_SpeedPID.Ki_Out = 0.0f;
	
	Y_SpeedPID.Kp_Min = -SpeedLimit;
	Y_SpeedPID.Kp_Max =  SpeedLimit;
	
	Y_SpeedPID.Kd_Min = -SpeedLimit;
	Y_SpeedPID.Kd_Max =  SpeedLimit;
	
	Y_SpeedPID.Ki_Min = -SpeedLimit;
	Y_SpeedPID.Ki_Max =  SpeedLimit;
	
	Y_SpeedPID.outMin = -SpeedLimit;
	Y_SpeedPID.outMax =  SpeedLimit;
	
	Y_SpeedPID.PID_Out = 0.0f;
/*************************************************************/

/*************************************************************/		
	Z_SpeedPID.Kp = 0.0005f; 
	Z_SpeedPID.Ki = 0.0f; 
	Z_SpeedPID.Kd = 0.0f;
	
	Z_SpeedPID.Ki_Out = 0.0f;
	
	Z_SpeedPID.Kp_Min = -SpeedLimit;
	Z_SpeedPID.Kp_Max =  SpeedLimit;
	
	Z_SpeedPID.Kd_Min = -SpeedLimit;
	Z_SpeedPID.Kd_Max =  SpeedLimit;
	
	Z_SpeedPID.Ki_Min = -SpeedLimit;
	Z_SpeedPID.Ki_Max =  SpeedLimit;
	
	Z_SpeedPID.outMin = -SpeedLimit;
	Z_SpeedPID.outMax =  SpeedLimit;
	
	Z_SpeedPID.PID_Out = 0.0f;
/*************************************************************/

/*************************************************************/		
	GyroAnglePID_X.Kp = 0.15f;//单边0.15  
	GyroAnglePID_X.Ki = 0.0f;   
	GyroAnglePID_X.Kd = 0.01f; //单边0.01 
	
	GyroAnglePID_X.Ki_Out = 0.0f;
	
	GyroAnglePID_X.Kp_Min = -GyroAngleLimit;
	GyroAnglePID_X.Kp_Max =  GyroAngleLimit;
	
	GyroAnglePID_X.Kd_Min = -GyroAngleLimit;
	GyroAnglePID_X.Kd_Max =  GyroAngleLimit;
	
	GyroAnglePID_X.Ki_Min = -GyroAngleLimit;
	GyroAnglePID_X.Ki_Max =  GyroAngleLimit;
	
	GyroAnglePID_X.outMin = -GyroAngleLimit;
	GyroAnglePID_X.outMax =  GyroAngleLimit;
	
	GyroAnglePID_X.PID_Out = 0.0f;
/*************************************************************/	

/*************************************************************/		
	GyroAnglePID_Y.Kp = 0.15f;//单边0.15  
	GyroAnglePID_Y.Ki = 0.0f;   
	GyroAnglePID_Y.Kd = 0.01f; //单边0.01  
	
	GyroAnglePID_Y.Ki_Out = 0.0f;
	
	GyroAnglePID_Y.Kp_Min = -GyroAngleLimit;
	GyroAnglePID_Y.Kp_Max =  GyroAngleLimit;
	
	GyroAnglePID_Y.Kd_Min = -GyroAngleLimit;
	GyroAnglePID_Y.Kd_Max =  GyroAngleLimit;
	
	GyroAnglePID_Y.Ki_Min = -GyroAngleLimit;
	GyroAnglePID_Y.Ki_Max =  GyroAngleLimit;
	
	GyroAnglePID_Y.outMin = -GyroAngleLimit;
	GyroAnglePID_Y.outMax =  GyroAngleLimit;
	
	GyroAnglePID_Y.PID_Out = 0.0f;
/*************************************************************/	

/*************************************************************/		
	GyroAnglePID_Z.Kp = 0.0025f;//0015f
	GyroAnglePID_Z.Ki = 0.0f;   
	GyroAnglePID_Z.Kd = 0.005f; //200  
	
	GyroAnglePID_Z.Ki_Out = 0.0f;
	
	GyroAnglePID_Z.Kp_Min = -GyroAngleLimit_Z;
	GyroAnglePID_Z.Kp_Max =  GyroAngleLimit_Z;
	
	GyroAnglePID_Z.Kd_Min = -GyroAngleLimit_Z;
	GyroAnglePID_Z.Kd_Max =  GyroAngleLimit_Z;
	
	GyroAnglePID_Z.Ki_Min = -GyroAngleLimit_Z;
	GyroAnglePID_Z.Ki_Max =  GyroAngleLimit_Z;
	
	GyroAnglePID_Z.outMin = -GyroAngleLimit_Z;
	GyroAnglePID_Z.outMax =  GyroAngleLimit_Z;
	
	GyroAnglePID_Z.PID_Out = 0.0f;
/*************************************************************/	

/*************************************************************/	
	M1SpeedPID.Kp = 0.01f; 
	M1SpeedPID.Ki = M1SpeedPID.Kp / 250.0f; 
	M1SpeedPID.Kd = 0.0f;
	
	M1SpeedPID.Ki_Out = 0.0f;
	
	M1SpeedPID.Kp_Min = -CurrentLimit;
	M1SpeedPID.Kp_Max =  CurrentLimit;
	
	M1SpeedPID.Kd_Min = -CurrentLimit;
	M1SpeedPID.Kd_Max =  CurrentLimit;
	
	M1SpeedPID.Ki_Min = -CurrentLimit;
	M1SpeedPID.Ki_Max =  CurrentLimit;
	
	M1SpeedPID.outMin = -CurrentLimit;
	M1SpeedPID.outMax =  CurrentLimit;
	
	M1SpeedPID.PID_Out = 0.0f;
/*************************************************************/		
	M2SpeedPID.Kp = 0.01f; 
	M2SpeedPID.Ki = M2SpeedPID.Kp / 250.0f; // 250
	M2SpeedPID.Kd = 0.0f;
	
	M2SpeedPID.Ki_Out = 0.0f;
	
	M2SpeedPID.Kp_Min = -CurrentLimit;
	M2SpeedPID.Kp_Max =  CurrentLimit;
	
	M2SpeedPID.Kd_Min = -CurrentLimit;
	M2SpeedPID.Kd_Max =  CurrentLimit;
	
	M2SpeedPID.Ki_Min = -CurrentLimit; 
	M2SpeedPID.Ki_Max =  CurrentLimit;
	
	M2SpeedPID.outMin = -CurrentLimit;
	M2SpeedPID.outMax =  CurrentLimit;
	
	M2SpeedPID.PID_Out = 0.0f;
/*************************************************************/		
	M3SpeedPID.Kp = 0.01f; 
	M3SpeedPID.Ki = M3SpeedPID.Kp / 250.0f; 
	M3SpeedPID.Kd = 0.0f;
	
	M3SpeedPID.Ki_Out = 0.0f;
	
	M3SpeedPID.Kp_Min = -CurrentLimit;
	M3SpeedPID.Kp_Max =  CurrentLimit;
	
	M3SpeedPID.Kd_Min = -CurrentLimit;
	M3SpeedPID.Kd_Max =  CurrentLimit;
	
	M3SpeedPID.Ki_Min = -CurrentLimit; 
	M3SpeedPID.Ki_Max =  CurrentLimit;
	
	M3SpeedPID.outMin = -CurrentLimit;
	M3SpeedPID.outMax =  CurrentLimit;
	
	M3SpeedPID.PID_Out = 0.0f;
/*************************************************************/	

/*************************************************************/		
	M1CurrentIdPID.Kp = 0.005f; 
	M1CurrentIdPID.Ki = M1CurrentIdPID.Kp / 10.0f;
	M1CurrentIdPID.Kd = 0.0f;
	
	M1CurrentIdPID.Ki_Out = 0.0f; 
	
	M1CurrentIdPID.Kp_Min = -IqId/2.0f;
	M1CurrentIdPID.Kp_Max =  IqId/2.0f;
	
	M1CurrentIdPID.Kd_Min = -IqId/2.0f;
	M1CurrentIdPID.Kd_Max =  IqId/2.0f;
	
	M1CurrentIdPID.Ki_Min = -IqId/2.0f; 
	M1CurrentIdPID.Ki_Max =  IqId/2.0f;
	
	M1CurrentIdPID.outMin = -IqId/2.0f;
	M1CurrentIdPID.outMax =  IqId/2.0f;
	
	M1CurrentIdPID.PID_Out = 0.0f;
/*************************************************************/		
	M1CurrentIqPID.Kp = 0.01f; 
	M1CurrentIqPID.Ki = M1CurrentIqPID.Kp / 10.0f;
	M1CurrentIqPID.Kd = 0.0f;
	
	M1CurrentIqPID.Ki_Out = 0.0f; 
	
	M1CurrentIqPID.Kp_Min = -IqId;
	M1CurrentIqPID.Kp_Max =  IqId;
	
	M1CurrentIqPID.Kd_Min = -IqId;
	M1CurrentIqPID.Kd_Max =  IqId;
	
	M1CurrentIqPID.Ki_Min = -IqId; 
	M1CurrentIqPID.Ki_Max =  IqId;
	
	M1CurrentIqPID.outMin = -IqId;
	M1CurrentIqPID.outMax =  IqId;
	
	M1CurrentIqPID.PID_Out = 0.0f;
/*************************************************************/		

/*************************************************************/		
	M2CurrentIdPID.Kp = 0.005f; 
	M2CurrentIdPID.Ki = M2CurrentIdPID.Kp / 10.0f;
	M2CurrentIdPID.Kd = 0.0f;
	
	M2CurrentIdPID.Ki_Out = 0.0f; 
	
	M2CurrentIdPID.Kp_Min = -IqId/2.0f;
	M2CurrentIdPID.Kp_Max =  IqId/2.0f;
	
	M2CurrentIdPID.Kd_Min = -IqId/2.0f;
	M2CurrentIdPID.Kd_Max =  IqId/2.0f;
	
	M2CurrentIdPID.Ki_Min = -IqId/2.0f; 
	M2CurrentIdPID.Ki_Max =  IqId/2.0f;
	
	M2CurrentIdPID.outMin = -IqId/2.0f;
	M2CurrentIdPID.outMax =  IqId/2.0f;
	
	M2CurrentIdPID.PID_Out = 0.0f;
/*************************************************************/		
	M2CurrentIqPID.Kp = 0.01f; 
	M2CurrentIqPID.Ki = M2CurrentIqPID.Kp / 10.0f;
	M2CurrentIqPID.Kd = 0.0f;
	
	M2CurrentIqPID.Ki_Out = 0.0f;
	
	M2CurrentIqPID.Kp_Min = -IqId;
	M2CurrentIqPID.Kp_Max =  IqId;
	
	M2CurrentIqPID.Kd_Min = -IqId;
	M2CurrentIqPID.Kd_Max =  IqId;
	
	M2CurrentIqPID.Ki_Min = -IqId;
	M2CurrentIqPID.Ki_Max =  IqId;
	
	M2CurrentIqPID.outMin = -IqId;
	M2CurrentIqPID.outMax =  IqId;
	
	M2CurrentIqPID.PID_Out = 0.0f;
/*************************************************************/	

/*************************************************************/		
	M3CurrentIdPID.Kp = 0.005f; 
	M3CurrentIdPID.Ki = M3CurrentIdPID.Kp / 10.0f;
	M3CurrentIdPID.Kd = 0.0f;
	
	M3CurrentIdPID.Ki_Out = 0.0f; 
	
	M3CurrentIdPID.Kp_Min = -IqId/2.0f;
	M3CurrentIdPID.Kp_Max =  IqId/2.0f;
	
	M3CurrentIdPID.Kd_Min = -IqId/2.0f;
	M3CurrentIdPID.Kd_Max =  IqId/2.0f;
	
	M3CurrentIdPID.Ki_Min = -IqId/2.0f; 
	M3CurrentIdPID.Ki_Max =  IqId/2.0f;
	
	M3CurrentIdPID.outMin = -IqId/2.0f;
	M3CurrentIdPID.outMax =  IqId/2.0f;
	
	M3CurrentIdPID.PID_Out = 0.0f;
/*************************************************************/		
	M3CurrentIqPID.Kp = 0.01f; 
	M3CurrentIqPID.Ki = M3CurrentIqPID.Kp / 10.0f;
	M3CurrentIqPID.Kd = 0.0f;
	
	M3CurrentIqPID.Ki_Out = 0.0f;
	
	M3CurrentIqPID.Kp_Min = -IqId;
	M3CurrentIqPID.Kp_Max =  IqId;
	
	M3CurrentIqPID.Kd_Min = -IqId;
	M3CurrentIqPID.Kd_Max =  IqId;
	
	M3CurrentIqPID.Ki_Min = -IqId;
	M3CurrentIqPID.Ki_Max =  IqId;
	
	M3CurrentIqPID.outMin = -IqId;
	M3CurrentIqPID.outMax =  IqId;
	
	M3CurrentIqPID.PID_Out = 0.0f;
/*************************************************************/	
	Cubli.Protect_flag = 1;
	Cubli.BatVin_filter = 8.2f;

	axis.edge_cos  = cosf(Cubli_Dot_Angle*A2R);
  axis.edge_sin  = sinf(Cubli_Dot_Angle*A2R);
	axis.speed_cos = cosf(Motor_Install_Angle*A2R);
  axis.speed_sin = sinf(Motor_Install_Angle*A2R);
	
  Cubli.Mechanical_Median[0] = -0.2f; // 单边时X轴的机械中值
	Cubli.Mechanical_Median[1] = -1.1f; // 单点时X轴的机械中值
	Cubli.Mechanical_Median[2] = 1.1f;  // 单点时Y轴的机械中值
	
//	Cubli.Mechanical_Median[0] = -6.0f; // 单边时X轴的机械中值
//	Cubli.Mechanical_Median[1] = -4.2f; // 单点时X轴的机械中值
//	Cubli.Mechanical_Median[2] = 0.5f;  // 单点时Y轴的机械中值
	Cubli.Mode = 0;
}

void reset_pid(void)
{	
	X_SpeedPID.Ki_Out = 0.0f;
	X_SpeedPID.PID_Out = 0.0f;
	
	Y_SpeedPID.Ki_Out = 0.0f;
	Y_SpeedPID.PID_Out = 0.0f;
	
	GyroAnglePID_X.Ki_Out = 0.0f;
	GyroAnglePID_X.PID_Out = 0.0f;

	ControlOut_M1 = 0.0f;
	ControlOut_M2 = 0.0f;
	ControlOut_M3 = 0.0f;
}

void Stop_data(void)
{
	M1_Foc.Cali_flag = 0;
	M2_Foc.Cali_flag = 0;
	M3_Foc.Cali_flag = 0;
	dot_auto_up_cnt = 0;
	edge_auto_flag = 0;
	dot1_auto_flag = 0;
	dot3_auto_flag = 0;
	dot_auto_up_flag = 0;
	Cubli.AutoStandUp = 0;
	Cubli.ManualUp = 0;
	CubeSpeedCnt = 0;
	adaptive_x = 0.0f;
	adaptive_y = 0.0f;
	reset_pid();
	colour_data = 0x0000a0;
}
float ControlOut_M1 = 0.0f,ControlOut_M2 = 0.0f,ControlOut_M3 = 0.0f;
float Out_M1 = 0.0f,Out_M2 = 0.0f,Out_M3 = 0.0f;

float gyroAngle_x,gyroAngle_y,gyroAngle_z,gyroAngle_t;

float Offset_x = 0.0f,Offset_y = 0.0f,Offset_z = 0.0f;

u16 CubeSpeedCnt = 0;
float adaptive_x = 0.0f,adaptive_y = 0.0f;

void edge_balance(void)
{
	if(fabsf(mpu6500.gyroAngle.x - Cubli.Mechanical_Median[0]) < 8.0f)	
	{
		M2_Foc.Cali_flag = 1;
		if(++CubeSpeedCnt >= 1000)
		{
			CubeSpeedCnt = 1000;
			
			adaptive(&adaptive_x,M2_Encoder.Speed_filterA,180.0f,25.0f);
		}

		gyroAngle_x = mpu6500.gyroAngle.x - Cubli.Mechanical_Median[0] - adaptive_x;
		
		PID_Adjust(&X_SpeedPID,0.0f,M2_Encoder.Speed_filterA); 	
		ControlOut_M2 = PID_Adjust_T(&GyroAnglePID_X,0.0f,gyroAngle_x + X_SpeedPID.PID_Out,mpu6500.gyro.filter.x);
	}
	else if(M2_Foc.Cali_flag == 1)
	{
		if(fabsf(mpu6500.gyroAngle.x - Cubli.Mechanical_Median[0]) > 35.0f)
		{
			if(ControlOut_M2 > 0.0f)
			{
				ControlOut_M2 -= 0.001f; 
				if(ControlOut_M2 < 0.0f)
				{
					ControlOut_M2 = 0.0f; 
					Stop_data();
				}
			}
			else if(ControlOut_M2 < 0.0f)
			{
				ControlOut_M2 += 0.001f;
				if(ControlOut_M2 > 0.0f)
				{
					ControlOut_M2 = 0.0f; 
					Stop_data();
				}
			}		
		}
	}
	if(FaultBit.bit.IMU == 1) // IMU错误
	{
		ControlOut_M2 = 0.0f;
		M2_Foc.Cali_Status = 2; // 电机进入停止
	}
}

void dot_balance(void) 
{
	if(fabsf(mpu6500.gyroAngle.y - Cubli.Mechanical_Median[2]) < 20.0f && fabsf(mpu6500.gyroAngle.x - Cubli.Mechanical_Median[0]) < 20.0f)
	{
		M1_Foc.Cali_flag = 1;
		M2_Foc.Cali_flag = 1;
		M3_Foc.Cali_flag = 1;
		
		Rc.x_c = Rc.x * 0.05f;
		Rc.y_c = Rc.y * 0.05f;
		
		Rc.x_f += (Rc.x_c - Rc.x_f) * 0.02f;
		Rc.y_f += (Rc.y_c - Rc.y_f) * 0.02f;
		
		Encoder.X_Speed = M2_Encoder.Speed_filterA - M3_Encoder.Speed_filterA * axis.speed_sin - M1_Encoder.Speed_filterA  * axis.speed_sin;
		Encoder.Y_Speed = (M3_Encoder.Speed_filterA - M1_Encoder.Speed_filterA) * axis.speed_cos;
		Encoder.Z_Speed = M1_Encoder.Speed_filterA + M2_Encoder.Speed_filterA + M3_Encoder.Speed_filterA;

		if(++CubeSpeedCnt >= 1000)
		{
			CubeSpeedCnt = 1000;		
		  if(fabsf(Rc.x_f) < 0.1f && fabsf(Rc.y_f) < 0.1f)
			{
				adaptive(&adaptive_x,Encoder.X_Speed,180.0f,25.0f);
				adaptive(&adaptive_y,Encoder.Y_Speed,180.0f,25.0f);
			}
		}

    PID_Adjust(&X_SpeedPID,0.0f,Encoder.X_Speed); 
		PID_Adjust(&Y_SpeedPID,0.0f,Encoder.Y_Speed); 
		
		gyroAngle_x = mpu6500.gyroAngle.x - Cubli.Mechanical_Median[1] - adaptive_x;
		gyroAngle_y = mpu6500.gyroAngle.y - Cubli.Mechanical_Median[2] + adaptive_y;
		
		Out_M1 = PID_Adjust_T(&GyroAnglePID_Y,Rc.y_f,-gyroAngle_y + Y_SpeedPID.PID_Out,mpu6500.gyro.filter.y);
		Out_M2 = PID_Adjust_T(&GyroAnglePID_X,-Rc.x_f,gyroAngle_x + X_SpeedPID.PID_Out,mpu6500.gyro.filter.x);
		Out_M3 = PID_Adjust_T(&GyroAnglePID_Z,Rc.z,Encoder.Z_Speed * 0.001f,mpu6500.gyro.filter.z);

		ControlOut_M1 = -(Out_M1 * axis.speed_cos + Out_M2 * axis.speed_sin - Out_M3);
		ControlOut_M2 = (Out_M2 + Out_M3);
		ControlOut_M3 = (Out_M1 * axis.speed_cos + Out_M2 * axis.speed_sin + Out_M3);
	}
	else if(M1_Foc.Cali_flag == 1 || M3_Foc.Cali_flag == 1)
	{	
		if(fabsf(mpu6500.gyroAngle.y - Cubli.Mechanical_Median[2]) > 35.0f || fabsf(mpu6500.gyroAngle.x - Cubli.Mechanical_Median[0]) > 35.0f)
		{
			if(ControlOut_M1 > 0.0f)
			{
				ControlOut_M1 -= 0.001f; 
				if(ControlOut_M1 < 0.0f)
				{
					ControlOut_M1 = 0.0f; 
					Stop_data();
				}
			}
			else if(ControlOut_M1 < 0.0f)
			{
				ControlOut_M1 += 0.001f; 
				if(ControlOut_M1 > 0.0f)
				{
					ControlOut_M1 = 0.0f; 
					Stop_data();
				}
			}		
			
			if(ControlOut_M2 > 0.0f)
			{
				ControlOut_M2 -= 0.001f; 
				if(ControlOut_M2 < 0.0f)
				{
					ControlOut_M2 = 0.0f; 
					Stop_data();
				}
			}
			else if(ControlOut_M2 < 0.0f)
			{
				ControlOut_M2 += 0.001f; 
				if(ControlOut_M2 > 0.0f)
				{
					ControlOut_M2 = 0.0f; 
					Stop_data();
				}
			}		
			
			if(ControlOut_M3 > 0.0f)
			{
				ControlOut_M3 -= 0.001f; 
				if(ControlOut_M3 < 0.0f)
				{
					ControlOut_M3 = 0.0f; 
					Stop_data();
				}
			}
			else if(ControlOut_M3 < 0.0f)
			{
				ControlOut_M3 += 0.001f; 
				if(ControlOut_M3 > 0.0f)
				{
					ControlOut_M3 = 0.0f; 
					Stop_data();
				}
			}		
		}
	}
	if(FaultBit.bit.IMU == 1) // IMU错误
	{
		ControlOut_M1 = 0.0f;
		ControlOut_M2 = 0.0f;
		ControlOut_M3 = 0.0f;
		M1_Foc.Cali_Status = 2; // 电机进入停止
		M2_Foc.Cali_Status = 2; // 电机进入停止
		M3_Foc.Cali_Status = 2; // 电机进入停止
	}
}

u8 edge_auto_flag = 0;
u16 edge_auto_cnt = 0;

void edge_auto_up(void)
{
	PID_Adjust(&M2CurrentIdPID,0.0f,M2_Foc.Id);
	M2_Foc.Vd = M2CurrentIdPID.PID_Out;	
	
	if(edge_auto_flag == 0 && IMU_cnt >= 2000)
	{
		edge_auto_flag = 1;
		M2_Foc.Vq = -0.65f;
	}
	
	if(edge_auto_flag == 1)
	{
		if(++edge_auto_cnt >= 2500)
		{
			edge_auto_cnt = 0;
	    edge_auto_flag = 3;

			Cubli.AutoStandUp = 1;
			M2_Foc.Vq = fabsf(mpu6500.gyroAngle.x) * Cubli.data[0]; //21V - 0.007
			if(M2_Foc.Vq > 0.8f)M2_Foc.Vq = 0.8f;
		}
	}
}

u8 dot1_auto_flag = 0;
u16 dot1_auto_cnt = 0;

u8 dot3_auto_flag = 0;
u16 dot3_auto_cnt = 0;

u8 dot_auto_up_flag = 0;
u16 dot_auto_up_cnt = 0;

void dot1_auto_up(void)
{
	PID_Adjust(&M1CurrentIdPID,0.0f,M1_Foc.Id);
	M1_Foc.Vd = M1CurrentIdPID.PID_Out;	
	
	if(dot1_auto_flag == 0 && dot_auto_up_flag == 1)
	{
		dot1_auto_flag = 1;
		M1_Foc.Vq = 0.65f;
	}
	
	if(dot1_auto_flag == 1)
	{
		if(++dot1_auto_cnt >= 5000)
		{
			dot1_auto_cnt = 0;
			dot1_auto_flag = 3;
			
			Cubli.AutoStandUp = 2;
			M1_Foc.Vq = -fabsf(mpu6500.gyroAngle.y) * Cubli.data[1];
			if(M1_Foc.Vq < -0.8f)M1_Foc.Vq = -0.8f;
		}
	}
}



void dot3_auto_up(void)
{
	PID_Adjust(&M3CurrentIdPID,0.0f,M3_Foc.Id);
	M3_Foc.Vd = M3CurrentIdPID.PID_Out;	
	
	if(dot3_auto_flag == 0 && dot_auto_up_flag == 1)
	{
		dot3_auto_flag = 1;
		M3_Foc.Vq = -0.65f;
	}
	
	if(dot3_auto_flag == 1)
	{
		if(++dot3_auto_cnt >= 5000)
		{
			dot3_auto_cnt = 0;
			dot3_auto_flag = 3;
			
			Cubli.AutoStandUp = 2;
			M3_Foc.Vq = fabsf(mpu6500.gyroAngle.y) * Cubli.data[1];
			if(M3_Foc.Vq > 0.8f)M3_Foc.Vq = 0.8f;
		}
	}
}

u8 M1SpeedCnt = 0;
u8 M2SpeedCnt = 0;
u8 M3SpeedCnt = 0;

void M1_Control(void)
{
	if(M1_Foc.Cali_Status == 0) // 正常闭环
	{
		if(++M1SpeedCnt >= 2) 
		{
			M1SpeedCnt = 0;
			SpeedCompute(&M1_Encoder,M1_Foc.Encoder_data);
		}
//		M1SpeedControl(ControlOut_M1);
//		M1Current_ClosedLoop(ControlOut_M1);
		M1Voltage_ClosedLoop(ControlOut_M1);
	}
	else if(M1_Foc.Cali_Status == 2) // 电机停止
	{
		M1_Foc.Vd = 0.0f;	
		M1_Foc.Vq = 0.0f;	
	}
	else if(M1_Foc.Cali_Status == 1) // 电机校准后转动
	{
		M1SpeedControl(600.0f);
		M1Current_ClosedLoop(M1SpeedPID.PID_Out);
	}
	else if(M1_Foc.Cali_Status == 3) //计算速度
	{
		if(++M1SpeedCnt >= 2) 
		{
			M1SpeedCnt = 0;
			SpeedCompute(&M1_Encoder,M1_Foc.Encoder_data);
		}
	}
}

void M2_Control(void) 
{
	if(M2_Foc.Cali_Status == 0) // 正常闭环
	{	
		if(++M2SpeedCnt >= 2) 
		{
			M2SpeedCnt = 0;
			SpeedCompute(&M2_Encoder,M2_Foc.Encoder_data);
		}
//		M2SpeedControl(ControlOut_M2);
//		M2Current_ClosedLoop(ControlOut_M2);
		
		M2Voltage_ClosedLoop(ControlOut_M2);
	}
	else if(M2_Foc.Cali_Status == 2) // 电机停止
	{
		M2_Foc.Vd = 0.0f;	
		M2_Foc.Vq = 0.0f;	
	}
	else if(M2_Foc.Cali_Status == 1) // 电机校准后转动
	{
		M2SpeedControl(600.0f);
		M2Current_ClosedLoop(M2SpeedPID.PID_Out);
	}
	else if(M2_Foc.Cali_Status == 3) //计算速度
	{
		if(++M2SpeedCnt >= 2)
		{
			M2SpeedCnt = 0;
			SpeedCompute(&M2_Encoder,M2_Foc.Encoder_data);
		}
	}
}

void M3_Control(void) 
{
	if(M3_Foc.Cali_Status == 0) // 正常闭环
	{
		if(++M3SpeedCnt >= 2) 
		{
			M3SpeedCnt = 0;
			SpeedCompute(&M3_Encoder,M3_Foc.Encoder_data);
		}
//		M3SpeedControl(ControlOut_M3);
//		M3Current_ClosedLoop(ControlOut_M3);
		M3Voltage_ClosedLoop(ControlOut_M3);
	}
	else if(M3_Foc.Cali_Status == 2) // 电机停止
	{
		M3_Foc.Vd = 0.0f;	
		M3_Foc.Vq = 0.0f;	
	}
	else if(M3_Foc.Cali_Status == 1) // 电机校准后转动
	{
		M3SpeedControl(600.0f);
		M3Current_ClosedLoop(M3SpeedPID.PID_Out);
	}
	else if(M3_Foc.Cali_Status == 3) //计算速度
	{
		if(++M3SpeedCnt >= 2)
		{
			M3SpeedCnt = 0;
			SpeedCompute(&M3_Encoder,M3_Foc.Encoder_data);
		}
	}
}

void SpeedCompute(Encoder_t* Speed, uint16_t Encoder_data) // 计算速度
{
	Speed->data = Encoder_data;
	if(Speed->Spd_Offset_Flag == 0)
	{
		Speed->Spd_Offset_Flag = 1;
		Speed->UpData = Speed->data;
	}
	if(Speed->UpData > 32000 && Speed->data < 768)
	{
		Speed->DiffeData = (int32_t)(32768  + Speed->data) - Speed->UpData;
	} 
	else if(Speed->UpData < 768 && Speed->data > 32000)
	{
		Speed->DiffeData = - ((int32_t)(32768  - Speed->data) + Speed->UpData);
	}
	else
	{
		Speed->DiffeData = Speed->data - Speed->UpData;
	}
	Speed->UpData = Speed->data;
	
	Speed->Speed = (Speed->DiffeData * 0.010986328125f)/0.0002f;
	Speed->Speed_filter += (Speed->Speed - Speed->Speed_filter) * 0.1f;
	Speed->Speed_filterA += (Speed->Speed_filter - Speed->Speed_filterA) * 0.01f;
}

void M1SpeedControl(float speed) // 速度环 200us
{
	if(++M1SpeedCnt >= 2) 
	{
		M1SpeedCnt = 0;
		SpeedCompute(&M1_Encoder,M1_Foc.Encoder_data);
		PID_Adjust(&M1SpeedPID,speed,M1_Encoder.Speed_filter);	
	}
}

void M1Voltage_ClosedLoop(float voltage) // 电压环 100us
{
	PID_Adjust(&M1CurrentIdPID,0.0f,M1_Foc.Id);
	M1_Foc.Vd = M1CurrentIdPID.PID_Out;	
  if(voltage > 0.9f)voltage = 0.9f; else if(voltage < -0.9f)voltage = -0.9f;
	M1_Foc.Vq = voltage;
}

void M1Current_ClosedLoop(float Current) // 电流环 100us
{
	PID_Adjust(&M1CurrentIdPID,0.0f,M1_Foc.Id);
	M1_Foc.Vd = M1CurrentIdPID.PID_Out;	
	
	PID_Adjust(&M1CurrentIqPID,Current,M1_Foc.Iq);
	M1_Foc.Vq = M1CurrentIqPID.PID_Out;
}

void M2SpeedControl(float speed) // 速度环 200us
{
	if(++M2SpeedCnt >= 2) 
	{
		M2SpeedCnt = 0;
		SpeedCompute(&M2_Encoder,M2_Foc.Encoder_data);
		PID_Adjust(&M2SpeedPID,speed,M2_Encoder.Speed_filter);	
	}
}

void M2Voltage_ClosedLoop(float voltage) // 电压环 100us
{
	PID_Adjust(&M2CurrentIdPID,0.0f,M2_Foc.Id);
	M2_Foc.Vd = M2CurrentIdPID.PID_Out;	
  if(voltage > 0.9f)voltage = 0.9f; else if(voltage < -0.9f)voltage = -0.9f;
	M2_Foc.Vq = voltage;
}

void M2Current_ClosedLoop(float Current) // 电流环 100us
{
	PID_Adjust(&M2CurrentIdPID,0.0f,M2_Foc.Id);
	M2_Foc.Vd = M2CurrentIdPID.PID_Out;	

	PID_Adjust(&M2CurrentIqPID,Current,M2_Foc.Iq);
	M2_Foc.Vq = M2CurrentIqPID.PID_Out;
}

void M3SpeedControl(float speed) // 速度环 200us
{
	if(++M3SpeedCnt >= 2) 
	{
		M3SpeedCnt = 0;
		SpeedCompute(&M3_Encoder,M3_Foc.Encoder_data);
		PID_Adjust(&M3SpeedPID,speed,M3_Encoder.Speed_filter);	
	}
}

void M3Voltage_ClosedLoop(float voltage) // 电压环 100us
{
	PID_Adjust(&M3CurrentIdPID,0.0f,M3_Foc.Id);
	M3_Foc.Vd = M3CurrentIdPID.PID_Out;	
  if(voltage > 0.9f)voltage = 0.9f; else if(voltage < -0.9f)voltage = -0.9f;
	M3_Foc.Vq = voltage;
}

void M3Current_ClosedLoop(float Current) // 电流环 100us
{
	PID_Adjust(&M3CurrentIdPID,0.0f,M3_Foc.Id);
	M3_Foc.Vd = M3CurrentIdPID.PID_Out;	
	
	PID_Adjust(&M3CurrentIqPID,Current,M3_Foc.Iq);
	M3_Foc.Vq = M3CurrentIqPID.PID_Out;
}

float PID_Adjust_T(PID_Structure* handle,float Given,float Feedback,float Gyro)
{
	float Error_value;

	float P_Out;
	float D_Out;
	
	Error_value = Given - Feedback;
	
	P_Out = Error_value * handle->Kp;
	handle->Ki_Out += Error_value * handle->Ki;
	D_Out = Gyro * handle->Kd; 
	
	if(P_Out < handle->Kp_Min)P_Out = handle->Kp_Min; 
	else if(P_Out > handle->Kp_Max)P_Out = handle->Kp_Max;
	
	if(handle->Ki_Out < handle->Ki_Min)handle->Ki_Out = handle->Ki_Min;
	else if(handle->Ki_Out > handle->Ki_Max)handle->Ki_Out = handle->Ki_Max;
  
	if(D_Out < handle->Kd_Min)D_Out = handle->Kd_Min; 
	else if(D_Out > handle->Kd_Max)D_Out = handle->Kd_Max;
	
	handle->PID_Out = P_Out + handle->Ki_Out + D_Out;
	
	if(handle->PID_Out > handle->outMax)
	{
    handle->PID_Out = handle->outMax;
	}
  else if(handle->PID_Out < handle->outMin)
	{
    handle->PID_Out = handle->outMin;
	}
	return handle->PID_Out;
}

float PID_Adjust(PID_Structure* handle,float Given,float Feedback)
{
	float Error_value;

	float P_Out;
	
	Error_value = Given - Feedback;
	
	P_Out = Error_value * handle->Kp;
	handle->Ki_Out += Error_value * handle->Ki;

	if(P_Out < handle->Kp_Min)P_Out = handle->Kp_Min; 
	else if(P_Out > handle->Kp_Max)P_Out = handle->Kp_Max;
	
	if(handle->Ki_Out < handle->Ki_Min)handle->Ki_Out = handle->Ki_Min;
	else if(handle->Ki_Out > handle->Ki_Max)handle->Ki_Out = handle->Ki_Max;
	
	handle->PID_Out = P_Out + handle->Ki_Out;
	
	if(handle->PID_Out > handle->outMax)
	{
    handle->PID_Out = handle->outMax;
	}
  else if(handle->PID_Out < handle->outMin)
	{
    handle->PID_Out = handle->outMin;
	}
	return handle->PID_Out;
}
