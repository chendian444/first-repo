#include "lcd.h"
#include "lcd_init.h"
#include "lcdfont.h"
#include "delay.h"

u16 lcd_data[12800];

/******************************************************************************
      函数说明：在指定区域填充颜色
      入口数据：xsta,ysta   起始坐标
                xend,yend   终止坐标
								color       要填充的颜色
      返回值：  无
******************************************************************************/
void LCD_Fill(u16 xsta,u16 ysta,u16 xend,u16 yend,u16 color)
{          
	u16 i,j; 
	LCD_Address_Set(xsta,ysta,xend-1,yend-1);//设置显示范围
	for(i=ysta;i<yend;i++)
	{													   	 	
		for(j=xsta;j<xend;j++)
		{
			LCD_WR_DATA(color);
		}
	} 					  	    
}

void Fill_Show(u16 x,u16 y,u16 length,u16 width,u16 color)
{
  u16 lcd_data_max;
  u16 i,k,t;
	u16 y_t = 0,x_t = 0;
  t = y * 160;
	for(k=0;k<length;k++)
	{
		y_t = k * 160;
		for(i=0;i<width;i++)
		{ 			
			lcd_data_max = y_t+i+x+t;
			lcd_data[lcd_data_max] = color;
		}
		x_t += width;	
	}
}

/******************************************************************************
      函数说明：在指定位置画点
      入口数据：x,y 画点坐标
                color 点的颜色
      返回值：  无
******************************************************************************/
void LCD_DrawPoint(u16 x,u16 y, uint16_t color)
{
	u16 lcd_data_max = 0;
	lcd_data_max = x+y*LCD_W;
	lcd_data[lcd_data_max] = color;
}

/******************************************************************************
      函数说明：画线
      入口数据：x1,y1   起始坐标
                x2,y2   终止坐标
                color   线的颜色
      返回值：  无
******************************************************************************/

//void LCD_DrawLine_bank(u16 x1, u16 y1, u16 x2, u16 y2,u16 color)
//{
//	u16 i;
//	s16 incx = x2 - x1,incy = y2 - y1;
//	for(i=0;i<incx;i++)
//	{
//		LCD_DrawPoint(x1+i,y1,color);
//	}
//	if(incy >= 0)
//	{
//		for(i=0;i<incy;i++)
//		{
//			LCD_DrawPoint(x1,y1,color);
//			x1+=LCD_W;
//		}
//	}
//}

void LCD_DrawLine(u16 x1, u16 y1, u16 x2, u16 y2,u16 color)
{
	u16 t; 
	int xerr=0,yerr=0,delta_x,delta_y,distance; 
	int incx,incy,uRow,uCol; 
	delta_x=x2-x1; //计算坐标增量 
	delta_y=y2-y1; 
	uRow=x1; 
	uCol=y1; 
	if(delta_x>0)incx=1; //设置单步方向 
	else if(delta_x==0)incx=0;//垂直线 
	else {incx=-1;delta_x=-delta_x;} 
	if(delta_y>0)incy=1; 
	else if(delta_y==0)incy=0;//水平线 
	else{incy=-1;delta_y=-delta_y;} 
	if( delta_x>delta_y)distance=delta_x; //选取基本增量坐标轴 
	else distance=delta_y; 
	for(t=0;t<=distance+1;t++ )//画线输出 
	{  
		LCD_DrawPoint(uRow,uCol,color);//画点 
		xerr+=delta_x ; 
		yerr+=delta_y ; 
		if(xerr>distance) 
		{ 
			xerr-=distance; 
			uRow+=incx; 
		} 
		if(yerr>distance) 
		{ 
			yerr-=distance; 
			uCol+=incy; 
		} 
	}  
}    

