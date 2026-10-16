#include "app.h"
//#include "pic.h"

void SPI2_DMA_Init(void)
{ 	
  dma_init_type dma_init_struct;
	crm_periph_clock_enable(CRM_DMA1_PERIPH_CLOCK, TRUE);
	
	dma_reset(DMA1_CHANNEL1);
  dma_default_para_init(&dma_init_struct);
  dma_init_struct.buffer_size = 0;
  dma_init_struct.direction = DMA_DIR_MEMORY_TO_PERIPHERAL;
  dma_init_struct.memory_base_addr = (uint32_t)0;
  dma_init_struct.memory_data_width = DMA_MEMORY_DATA_WIDTH_HALFWORD;
  dma_init_struct.memory_inc_enable = TRUE;
  dma_init_struct.peripheral_base_addr = (uint32_t)&SPI2->dt;
  dma_init_struct.peripheral_data_width = DMA_PERIPHERAL_DATA_WIDTH_HALFWORD;
  dma_init_struct.peripheral_inc_enable = FALSE;
  dma_init_struct.priority = DMA_PRIORITY_MEDIUM;
  dma_init_struct.loop_mode_enable = FALSE;
  dma_init(DMA1_CHANNEL1, &dma_init_struct);
	
	dma_interrupt_enable(DMA1_CHANNEL1,DMA_FDT_INT,TRUE); // 开启发送中断
	
	nvic_priority_group_config(NVIC_PRIORITY_GROUP_4);
  nvic_irq_enable(DMA1_Channel1_IRQn, 3, 1);

	  /* config flexible dma for usart3 tx */
  dma_flexible_config(DMA1, FLEX_CHANNEL1, DMA_FLEXIBLE_SPI2_TX);
} 

void SPI2_DMA_Send(u32 mar,u16 ndtr)
{	
	DMA1_CHANNEL1->dtcnt = ndtr;
	DMA1_CHANNEL1->maddr = mar;
	dma_channel_enable(DMA1_CHANNEL1, TRUE);
}

u8 DMA1_CHANNEL1_Flag = 0;

void DMA1_Channel1_IRQHandler(void) 
{
	if(dma_flag_get(DMA1_FDT1_FLAG))
	{
		dma_channel_enable(DMA1_CHANNEL1, FALSE);
		dma_flag_clear(DMA1_FDT1_FLAG);
    DMA1_CHANNEL1_Flag = 0;
	}
}

void LCD_GPIO_Init(void)
{
  spi_init_type spi_init_struct;
	gpio_init_type gpio_initstructure;
  crm_periph_clock_enable(CRM_GPIOB_PERIPH_CLOCK, TRUE);
	gpio_default_para_init(&gpio_initstructure);	
	
	gpio_initstructure.gpio_out_type       = GPIO_OUTPUT_PUSH_PULL;
  gpio_initstructure.gpio_drive_strength = GPIO_DRIVE_STRENGTH_STRONGER;
  gpio_initstructure.gpio_pull           = GPIO_PULL_UP;
	gpio_initstructure.gpio_mode           = GPIO_MODE_MUX;
	gpio_initstructure.gpio_pins           = GPIO_PINS_13 | GPIO_PINS_15;
  gpio_init(GPIOB, &gpio_initstructure);
	
	gpio_initstructure.gpio_drive_strength = GPIO_DRIVE_STRENGTH_STRONGER;
  gpio_initstructure.gpio_out_type  = GPIO_OUTPUT_PUSH_PULL;
  gpio_initstructure.gpio_mode = GPIO_MODE_OUTPUT;
  gpio_initstructure.gpio_pins = GPIO_PINS_2 | GPIO_PINS_12 | GPIO_PINS_14;
  gpio_initstructure.gpio_pull = GPIO_PULL_UP;
  gpio_init(GPIOB, &gpio_initstructure);

	spi_enable(SPI2, FALSE);
	
	crm_periph_clock_enable(CRM_SPI2_PERIPH_CLOCK, TRUE);
  spi_default_para_init(&spi_init_struct);
  spi_init_struct.transmission_mode = SPI_TRANSMIT_HALF_DUPLEX_TX;
  spi_init_struct.master_slave_mode = SPI_MODE_MASTER;
  spi_init_struct.mclk_freq_division = SPI_MCLK_DIV_2;
  spi_init_struct.first_bit_transmission = SPI_FIRST_BIT_MSB;
  spi_init_struct.frame_bit_num = SPI_FRAME_8BIT;
  spi_init_struct.clock_polarity = SPI_CLOCK_POLARITY_HIGH; // SPI_CLOCK_POLARITY_LOW SPI_CLOCK_POLARITY_HIGH
  spi_init_struct.clock_phase = SPI_CLOCK_PHASE_2EDGE;      // SPI_CLOCK_PHASE_1EDGE SPI_CLOCK_PHASE_2EDGE
  spi_init_struct.cs_mode_selection = SPI_CS_SOFTWARE_MODE;
  spi_init(SPI2, &spi_init_struct);
	
	spi_i2s_dma_transmitter_enable(SPI2, TRUE);
  spi_enable(SPI2, TRUE);
	
	SPI2_DMA_Init();
//	LCD_Writ_Bus(0xff);//??????????????? 
}

