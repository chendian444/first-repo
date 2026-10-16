#include "MPU6500.h"

#define SPI1_CS1  gpio_bits_set(GPIOA,GPIO_PINS_4)
#define SPI1_CS0  gpio_bits_reset(GPIOA,GPIO_PINS_4)

u8 MPU6500_data[14];

void SPI1_Init(void)
{
	spi_init_type spi_init_struct;
	gpio_init_type gpio_initstructure;
  crm_periph_clock_enable(CRM_GPIOA_PERIPH_CLOCK, TRUE);
	gpio_default_para_init(&gpio_initstructure);	
	
	gpio_initstructure.gpio_out_type       = GPIO_OUTPUT_PUSH_PULL;
  gpio_initstructure.gpio_drive_strength = GPIO_DRIVE_STRENGTH_STRONGER;
  gpio_initstructure.gpio_pull           = GPIO_PULL_UP;
	gpio_initstructure.gpio_mode           = GPIO_MODE_MUX;
	gpio_initstructure.gpio_pins           = GPIO_PINS_5 | GPIO_PINS_6 | GPIO_PINS_7;
  gpio_init(GPIOA, &gpio_initstructure);
	
	gpio_initstructure.gpio_drive_strength = GPIO_DRIVE_STRENGTH_STRONGER;
  gpio_initstructure.gpio_out_type  = GPIO_OUTPUT_PUSH_PULL;
  gpio_initstructure.gpio_mode = GPIO_MODE_OUTPUT;
  gpio_initstructure.gpio_pins = GPIO_PINS_4;
  gpio_initstructure.gpio_pull = GPIO_PULL_NONE;
  gpio_init(GPIOA, &gpio_initstructure);

	gpio_bits_set(GPIOA,GPIO_PINS_4);
	
	spi_enable(SPI1, FALSE);
	
	crm_periph_clock_enable(CRM_SPI1_PERIPH_CLOCK, TRUE);
  spi_default_para_init(&spi_init_struct);
  spi_init_struct.transmission_mode = SPI_TRANSMIT_FULL_DUPLEX;
  spi_init_struct.master_slave_mode = SPI_MODE_MASTER;
  spi_init_struct.mclk_freq_division = SPI_MCLK_DIV_8;
  spi_init_struct.first_bit_transmission = SPI_FIRST_BIT_MSB;
  spi_init_struct.frame_bit_num = SPI_FRAME_8BIT;
  spi_init_struct.clock_polarity = SPI_CLOCK_POLARITY_HIGH; // SPI_CLOCK_POLARITY_LOW SPI_CLOCK_POLARITY_HIGH
  spi_init_struct.clock_phase = SPI_CLOCK_PHASE_2EDGE;      // SPI_CLOCK_PHASE_1EDGE SPI_CLOCK_PHASE_2EDGE
  spi_init_struct.cs_mode_selection = SPI_CS_SOFTWARE_MODE;
  spi_init(SPI1, &spi_init_struct);
	
  spi_enable(SPI1, TRUE);
	delay_ms(10);
} 



/***************************************************************/
static u8 SPI1_ReadWriteByte(u8 TxData)
{		
	u16 cnt=0;				 	
	while(spi_i2s_flag_get(SPI1, SPI_I2S_TDBE_FLAG) == RESET) //等待SPI发送标志位空
	{
		cnt++;
		if(cnt>200)return 0;
	}		
  SPI1->dt = TxData;	
	
	cnt=0;

	while(spi_i2s_flag_get(SPI1, SPI_I2S_RDBF_FLAG) == RESET) //等待SPI接收标志位空
	{
		cnt++;
		if(cnt>200)return 0;
	}	  						    
	return SPI1->dt; //接收数据					    
}
/***************************************************************/

u8 IMU_Write_Reg(u8 reg,u8 value)
{
	u8 status;
	SPI1_CS0;
	status = SPI1_ReadWriteByte(reg);
	SPI1_ReadWriteByte(value);
	SPI1_CS1;
	return(status);
}

u8 IMU_Read_Reg(u8 reg)
{
	u8 reg_val;
	SPI1_CS0;
	SPI1_ReadWriteByte(reg|0x80);
	reg_val=SPI1_ReadWriteByte(0xff);
	SPI1_CS1;
	return(reg_val);
}

u8 Who_Am_I = 0;

void IMU_Init(void)
{
	u8 i = 10;
	SPI1_Init();
	while(Who_Am_I != 0x70 && i > 0)
	{
		i--;
	  Who_Am_I = IMU_Read_Reg(MPU6500_WHO_AM_I); // 读取MPU6500地址
		delay_ms(1);
//		R_LED(3);
	}
//	R_LED(0);
	if(Who_Am_I != 0x70)
	{
		FaultBit.bit.IMU = 1; // IMU错误
//		R_LED(1);
	}
	else
	{
		delay_ms(10);
		IMU_Write_Reg(MPU6500_PWR_MGMT_1,0X80);   		
		delay_ms(10);
		IMU_Write_Reg(MPU6500_PWR_MGMT_1,0X01);   		
		delay_ms(10);
		IMU_Write_Reg(MPU6500_SIGNAL_PATH_RESET,0X07);
		delay_ms(10);
		IMU_Write_Reg(MPU6500_CONFIG,0);					
		delay_ms(10);
		IMU_Write_Reg(MPU6500_GYRO_CONFIG,0x18);  		
		delay_ms(10);
		IMU_Write_Reg(MPU6500_ACCEL_CONFIG,0x10); 		
		delay_ms(10);
	}
}

void Get_mpu6500(u8 *data)
{
	u8 i;
	SPI1_CS0;
	SPI1_ReadWriteByte(MPU6500_ACCEL_XOUT_H|0x80);
	for(i = 0;i < 14;i++)
	{
		data[i] = SPI1_ReadWriteByte(0xff);
	}
	SPI1_CS1;
}