/******************************************************************************
      函数说明：画矩形
      入口数据：x1,y1   起始坐标
                x2,y2   终止坐标
                color   矩形的颜色
      返回值：  无
******************************************************************************/
void LCD_DrawRectangle(u16 x1, u16 y1, u16 x2, u16 y2,u16 color)
{
	LCD_DrawLine(x1,y1,x2,y1,color);
	LCD_DrawLine(x1,y1,x1,y2,color);
	LCD_DrawLine(x1,y2,x2,y2,color);
	LCD_DrawLine(x2,y1,x2,y2,color);
}


/******************************************************************************
      函数说明：画圆
      入口数据：x0,y0   圆心坐标
                r       半径
                color   圆的颜色
      返回值：  无
******************************************************************************/
void Draw_Circle(u16 x0,u16 y0,u8 r,u16 color)
{
	int a,b;
	a=0;b=r;	  
	while(a<=b)
	{
		LCD_DrawPoint(x0-b,y0-a,color);             //3           
		LCD_DrawPoint(x0+b,y0-a,color);             //0           
		LCD_DrawPoint(x0-a,y0+b,color);             //1                
		LCD_DrawPoint(x0-a,y0-b,color);             //2             
		LCD_DrawPoint(x0+b,y0+a,color);             //4               
		LCD_DrawPoint(x0+a,y0-b,color);             //5
		LCD_DrawPoint(x0+a,y0+b,color);             //6 
		LCD_DrawPoint(x0-b,y0+a,color);             //7
		a++;
		if((a*a+b*b)>(r*r))//判断要画的点是否过远
		{
			b--;
		}
	}
}

/******************************************************************************
      函数说明：显示汉字串
      入口数据：x,y显示坐标
                *s 要显示的汉字串
                fc 字的颜色
                bc 字的背景色
                sizey 字号 可选 16 24 32
                mode:  0非叠加模式  1叠加模式
      返回值：  无
******************************************************************************/
void LCD_ShowChinese(u16 x,u16 y,u8 *s,u16 fc,u16 bc,u8 sizey)
{
	while(*s!=0)
	{
		if(sizey==12) {}
		else if(sizey==16) LCD_ShowChinese16x16(x,y,s,fc,bc,sizey);
		else return;
		s+=2;
		x+=sizey;
	}
}

/******************************************************************************
      函数说明：显示单个16x16汉字
      入口数据：x,y显示坐标
                *s 要显示的汉字
                fc 字的颜色
                bc 字的背景色
                sizey 字号
                mode:  0非叠加模式  1叠加模式
      返回值：  无
******************************************************************************/
void LCD_ShowChinese16x16(u16 x,u16 y,u8 *s,u16 fc,u16 bc,u8 sizey)
{
	u8 i,j;
	u16 k;
	u16 HZnum;//汉字数目
	u16 TypefaceNum;//一个字符所占字节大小
	u16 x0=x;
  TypefaceNum=(sizey/8+((sizey%8)?1:0))*sizey;
	HZnum=sizeof(tfont16)/sizeof(typFNT_GB16);	//统计汉字数目
	for(k=0;k<HZnum;k++) 
	{
		if ((tfont16[k].Index[0]==*(s))&&(tfont16[k].Index[1]==*(s+1)))
		{ 	
			for(i=0;i<TypefaceNum;i++)
			{
				for(j=0;j<8;j++)
				{	
					if(tfont16[k].Msk[i]&(0x01<<j))	LCD_DrawPoint(x,y,fc);//画一个点
					x++;
					if((x-x0)==sizey)
					{
						x=x0;
						y++;
						break;
					}
				}
			}
		}				  	
		continue;  //查找到对应点阵字库立即退出，防止多个汉字重复取模带来影响
	}
} 

