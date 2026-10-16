#ifndef __Encoder_H
#define __Encoder_H
#include "app.h"

#define SPI3_CS1_0  gpio_bits_reset(GPIOC,GPIO_PINS_11)
#define SPI3_CS1_1  gpio_bits_set(GPIOC,GPIO_PINS_11)
#define SPI3_CS2_0  gpio_bits_reset(GPIOC,GPIO_PINS_12);
#define SPI3_CS2_1  gpio_bits_set(GPIOC,GPIO_PINS_12);
#define SPI3_CS3_0  gpio_bits_reset(GPIOD,GPIO_PINS_2);
#define SPI3_CS3_1  gpio_bits_set(GPIOD,GPIO_PINS_2);

void TLE5012B_Init(void);

u16 Read_M1_Encoder(void);
u16 Read_M2_Encoder(void);
u16 Read_M3_Encoder(void);

#endif
