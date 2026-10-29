#ifndef __LCD_H
#define __LCD_H		
#include "app.h"

void LCD_Fill(u16 xsta,u16 ysta,u16 xend,u16 yend,u16 color);//指定区域填充颜色
void Fill_Show(u16 x,u16 y,u16 length,u16 width,u16 color);

void LCD_DrawPoint(u16 x,u16 y, uint16_t color);
void LCD_DrawLine(u16 x1, u16 y1, u16 x2, u16 y2,u16 color);
void LCD_DrawRectangle(u16 x1, u16 y1, u16 x2, u16 y2,u16 color);
void Draw_Circle(u16 x0,u16 y0,u8 r,u16 color);
void LCD_ShowChinese(u16 x,u16 y,u8 *s,u16 fc,u16 bc,u8 sizey);
void LCD_ShowChinese16x16(u16 x,u16 y,u8 *s,u16 fc,u16 bc,u8 sizey);
void LCD_ShowChar(uint16_t x, uint16_t y, char chr, uint8_t size, uint16_t fc, uint16_t bc, uint8_t mode);
void LCD_ShowString(u16 x,u16 y,char *p,u8 size,u16 fc,u16 bc);

void LCD_ShowPicture(u16 x,u16 y,u16 length,u16 width,const u8 pic[]);
void Display_Logo(void);
void Logo_init(void);

extern u16 lcd_data[12800];

//画笔颜色
#define WHITE         	 0xFFFF
#define BLACK         	 0x0000	  
#define BLUE           	 0x001F  
#define BRED             0XF81F
#define GRED 			       0XFFE0
#define GBLUE			       0X07FF
#define RED           	 0xF800
#define MAGENTA       	 0xF81F
#define GREEN         	 0x07E0
#define CYAN          	 0x7FFF
#define YELLOW        	 0xFFE0
#define BROWN 			     0XBC40 //棕色
#define BRRED 			     0XFC07 //棕红色
#define GRAY  			     0X8430 //灰色
#define DARKBLUE      	 0X01CF	//深蓝色
#define LIGHTBLUE      	 0X7D7C	//浅蓝色  
#define GRAYBLUE       	 0X5458 //灰蓝色
#define LIGHTGREEN     	 0X841F //浅绿色
#define LGRAY 			     0XC618 //浅灰色(PANNEL),窗体背景色
#define LGRAYBLUE        0XA651 //浅灰蓝色(中间层颜色)
#define LBBLUE           0X2B12 //浅棕蓝色(选择条目的反色)

#endif





