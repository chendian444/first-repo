
#include "app.h"

mpu6500_t mpu6500;
mpu6500_t sensor;
axis_t axis;

/**************************************************************************************************/
u8 IMU_data[14];

u8 IMU_Initial = 0;
u16 Kp_cnt = 0;

float IMU_Kp = 20.0f;         // proportional gain governs rate of convergence to accelerometer/magnetometer
float IMU_Ki = 0.0001f;       // integral gain governs rate of convergence of gyroscope biases
#define halfT 0.0005f 

float q0 = 1.0f, q1 = 0.0f, q2 = 0.0f, q3 = 0.0f;        // quaternion elements representing the estimated orientation
float exInt = 0.0f, eyInt = 0.0f, ezInt = 0.0f;  

void IMUupdate(float gx, float gy, float gz, float ax, float ay, float az) 
{
	float norm;
	float vx, vy, vz;
	float ex, ey, ez;         
  
	if(IMU_Initial == 0)
	{
		if(++Kp_cnt >= 500)
		{
			Kp_cnt = 0;
			IMU_Initial = 1;
			IMU_Kp = 0.25f;
		}
	}
	
	norm = _sqrtf(ax*ax + ay*ay + az*az);   
  //arm_sqrt_f32(ax*ax + ay*ay + az*az,&norm);
	
	ax = ax / norm;
	ay = ay / norm;
	az = az / norm;   
  /* 
	把加计的三维向量转成单位向量 
	*/
	
	vx = 2.0f * (q1*q3 - q0*q2);
	vy = 2.0f * (q0*q1 + q2*q3);
	vz = q0*q0 - q1*q1 - q2*q2 + q3*q3;
	/*
	这是把四元数换算成《方向余弦矩阵》中的第三列的三个元素。
	根据余弦矩阵和欧拉角的定义，地理坐标系的重力向量，转到机体坐标系，正好是这三个元素。
	所以这里的vx\y\z，其实就是当前的欧拉角（即四元数）的机体坐标参照系上，换算出来的重力单位向量。
  */

	ex = (ay*vz - az*vy);
	ey = (az*vx - ax*vz);
	ez = (ax*vy - ay*vx);
	/*
	axyz是机体坐标参照系上，加速度计测出来的重力向量，也就是实际测出来的重力向量。
	axyz是测量得到的重力向量，vxyz是陀螺积分后的姿态来推算出的重力向量，它们都是机体坐标参照系上的重力向量。
	那它们之间的误差向量，就是陀螺积分后的姿态和加计测出来的姿态之间的误差。
	向量间的误差，可以用向量叉积（也叫向量外积、叉乘）来表示，exyz就是两个重力向量的叉积。
	这个叉积向量仍旧是位于机体坐标系上的，而陀螺积分误差也是在机体坐标系，而且叉积的大小与陀螺积分误差成正比，正好拿来纠正陀螺。（你可以自己拿东西想象一下）由于陀螺是对机体直接积分，所以对陀螺的纠正量会直接体现在对机体坐标系的纠正。
  */

	exInt = exInt + ex*IMU_Ki;
	eyInt = eyInt + ey*IMU_Ki;
	ezInt = ezInt + ez*IMU_Ki;

	gx = gx + IMU_Kp*ex + exInt;
	gy = gy + IMU_Kp*ey + eyInt;
	gz = gz + IMU_Kp*ez + ezInt;
  /*
	用叉积误差来做PI修正陀螺零偏
  */
	
	q0 = q0 + (-q1*gx - q2*gy - q3*gz)*halfT;
	q1 = q1 + (q0*gx + q2*gz - q3*gy)*halfT;
	q2 = q2 + (q0*gy - q1*gz + q3*gx)*halfT;
	q3 = q3 + (q0*gz + q1*gy - q2*gx)*halfT;  
	/*
	四元数微分方程
  */

	arm_sqrt_f32(q0*q0 + q1*q1 + q2*q2 + q3*q3,&norm);
//	norm = _sqrtf(q0*q0 + q1*q1 + q2*q2 + q3*q3);
	q0 = q0 / norm;
	q1 = q1 / norm;
	q2 = q2 / norm;
	q3 = q3 / norm;
	/*
	四元数规范化
  */
	
	mpu6500.gyroAngle.x = -atan2(2*q2*q3+2*q0*q1,-2*q1*q1-2*q2*q2+1)*57.2957795f;
	mpu6500.gyroAngle.y = asin(-2*q1*q3+2*q0*q2)*57.2957795f;
	/*
	(姿态)欧拉角输出
  */	
}

