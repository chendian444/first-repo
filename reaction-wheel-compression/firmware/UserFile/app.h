#ifndef __app_H
#define __app_H

#include "at32f403a_407_clock.h"

#include "at32f403a_407.h"

#include <stdlib.h>
#include "string.h"
#include "stdio.h"
#include "string.h"
#include "arm_math.h"

#include "delay.h"
#include "timer.h"
#include "MPU6500.h"
#include "usart.h"
#include "Debug.h"
#include "AHRS.h"
#include "adc.h"
#include "AT32F403A_FOC_LIB.h"

#include "Gpio_Config.h"
#include "key.h"
#include "Encoder.h"
#include "Calibration.h"
#include "flash.h"
#include "WS2812.h"

#include "RcData.h"
#include "lcd_init.h"
#include "lcd.h"
#include "Control.h"

extern u16 IMU_cnt;
extern u32 colour_data;

void Peripherals_Init(void);

#endif