void delay(int t)
{
	u8 i = t;
	while(i--);
//	i = t;
//	while(i--);
//	i = t;
//	while(i--);
//	i = t;
//	while(i--);
//	i = t;
//	while(i--);
}
/******************************************************************************
      函数说明：LCD串行数据写入函数
      入口数据：dat  要写入的串行数据
      返回值：  无
******************************************************************************/
u16 LCD_Writ_Bus(u8 dat)
{	 
	SPI2->dt = dat; 
  while(spi_i2s_flag_get(SPI2, SPI_I2S_TDBE_FLAG) == RESET);	//等待发送区空 
		
	return 0;
	
//  u8 retry=0;				 	
//	while(spi_i2s_flag_get(SPI2, SPI_I2S_TDBE_FLAG) == RESET) //等待SPI发送标志位空
//	{
//		retry++;
//		if(retry>200)return 0;
//	}			  
//	spi_i2s_data_transmit(SPI2, dat); //发送数据
//	return 0;

//	while(spi_i2s_flag_get(SPI2, SPI_I2S_RDBF_FLAG) == RESET) //等待SPI接收标志位空
//	{
//		retry++;
//		if(retry>200)return 0;
//	}	  						    
//	return spi_i2s_data_receive(SPI2); //接收数据					
}
/******************************************************************************
      函数说明：LCD写入数据
      入口数据：dat 写入的数据
      返回值：  无
******************************************************************************/
void LCD_WR_DATA8(u16 dat)
{
	LCD_CS_Clr();
	LCD_Writ_Bus(dat);
	delay(1);
	LCD_CS_Set();	  
}


/******************************************************************************
      函数说明：LCD写入数据
      入口数据：dat 写入的数据
      返回值：  无
******************************************************************************/
void LCD_WR_DATA(u16 dat)
{
	LCD_CS_Clr();
	LCD_Writ_Bus(dat>>8);
	LCD_Writ_Bus(dat);
	delay(1);
	LCD_CS_Set();	  
}


/******************************************************************************
      函数说明：LCD写入命令
      入口数据：dat 写入的命令
      返回值：  无
******************************************************************************/
void LCD_WR_REG(u8 dat)
{
	LCD_DC_Clr();//写命令
	LCD_CS_Clr();
	LCD_Writ_Bus(dat);
	delay(1);
	LCD_CS_Set();	  
	LCD_DC_Set();//写数据
}


/******************************************************************************
      函数说明：设置起始和结束地址
      入口数据：x1,x2 设置列的起始和结束地址
                y1,y2 设置行的起始和结束地址
      返回值：  无
******************************************************************************/
void LCD_Address_Set(u16 x1,u16 y1,u16 x2,u16 y2)
{
	LCD_WR_REG(0x2a);//列地址设置
	LCD_WR_DATA(x1+1);
	LCD_WR_DATA(x2+1);
	LCD_WR_REG(0x2b);//行地址设置
	LCD_WR_DATA(y1+26);
	LCD_WR_DATA(y2+26);
	LCD_WR_REG(0x2c);//储存器写
}