//在指定位置显示一个字符
//x,y:起始坐标
//chr:要显示的字符:" "--->"~"
//size:字体大小 12/16
//mode:叠加方式(1)还是非叠加方式(0)
//color : 字符的颜色;
void LCD_ShowChar(uint16_t x, uint16_t y, char chr, uint8_t size, uint16_t fc, uint16_t bc, uint8_t mode)
{  							  
    uint8_t temp, t1, t;
    uint16_t y0 = y;
    uint8_t csize = 0;
    uint8_t *pfont = 0;

    csize = (size / 8 + ((size % 8) ? 1 : 0)) * (size / 2); /* 得到字体一个字符对应点阵集所占的字节数 */
    chr = chr - ' ';    /* 得到偏移后的值（ASCII字库是从空格开始取模，所以-' '就是对应字符的字库） */

    switch (size)
    {
        case 12:
            pfont = (uint8_t *)asc2_1206[chr];  /* 调用1206字体 */
            break;

        case 16:
            pfont = (uint8_t *)asc2_1608[chr];  /* 调用1608字体 */
            break;

        default:
            return ;
    }

    for (t = 0; t < csize; t++)
    {
        temp = pfont[t];    /* 获取字符的点阵数据 */

        for (t1 = 0; t1 < 8; t1++)   /* 一个字节8个点 */
        {
            if (temp & 0x80)        /* 有效点,需要显示 */
            {
                LCD_DrawPoint(x, y, fc);        /* 画点出来,要显示这个点 */
            }
            else if (mode == 0)     /* 无效点,不显示 */
            {
                LCD_DrawPoint(x, y, bc); /* 画背景色,相当于这个点不显示(注意背景色由全局变量控制) */
            }

            temp <<= 1; /* 移位, 以便获取下一个位的状态 */
            y++;

            if (y >= LCD_H)return;  /* 超区域了 */

            if ((y - y0) == size)   /* 显示完一列了? */
            {
                y = y0; /* y坐标复位 */
                x++;    /* x坐标递增 */

                if (x >= LCD_W)return;   /* x坐标超区域了 */

                break;
            }
        }
    }
}   


//显示字符串
//x,y:起点坐标
//width,height:区域大小  
//size:字体大小
//*p:字符串起始地址		  
void LCD_ShowString(u16 x,u16 y,char *p,u8 size,u16 fc,u16 bc)
{         
    while((*p<='~')&&(*p>=' '))//判断是不是非法字符!
    {       
        LCD_ShowChar(x,y,*p,size,fc,bc,0);
        x+=size/2;
        p++;
    }  
}

/******************************************************************************
      函数说明：显示图片
      入口数据：x,y起点坐标
                length 图片长度
                width  图片宽度
                pic[]  图片数组    
      返回值：  无
******************************************************************************/
void LCD_ShowPicture(u16 x,u16 y,u16 length,u16 width,const u8 pic[]) // OK
{
  u16 lcd_data_max;
	u16 data1,data2;
  u16 i,i2 = 0,k,t;
	u16 y_t = 0,x_t = 0;
  t = y * 160;
	for(k=0;k<length;k++)
	{
		y_t = k * 160;
		for(i=0;i<width;i++)
		{ 			
			lcd_data_max = y_t+i+x+t;
			data1 = pic[x_t+i+i2];
			i2++;
			data2 = pic[x_t+i+i2];
			lcd_data[lcd_data_max] = (data1<<8) | 	data2;
		}
		x_t += width;	
	}
}

void Display_Logo(void)
{
  LCD_ShowPicture(4,5,70,70,SGF_Logo);
}

void Logo_init(void)
{

	
	LCD_ShowPicture(45,5,70,70,SGF_Logo);
	SPI2_DMA_Send((u32)lcd_data,12800);	
	DMA1_CHANNEL1_Flag = 1;
	while(DMA1_CHANNEL1_Flag);
	delay_ms(500);
	
  if(Cubli.Cali_flag == 0)
	{
		Fill_Show(40,32,16,80,BLACK);
		LCD_ShowChinese(40,32,"电机未校准",BRRED,BLACK,16);
		SPI2_DMA_Send((u32)lcd_data,12800);	
		DMA1_CHANNEL1_Flag = 1;
		while(DMA1_CHANNEL1_Flag);
		delay_ms(500);delay_ms(500);delay_ms(500);delay_ms(500);delay_ms(500);
	}
}
