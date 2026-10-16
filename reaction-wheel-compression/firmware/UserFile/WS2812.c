

#include "app.h"

uint16_t WS2812_Buffer[24*72+1];
uint32_t RGB_Data[72];
uint16_t WS2812_data[24+1];
uint8_t Brightness;
void WS2812_init(void)
{
  tmr_output_config_type tmr_oc_init_structure;
	gpio_init_type gpio_initstructure;
  dma_init_type dma_init_struct;
	crm_periph_clock_enable(CRM_DMA1_PERIPH_CLOCK, TRUE);
	crm_periph_clock_enable(CRM_TMR3_PERIPH_CLOCK, TRUE);
	crm_periph_clock_enable(CRM_GPIOB_PERIPH_CLOCK, TRUE);
	
	gpio_initstructure.gpio_out_type       = GPIO_OUTPUT_PUSH_PULL;
  gpio_initstructure.gpio_drive_strength = GPIO_DRIVE_STRENGTH_STRONGER;
  gpio_initstructure.gpio_pull           = GPIO_PULL_UP;
	gpio_initstructure.gpio_mode           = GPIO_MODE_MUX;
	gpio_initstructure.gpio_pins           = GPIO_PINS_0|GPIO_PINS_1;
  gpio_init(GPIOB, &gpio_initstructure);
	
 	tmr_base_init(TMR3,145,1);
	tmr_clock_source_div_set(TMR3, TMR_CLOCK_DIV1);

  tmr_output_default_para_init(&tmr_oc_init_structure);
  tmr_oc_init_structure.oc_mode = TMR_OUTPUT_CONTROL_PWM_MODE_A;
  tmr_oc_init_structure.oc_idle_state = FALSE;
  tmr_oc_init_structure.oc_polarity = TMR_OUTPUT_ACTIVE_HIGH;
  tmr_oc_init_structure.oc_output_state = TRUE;

  tmr_output_channel_config(TMR3, TMR_SELECT_CHANNEL_3, &tmr_oc_init_structure);
  tmr_channel_value_set(TMR3, TMR_SELECT_CHANNEL_3,35);
  tmr_output_channel_buffer_enable(TMR3, TMR_SELECT_CHANNEL_3, TRUE);
	
	tmr_output_channel_config(TMR3, TMR_SELECT_CHANNEL_4, &tmr_oc_init_structure);
  tmr_channel_value_set(TMR3, TMR_SELECT_CHANNEL_4,35);
  tmr_output_channel_buffer_enable(TMR3, TMR_SELECT_CHANNEL_4, TRUE);
	
	/* enable tmr3 overflow dma request */
  tmr_dma_request_enable(TMR3, TMR_C3_DMA_REQUEST, TRUE);
	tmr_dma_request_enable(TMR3, TMR_C4_DMA_REQUEST, TRUE);
//	tmr_period_buffer_enable(TMR5, TRUE);
	/* tmr enable counter */

	
	dma_reset(DMA1_CHANNEL3);
  dma_init_struct.buffer_size = 0;
  dma_init_struct.direction = DMA_DIR_MEMORY_TO_PERIPHERAL;
  dma_init_struct.memory_base_addr = (uint32_t)WS2812_Buffer;
  dma_init_struct.memory_data_width = DMA_MEMORY_DATA_WIDTH_HALFWORD;
  dma_init_struct.memory_inc_enable = TRUE;
  dma_init_struct.peripheral_base_addr = (uint32_t)&TMR3->c3dt;
  dma_init_struct.peripheral_data_width = DMA_PERIPHERAL_DATA_WIDTH_HALFWORD;
  dma_init_struct.peripheral_inc_enable = FALSE;
  dma_init_struct.priority = DMA_PRIORITY_MEDIUM;
  dma_init_struct.loop_mode_enable = FALSE;
  dma_init(DMA1_CHANNEL3, &dma_init_struct);
	
  dma_reset(DMA1_CHANNEL4);
  dma_init_struct.buffer_size = 0;
  dma_init_struct.direction = DMA_DIR_MEMORY_TO_PERIPHERAL;
  dma_init_struct.memory_base_addr = (uint32_t)WS2812_data;
  dma_init_struct.memory_data_width = DMA_MEMORY_DATA_WIDTH_HALFWORD;
  dma_init_struct.memory_inc_enable = TRUE;
  dma_init_struct.peripheral_base_addr = (uint32_t)&TMR3->c4dt;
  dma_init_struct.peripheral_data_width = DMA_PERIPHERAL_DATA_WIDTH_HALFWORD;
  dma_init_struct.peripheral_inc_enable = FALSE;
  dma_init_struct.priority = DMA_PRIORITY_MEDIUM;
  dma_init_struct.loop_mode_enable = FALSE;
  dma_init(DMA1_CHANNEL4, &dma_init_struct);

  /* enable transfer full data intterrupt */
	dma_interrupt_enable(DMA1_CHANNEL3, DMA_FDT_INT, TRUE);
  dma_interrupt_enable(DMA1_CHANNEL4, DMA_FDT_INT, TRUE);

  /* dma2 channel1 interrupt nvic init */
  nvic_priority_group_config(NVIC_PRIORITY_GROUP_4);
	nvic_irq_enable(DMA1_Channel3_IRQn, 5, 0);
  nvic_irq_enable(DMA1_Channel4_IRQn, 5, 1);

  /* tmr3 flexible function enable */
  dma_flexible_config(DMA1, FLEX_CHANNEL3, DMA_FLEXIBLE_TMR3_CH3);
  dma_flexible_config(DMA1, FLEX_CHANNEL4, DMA_FLEXIBLE_TMR3_CH4);
//  /* enable dma channel */
//  dma_channel_enable(DMA2_CHANNEL1, TRUE);
	
  tmr_counter_enable(TMR3, TRUE);
	TMR3->c3dt = 0;
	TMR3->c4dt = 0;
}