void LCD_Init(void)
{
	LCD_GPIO_Init();//初始化GPIO
	
	LCD_RES_Clr();//复位
	delay_ms(100);
	LCD_RES_Set();
	delay_ms(100);	
	
	LCD_WR_REG(0x11);     //Sleep out
	delay_ms(120);                //Delay 120ms
	LCD_WR_REG(0xB1);     //Normal mode
	LCD_WR_DATA8(0x05);   
	LCD_WR_DATA8(0x3C);   
	LCD_WR_DATA8(0x3C);   
	
	LCD_WR_REG(0xB2);     //Idle mode
	LCD_WR_DATA8(0x05);   
	LCD_WR_DATA8(0x3C);   
	LCD_WR_DATA8(0x3C);   
	
	LCD_WR_REG(0xB3);     //Partial mode
	LCD_WR_DATA8(0x05);   
	LCD_WR_DATA8(0x3C);   
	LCD_WR_DATA8(0x3C);   
	LCD_WR_DATA8(0x05);   
	LCD_WR_DATA8(0x3C);   
	LCD_WR_DATA8(0x3C);  
	
	LCD_WR_REG(0xB4);     //Dot inversion
	
	LCD_WR_REG(0xC0);     //AVDD GVDD
	LCD_WR_DATA8(0x0E);   
	LCD_WR_DATA8(0x0B);   
	LCD_WR_DATA8(0x04);  
	
	LCD_WR_REG(0xC1);     //VGH VGL
	LCD_WR_DATA8(0xC0);   //C0
	
	LCD_WR_REG(0xC2);     //Normal Mode
	LCD_WR_DATA8(0x0D);   
	LCD_WR_DATA8(0x00);   
	
	LCD_WR_REG(0xC3);     //Idle
	LCD_WR_DATA8(0x8D);   
	LCD_WR_DATA8(0x2A);   
	
	LCD_WR_REG(0xC4);     //Partial+Full
	LCD_WR_DATA8(0x8D);   
	LCD_WR_DATA8(0xEE);  
	
	LCD_WR_REG(0xC5);     //VCOM
	LCD_WR_DATA8(0x04);   
	
	LCD_WR_REG(0xE0);     //positive gamma
	LCD_WR_DATA8(0x05);   
	LCD_WR_DATA8(0x1A);   
	LCD_WR_DATA8(0x0B);   
	LCD_WR_DATA8(0x15);   
	LCD_WR_DATA8(0x3D);   
	LCD_WR_DATA8(0x38);   
	LCD_WR_DATA8(0x2E);   
	LCD_WR_DATA8(0x30);   
	LCD_WR_DATA8(0x2D);   
	LCD_WR_DATA8(0x28);   
	LCD_WR_DATA8(0x30);   
	LCD_WR_DATA8(0x3B);   
	LCD_WR_DATA8(0x00);   
	LCD_WR_DATA8(0x01);   
	LCD_WR_DATA8(0x02);   
	LCD_WR_DATA8(0x10); 
  
	LCD_WR_REG(0xE1);     //negative gamma
	LCD_WR_DATA8(0x05);   
	LCD_WR_DATA8(0x1A);   
	LCD_WR_DATA8(0x0B);   
	LCD_WR_DATA8(0x15);   
	LCD_WR_DATA8(0x36);   
	LCD_WR_DATA8(0x2E);   
	LCD_WR_DATA8(0x28);   
	LCD_WR_DATA8(0x2B);   
	LCD_WR_DATA8(0x2B);   
	LCD_WR_DATA8(0x28);   
	LCD_WR_DATA8(0x30);   
	LCD_WR_DATA8(0x3B);   
	LCD_WR_DATA8(0x00);   
	LCD_WR_DATA8(0x01);   
	LCD_WR_DATA8(0x02);   
	LCD_WR_DATA8(0x10);
		 
//	LCD_WR_REG(0xFC);    
//	LCD_WR_DATA8(0x80);  
		
	LCD_WR_REG(0x3A);     
	LCD_WR_DATA8(0x05);   
	LCD_WR_REG(0x36);
	if(USE_HORIZONTAL==0)LCD_WR_DATA8(0x08);
	else if(USE_HORIZONTAL==1)LCD_WR_DATA8(0xC8);
	else if(USE_HORIZONTAL==2)LCD_WR_DATA8(0x78);
	else LCD_WR_DATA8(0xA8);   
	LCD_WR_REG(0x21);     //Display inversion
	LCD_WR_REG(0x29);     //Display on
//	delay_ms(50);
	LCD_Fill(0,0,LCD_W,LCD_H,BLACK);
//	delay_ms(5);
//	LCD_Address_Set(0,0,160-1,80-1);
  LCD_Address_Set(0,0,160-1,80-1);
	SPI2->ctrl1_bit.fbn = SPI_FRAME_16BIT;
	LCD_CS_Clr();
}

