
#include "app.h"

RC_t Rc;

u16 BLE_Cnt = 0; 


/* 按键说明
	1:立方体开机待机后,务必保证立方体屏幕朝上放置,按遥控器X键自动起立单边平衡,待紫色灯亮起后再按Y键即可单点平衡          
	2:如起立失败需要按ZR键结束,手动将立方体屏幕朝上摆正后方可再次进行一键起立.
	3:如发生其它情况可按ZL键关闭立方体电源
	4:注意,立方体属于高速旋转物体,使用过程中务必注意安全！注意,立方体属于高速旋转物体,使用过程中务必注意安全！注意,立方体属于高速旋转物体,使用过程中务必注意安全！
*/
				
void RcData(void)
{
	if(U2_IDLE_Flag == 1)
  {
		U2_IDLE_Flag = 0;
		BLE_Cnt = 0; 
    if(Get_usart2_data[0] == 0x20 && Get_usart2_data[1] == 0x0f && Get_usart2_data[14] == 0x02) // 游戏手柄控制数据 
		{		
      if(Get_usart2_data[10] > 250) // ZL 关闭总电源
			{
				gpio_bits_reset(GPIOA,GPIO_PINS_15);
			}
			
			if(Get_usart2_data[11] > 250) // ZR 停止
			{
				Stop_data();
				colour_data = 0x0000a0;
			}
			
			switch (Get_usart2_data[7])	
			{
				case 0x40: // X=0x40  单边平衡
									if(Cubli.AutoStandUp == 0 && Cubli.ManualUp == 0)M2_Foc.Cali_flag = 11;
				break;
				
				case 0x80: // Y=0x80  单点平衡
					        if(dot_auto_up_cnt >= 3500 && dot_auto_up_flag == 0 && Cubli.ManualUp == 0) // 等待单边平衡稳定
									{								
										reset_pid();
										dot_auto_up_flag = 1;
										M1_Foc.Cali_flag = 11;
										M3_Foc.Cali_flag = 11;
										CubeSpeedCnt = 0;
									}
				break;
				
				case 0x10: // A=0x10
									Cubli.ManualUp = 1; // 单边平衡手动模式
									colour_data = 0xa0a0a0;
				break;
				
				case 0x20: // B=0x20
									Cubli.ManualUp = 2; // 单点平衡手动模式
									colour_data = 0xa0a000;
				break;
			}

			Rc.ch2 = (Get_usart2_data[3] - 128); // = +- 128 3左摇杆 5右摇杆
			
			Rc.ch0 = (Get_usart2_data[5] - 128); // = +- 128 3左摇杆 5右摇杆
			Rc.ch1 = (Get_usart2_data[6] - 128); // = +- 128 3左摇杆 5右摇杆
			
			if(abs(Rc.ch0) < 8)
			{
				Rc.ch0 = 0; 
				Rc.x += (Rc.ch0 - Rc.x) * 0.1f;
				if(fabs(Rc.x) < 0.0001f)
				{
					Rc.x = 0.0f;
				}
			}
			else if(Rc.ch0 > 8)
			{
				Rc.ch0 -= 8;
				Rc.x += (Rc.ch0 - Rc.x) * 0.1f;
			}
			else if(Rc.ch0 < -8)
			{
				Rc.ch0 += 8;
				Rc.x += (Rc.ch0 - Rc.x) * 0.1f;
			}
			
			if(abs(Rc.ch1) < 8)
			{
				Rc.ch1 = 0; 
				Rc.y += (Rc.ch1 - Rc.y) * 0.1f;
				if(fabs(Rc.y) < 0.0001f)
				{
					Rc.y = 0.0f;
				}
			}
			else if(Rc.ch1 > 8)
			{
				Rc.ch1 -= 8;
				Rc.y += (Rc.ch1 - Rc.y) * 0.1f;
			}
			else if(Rc.ch1 < -8)
			{
				Rc.ch1 += 8;
				Rc.y += (Rc.ch1 - Rc.y) * 0.1f;
			}
			
			if(abs(Rc.ch2) < 8)
			{
				Rc.ch2 = 0; 
				Rc.z += (Rc.ch2 - Rc.z) * 0.1f;
				if(fabs(Rc.z) < 0.0001f)
				{
					Rc.z = 0.0f;
				}
			}
			else if(Rc.ch2 > 8)
			{
				Rc.ch2 -= 8;
				Rc.z += (Rc.ch2 - Rc.z) * 0.01f;
			}
			else if(Rc.ch2 < -8)
			{
				Rc.ch2 += 8;
				Rc.z += (Rc.ch2 - Rc.z) * 0.01f;
			}
		}
	}
	else
	{
		if(++BLE_Cnt >= 150)
		{
			BLE_Cnt = 500;
			if(Rc.ch0 > 0)
			{
				Rc.ch0--;
			  if(Rc.ch0 < 0)Rc.ch0 = 0; 
			}
			else if(Rc.ch0 < 0)
			{
				Rc.ch0++;
			  if(Rc.ch0 > 0)Rc.ch0 = 0; 
			}
			
			if(Rc.ch1 > 0)
			{
				Rc.ch1--;
			  if(Rc.ch1 < 0)Rc.ch1 = 0; 
			}
			else if(Rc.ch1 < 0)
			{
				Rc.ch1++;
			  if(Rc.ch1 > 0)Rc.ch1 = 0; 
			}
			
			if(Rc.ch2 > 0)
			{
				Rc.ch2--;
			  if(Rc.ch2 < 0)Rc.ch2 = 0; 
			}
			else if(Rc.ch2 < 0)
			{
				Rc.ch2++;
			  if(Rc.ch2 > 0)Rc.ch2 = 0; 
			}
			
			Rc.x += (Rc.ch0 - Rc.x) * 0.01f;
			if(fabs(Rc.x) < 0.0001f)
			{
				Rc.x = 0.0f;
			}
			
			Rc.y += (Rc.ch1 - Rc.y) * 0.01f;
			if(fabs(Rc.y) < 0.0001f)
			{
				Rc.y = 0.0f;
			}
			
			Rc.z += (Rc.ch2 - Rc.z) * 0.01f;
			if(fabs(Rc.z) < 0.0001f)
			{
				Rc.z = 0.0f;
			}
		}
	}
}