void SetBrightness(uint8_t brightness)
{
    if (brightness > 255)
        brightness = 255;
    Brightness = brightness;
}

// 在 send_Data 和 Send_RGB 中调整颜色值
void send_Data(uint32_t *rgb, uint16_t len)
{
    uint16_t i, t, c = 0;
    uint8_t r, g, b;

    for (; len > 0; len--) {
        r = ((rgb[c] & 0xff0000) >> 16) * Brightness / 255;
        g = ((rgb[c] & 0x00ff00) >> 8) * Brightness / 255;
        b = (rgb[c] & 0xff) * Brightness / 255;
        c++;

        for (i = 0; i < 8; i++) {
            WS2812_Buffer[i + t] = (0x80 & g) > 0 ? RGB_1 : RGB_0;
            g <<= 1;
        }
        for (i = 0; i < 8; i++) {
            WS2812_Buffer[8 + i + t] = (0x80 & r) > 0 ? RGB_1 : RGB_0;
            r <<= 1;
        }
        for (i = 0; i < 8; i++) {
            WS2812_Buffer[16 + i + t] = (0x80 & b) > 0 ? RGB_1 : RGB_0;
            b <<= 1;
        }
        t += 24;
    }

    WS2812_Buffer[24 * 72] = 0;

    DMA1_CHANNEL3->dtcnt = 24 * 72 + 1;
    dma_channel_enable(DMA1_CHANNEL3, TRUE);
}

void Send_RGB(uint32_t rgb)
{
    uint16_t i;
    uint8_t r, g, b;

    r = ((rgb & 0xff0000) >> 16) * Brightness / 255;
    g = ((rgb & 0x00ff00) >> 8) * Brightness / 255;
    b = (rgb & 0xff) * Brightness / 255;

    for (i = 0; i < 8; i++) {
        WS2812_data[i] = (0x80 & g) > 0 ? RGB_1 : RGB_0;
        g <<= 1;
    }
    for (i = 0; i < 8; i++) {
        WS2812_data[8 + i] = (0x80 & r) > 0 ? RGB_1 : RGB_0;
        r <<= 1;
    }
    for (i = 0; i < 8; i++) {
        WS2812_data[16 + i] = (0x80 & b) > 0 ? RGB_1 : RGB_0;
        b <<= 1;
    }

    WS2812_data[24] = 0;

    DMA1_CHANNEL4->dtcnt = 25;
    dma_channel_enable(DMA1_CHANNEL4, TRUE);
}

u8 WS2812_Flag3,WS2812_Flag4;

void DMA1_Channel3_IRQHandler(void) 
{
	if(dma_flag_get(DMA1_FDT3_FLAG))
	{
		dma_channel_enable(DMA1_CHANNEL3, FALSE);
//		tmr_counter_enable(TMR3, FALSE);
		dma_flag_clear(DMA1_FDT3_FLAG);
    WS2812_Flag3 = 0;
	}
}

void DMA1_Channel4_IRQHandler(void) 
{
	if(dma_flag_get(DMA1_FDT4_FLAG))
	{
		dma_channel_enable(DMA1_CHANNEL4, FALSE);
//		tmr_counter_enable(TMR3, FALSE);
		dma_flag_clear(DMA1_FDT4_FLAG);
    WS2812_Flag4 = 0;
	}
}

uint32_t Wheel(uint32_t pos)
{
	uint32_t  WheelPos = pos % 0xff;
	if (WheelPos < 85) {
		return ((255 - WheelPos * 3) << 16) | ((WheelPos * 3) << 8);
	}
	if (WheelPos < 170) {
		WheelPos -= 85;
		return (((255 - WheelPos * 3) << 8) | (WheelPos * 3));
	}
	WheelPos -= 170;
	return ((WheelPos * 3) << 16 | (255 - WheelPos * 3));
}

