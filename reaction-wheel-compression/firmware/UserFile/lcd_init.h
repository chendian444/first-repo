#ifndef __LCD_INIT_H
#define __LCD_INIT_H

#include "app.h"

#define USE_HORIZONTAL 3  //设置横屏或者竖屏显示 0或1为竖屏 2或3为横屏


#if USE_HORIZONTAL==0||USE_HORIZONTAL==1
#define LCD_W 80
#define LCD_H 160

#else
#define LCD_W 160
#define LCD_H 80
#endif

//-----------------LCD端口定义---------------- 

#define LCD_RES_Clr()  gpio_bits_reset(GPIOB,GPIO_PINS_2)//RES
#define LCD_RES_Set()  gpio_bits_set(GPIOB,GPIO_PINS_2)

#define LCD_DC_Clr()   gpio_bits_reset(GPIOB,GPIO_PINS_14)//DC
#define LCD_DC_Set()   gpio_bits_set(GPIOB,GPIO_PINS_14)
 		     
#define LCD_CS_Clr()   gpio_bits_reset(GPIOB,GPIO_PINS_12)//CS
#define LCD_CS_Set()   gpio_bits_set(GPIOB,GPIO_PINS_12)

extern u8 DMA1_CHANNEL1_Flag;
//void SPI1_SetSpeed(u8 SpeedSet);

void LCD_GPIO_Init(void);//初始化GPIO
u16 LCD_Writ_Bus(u8 dat);//
void LCD_WR_DATA8(u16 dat);//写入一个字节
void LCD_WR_DATA(u16 dat);//写入两个字节
void LCD_WR_REG(u8 dat);//写入一个指令
void LCD_Address_Set(u16 x1,u16 y1,u16 x2,u16 y2);//设置坐标函数
void LCD_Init(void);//LCD初始化
void SPI2_DMA_Send(u32 mar,u16 ndtr);

#endif