void LCD_Init1(void)
{
	LCD_GPIO_Init();//初始化GPIO
	
	LCD_RES_Clr();//复位
	delay_ms(100);
	LCD_RES_Set();
	delay_ms(100);	
	
	LCD_WR_REG(0x11);     //Sleep out
	delay_ms(120);                //Delay 120ms
	LCD_WR_REG(0xB1);     //Normal mode
	LCD_WR_DATA8(0x05);   
	LCD_WR_DATA8(0x3C);   
	LCD_WR_DATA8(0x3C);   
	
	LCD_WR_REG(0xB2);     //Idle mode
	LCD_WR_DATA8(0x05);   
	LCD_WR_DATA8(0x3C);   
	LCD_WR_DATA8(0x3C);   
	
	LCD_WR_REG(0xB3);     //Partial mode
	LCD_WR_DATA8(0x05);   
	LCD_WR_DATA8(0x3C);   
	LCD_WR_DATA8(0x3C);   
	LCD_WR_DATA8(0x05);   
	LCD_WR_DATA8(0x3C);   
	LCD_WR_DATA8(0x3C);  
	
	LCD_WR_REG(0xB4);     //Dot inversion
	LCD_WR_DATA8(0x03);   
	
	LCD_WR_REG(0xC0);     //AVDD GVDD
	LCD_WR_DATA8(0x0E);   
	LCD_WR_DATA8(0x0B);   
	LCD_WR_DATA8(0x04);  
	
	LCD_WR_REG(0xC1);     //VGH VGL
	LCD_WR_DATA8(0xC0);   //C0
	
	LCD_WR_REG(0xC2);     //Normal Mode
	LCD_WR_DATA8(0x0D);   
	LCD_WR_DATA8(0x00);   
	
	LCD_WR_REG(0xC3);     //Idle
	LCD_WR_DATA8(0x8D);   
	LCD_WR_DATA8(0x2A);   
	
	LCD_WR_REG(0xC4);     //Partial+Full
	LCD_WR_DATA8(0x8D);   
	LCD_WR_DATA8(0xEE);  
	
	LCD_WR_REG(0xC5);     //VCOM
	LCD_WR_DATA8(0x04);   
	
	LCD_WR_REG(0xE0);     //positive gamma
	LCD_WR_DATA8(0x05);   
	LCD_WR_DATA8(0x1A);   
	LCD_WR_DATA8(0x0B);   
	LCD_WR_DATA8(0x15);   
	LCD_WR_DATA8(0x3D);   
	LCD_WR_DATA8(0x38);   
	LCD_WR_DATA8(0x2E);   
	LCD_WR_DATA8(0x30);   
	LCD_WR_DATA8(0x2D);   
	LCD_WR_DATA8(0x28);   
	LCD_WR_DATA8(0x30);   
	LCD_WR_DATA8(0x3B);   
	LCD_WR_DATA8(0x00);   
	LCD_WR_DATA8(0x01);   
	LCD_WR_DATA8(0x02);   
	LCD_WR_DATA8(0x10); 
  
	LCD_WR_REG(0xE1);     //negative gamma
	LCD_WR_DATA8(0x05);   
	LCD_WR_DATA8(0x1A);   
	LCD_WR_DATA8(0x0B);   
	LCD_WR_DATA8(0x15);   
	LCD_WR_DATA8(0x36);   
	LCD_WR_DATA8(0x2E);   
	LCD_WR_DATA8(0x28);   
	LCD_WR_DATA8(0x2B);   
	LCD_WR_DATA8(0x2B);   
	LCD_WR_DATA8(0x28);   
	LCD_WR_DATA8(0x30);   
	LCD_WR_DATA8(0x3B);   
	LCD_WR_DATA8(0x00);   
	LCD_WR_DATA8(0x01);   
	LCD_WR_DATA8(0x02);   
	LCD_WR_DATA8(0x10);
		 
//	LCD_WR_REG(0xFC);    
//	LCD_WR_DATA8(0x80);  
		
	LCD_WR_REG(0x3A);     
	LCD_WR_DATA8(0x05);   
	LCD_WR_REG(0x36);
	if(USE_HORIZONTAL==0)LCD_WR_DATA8(0x08);
	else if(USE_HORIZONTAL==1)LCD_WR_DATA8(0xC8);
	else if(USE_HORIZONTAL==2)LCD_WR_DATA8(0x78);
	else LCD_WR_DATA8(0xA8);   
//	LCD_WR_REG(0x21);     //Display inversion
	LCD_WR_REG(0x29);     //Display on
	
	delay_ms(10);
	LCD_Address_Set(0,0,160-1,80-1);
	SPI2->ctrl1_bit.fbn = SPI_FRAME_16BIT;
	LCD_CS_Clr();
}