u8 IMU_flag;

void IMU_handle(void) // 姿态计算
{
	Get_mpu6500(IMU_data);	//获取mpu6500数据
	
	mpu6500.acc.data.x = ((IMU_data[0]<<8)|IMU_data[1]);
	mpu6500.acc.data.y = ((IMU_data[2]<<8)|IMU_data[3]);
	mpu6500.acc.data.z = ((IMU_data[4]<<8)|IMU_data[5]);
  
	mpu6500.TempData = ((IMU_data[6]<<8)|IMU_data[7]) - 21;
	mpu6500.temp = 20.0f + (float)(mpu6500.TempData/333.87f);
	mpu6500.gyro_temp = (int8_t)mpu6500.temp; //转换成整数
	
	mpu6500.gyro.data.x = ((IMU_data[8]<<8)|IMU_data[9]);
	mpu6500.gyro.data.y = ((IMU_data[10]<<8)|IMU_data[11]);
	mpu6500.gyro.data.z = ((IMU_data[12]<<8)|IMU_data[13]);
	
	if(mpu6500.Cali_Flag == 1) // 温补已经校准
	{	
		if(mpu6500.Offset_Flag == 0)
		{
			mpu6500.Offset_Flag = 1;
			mpu6500.gyro.filter.x = mpu6500.gyro.Primitive.x;
			mpu6500.gyro.filter.y = mpu6500.gyro.Primitive.y;
			mpu6500.gyro.filter.z = mpu6500.gyro.Primitive.z;
			
			mpu6500.acc.Initial.x = mpu6500.acc.data.x;
			mpu6500.acc.Initial.y = mpu6500.acc.data.y;
			mpu6500.acc.Initial.z = mpu6500.acc.data.z;
		}
		
		mpu6500.gyro.Primitive.x = (float)mpu6500.gyro.data.x/16.4f - mpu6500.gyro.offset.x; // 换算成 度/秒
		mpu6500.gyro.Primitive.y = (float)mpu6500.gyro.data.y/16.4f - mpu6500.gyro.offset.y;
		mpu6500.gyro.Primitive.z = (float)mpu6500.gyro.data.z/16.4f - mpu6500.gyro.offset.z;	
		
//		mpu6500.gyro.Primitive.t = mpu6500.gyro.Primitive.x * axis.edge_cos - mpu6500.gyro.Primitive.z * axis.edge_sin;
		
		mpu6500.gyro.filter.x += (mpu6500.gyro.Primitive.x - mpu6500.gyro.filter.x) * 0.05f; // 滤波
		mpu6500.gyro.filter.y += (mpu6500.gyro.Primitive.y - mpu6500.gyro.filter.y) * 0.05f;
		mpu6500.gyro.filter.z += (mpu6500.gyro.Primitive.z - mpu6500.gyro.filter.z) * 0.05f;
		mpu6500.gyro.filter.t += (mpu6500.gyro.Primitive.t - mpu6500.gyro.filter.t) * 0.05f;

		mpu6500.acc.Primitive.x = (float)mpu6500.acc.data.x/4096.0f; // 换算成 度/秒
		mpu6500.acc.Primitive.y = (float)mpu6500.acc.data.y/4096.0f;
		mpu6500.acc.Primitive.z = (float)mpu6500.acc.data.z/4096.0f;	
			
		mpu6500.acc.filter.x += (mpu6500.acc.Primitive.x - mpu6500.acc.filter.x) * 0.01f; // 滤波
		mpu6500.acc.filter.y += (mpu6500.acc.Primitive.y - mpu6500.acc.filter.y) * 0.01f;
		mpu6500.acc.filter.z += (mpu6500.acc.Primitive.z - mpu6500.acc.filter.z) * 0.01f;
	}
	else if(mpu6500.Cali_Flag == 0) 
	{	
		if(mpu6500.Offset_Flag == 0)
		{
			mpu6500.Offset_Flag = 1;
			mpu6500.gyro.filter.x = mpu6500.gyro.Primitive.x;
			mpu6500.gyro.filter.y = mpu6500.gyro.Primitive.y;
			mpu6500.gyro.filter.z = mpu6500.gyro.Primitive.z;
			
			mpu6500.acc.Initial.x = mpu6500.acc.data.x;
			mpu6500.acc.Initial.y = mpu6500.acc.data.y;
			mpu6500.acc.Initial.z = mpu6500.acc.data.z;
		}
		
		mpu6500.gyro.Primitive.x = (float)mpu6500.gyro.data.x/16.4f; // 换算成 度/秒
		mpu6500.gyro.Primitive.y = (float)mpu6500.gyro.data.y/16.4f;
		mpu6500.gyro.Primitive.z = (float)mpu6500.gyro.data.z/16.4f;	
			
		mpu6500.gyro.filter.x += (mpu6500.gyro.Primitive.x - mpu6500.gyro.filter.x) * 0.05f; // 滤波
		mpu6500.gyro.filter.y += (mpu6500.gyro.Primitive.y - mpu6500.gyro.filter.y) * 0.05f;
		mpu6500.gyro.filter.z += (mpu6500.gyro.Primitive.z - mpu6500.gyro.filter.z) * 0.05f;
		
		mpu6500.acc.Primitive.x = (float)mpu6500.acc.data.x/4096.0f; // 换算成 度/秒
		mpu6500.acc.Primitive.y = (float)mpu6500.acc.data.y/4096.0f;
		mpu6500.acc.Primitive.z = (float)mpu6500.acc.data.z/4096.0f;	
			
		mpu6500.acc.filter.x += (mpu6500.acc.Primitive.x - mpu6500.acc.filter.x) * 0.01f; // 滤波
		mpu6500.acc.filter.y += (mpu6500.acc.Primitive.y - mpu6500.acc.filter.y) * 0.01f;
		mpu6500.acc.filter.z += (mpu6500.acc.Primitive.z - mpu6500.acc.filter.z) * 0.01f;
	}

	IMUupdate(mpu6500.gyro.Primitive.x*0.0174533f,mpu6500.gyro.Primitive.y*0.0174533f,mpu6500.gyro.Primitive.z*0.0174533f,mpu6500.acc.Primitive.x,mpu6500.acc.Primitive.y,mpu6500.acc.Primitive.z);
	
//	mpu6500.accAngle.x = -atan2f(mpu6500.acc.filter.y,mpu6500.acc.filter.z) * R2A;  //计算加速度倾角
//	mpu6500.accAngle.y = -atan2f(mpu6500.acc.filter.x,mpu6500.acc.filter.z) * R2A;  //计算加速度倾角

//	if(IMU_flag == 0) // 使用加速度计算的姿态角赋初值
//	{
//		mpu6500.gyroAngle.x = mpu6500.accAngle.x;
//		mpu6500.gyroAngle.y = mpu6500.accAngle.y;
//		mpu6500.gyroAngle.t = mpu6500.accAngle.x;
//		if(++IMU_cnt >= 200)
//		{
//			IMU_cnt = 0;
//			IMU_flag = 1;
//		}
//	}
//	
//	mpu6500.gyroAngle.x -= mpu6500.gyro.Primitive.x * 0.001f; // 角速度积分
//	mpu6500.gyroAngle.x = mpu6500.gyroAngle.x * 0.999f + mpu6500.accAngle.x * 0.001f; // 陀螺积分角度与加速度倾角进行融合
//	
//	mpu6500.gyroAngle.y += mpu6500.gyro.Primitive.y * 0.001f; // 角速度积分
//	mpu6500.gyroAngle.y = mpu6500.gyroAngle.y * 0.999f + mpu6500.accAngle.y * 0.001f; // 陀螺积分角度与加速度倾角进行融合
	
}
