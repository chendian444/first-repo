#include "app.h"

//按键初始化函数
void Key_Init(void)
{
	gpio_init_type gpio_init_struct;
  crm_periph_clock_enable(CRM_GPIOC_PERIPH_CLOCK, TRUE);
	gpio_default_para_init(&gpio_init_struct);
	/* configure the led gpio */
  gpio_init_struct.gpio_drive_strength = GPIO_DRIVE_STRENGTH_STRONGER;
  gpio_init_struct.gpio_out_type  = GPIO_OUTPUT_PUSH_PULL;
  gpio_init_struct.gpio_mode = GPIO_MODE_INPUT;
  gpio_init_struct.gpio_pins = GPIO_PINS_10|GPIO_PINS_13|GPIO_PINS_14|GPIO_PINS_15; 
  gpio_init_struct.gpio_pull = GPIO_PULL_UP;
  gpio_init(GPIOC, &gpio_init_struct);
	
	gpio_bits_set(GPIOC,GPIO_PINS_10|GPIO_PINS_13|GPIO_PINS_14|GPIO_PINS_15);	
} 
//按键处理函数
//返回按键值

u16 Key1_Count = 0;
u8 KeyFlag = 0;
u16 KeyCnt = 10; 
uint16_t CarCaliCnt = 0;

void Key_Scan(void)
{	 
	if(Key1 == 0 && Key1_Count < KeyCnt)
	{
		Key1_Count++;
		if(Key1 == 0 && Key1_Count >= KeyCnt) // KeyCnt = 去抖时间
		{
			if(Cubli.Power_flag == 0)
			{
				Cubli.Power_flag = 1;
				
			}
			else if(Cubli.Power_flag == 1)
			{
				Cubli.Power_flag = 0;
				gpio_bits_reset(GPIOA,GPIO_PINS_15);
			}
		}
	}
	else if(Key1 != 0)
	{
		Key1_Count = 0;
	}
}



















