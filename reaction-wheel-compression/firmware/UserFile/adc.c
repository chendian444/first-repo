
#include "app.h"

uint16_t ADC_ConvertedValue[3];

static void gpio_config(void)
{
  gpio_init_type gpio_initstructure;
  crm_periph_clock_enable(CRM_GPIOC_PERIPH_CLOCK, TRUE);

  gpio_default_para_init(&gpio_initstructure);
  gpio_initstructure.gpio_mode = GPIO_MODE_ANALOG;
  gpio_initstructure.gpio_pins = GPIO_PINS_0 | GPIO_PINS_2 | GPIO_PINS_3; 
  gpio_init(GPIOC, &gpio_initstructure);
}

static void dma_config(void)
{
  dma_init_type dma_init_struct;
  crm_periph_clock_enable(CRM_DMA1_PERIPH_CLOCK, TRUE);

  dma_reset(DMA1_CHANNEL2);
  dma_default_para_init(&dma_init_struct);
  dma_init_struct.buffer_size = 3;
  dma_init_struct.direction = DMA_DIR_PERIPHERAL_TO_MEMORY;
  dma_init_struct.memory_base_addr = (uint32_t)ADC_ConvertedValue;
  dma_init_struct.memory_data_width = DMA_MEMORY_DATA_WIDTH_HALFWORD;
  dma_init_struct.memory_inc_enable = TRUE;
  dma_init_struct.peripheral_base_addr = (uint32_t)&(ADC3->odt);
  dma_init_struct.peripheral_data_width = DMA_PERIPHERAL_DATA_WIDTH_HALFWORD;
  dma_init_struct.peripheral_inc_enable = FALSE;
  dma_init_struct.priority = DMA_PRIORITY_HIGH;
  dma_init_struct.loop_mode_enable = TRUE;
  dma_init(DMA1_CHANNEL2, &dma_init_struct);
  
	dma_flexible_config(DMA1, FLEX_CHANNEL2, DMA_FLEXIBLE_ADC3);
	
  dma_channel_enable(DMA1_CHANNEL2, TRUE);
}

static void adc_config(void)
{
  adc_base_config_type adc_base_struct;
  crm_periph_clock_enable(CRM_ADC3_PERIPH_CLOCK, TRUE);
  crm_adc_clock_div_set(CRM_ADC_DIV_6); // 120M / 6 = 20M , ADCCLK 不可大于 28MHz

  /* select combine mode */
  adc_combine_mode_select(ADC_INDEPENDENT_MODE);
  adc_base_default_para_init(&adc_base_struct);
  adc_base_struct.sequence_mode = TRUE;
  adc_base_struct.repeat_mode = TRUE;
  adc_base_struct.data_align = ADC_RIGHT_ALIGNMENT;
  adc_base_struct.ordinary_channel_length = 3;
  adc_base_config(ADC3, &adc_base_struct);
	
  adc_ordinary_channel_set(ADC3, ADC_CHANNEL_10, 1, ADC_SAMPLETIME_239_5);
	adc_ordinary_channel_set(ADC3, ADC_CHANNEL_12, 2, ADC_SAMPLETIME_239_5);
	adc_ordinary_channel_set(ADC3, ADC_CHANNEL_13, 3, ADC_SAMPLETIME_239_5);

  adc_ordinary_conversion_trigger_set(ADC3, ADC3_ORDINARY_TRIG_SOFTWARE, TRUE);
  adc_dma_mode_enable(ADC3, TRUE);

  adc_enable(ADC3, TRUE);
  adc_calibration_init(ADC3);
  while(adc_calibration_init_status_get(ADC3));
  adc_calibration_start(ADC3);
  while(adc_calibration_status_get(ADC3));
	
	adc_ordinary_software_trigger_enable(ADC3, TRUE);
}

void TriggerADC_Init(void)
{
	gpio_init_type gpio_initstructure;
	adc_base_config_type adc_base_struct;
	
  crm_periph_clock_enable(CRM_GPIOA_PERIPH_CLOCK, TRUE);
	crm_periph_clock_enable(CRM_GPIOC_PERIPH_CLOCK, TRUE);
  crm_periph_clock_enable(CRM_ADC1_PERIPH_CLOCK, TRUE);
	crm_periph_clock_enable(CRM_ADC2_PERIPH_CLOCK, TRUE);
	crm_periph_clock_enable(CRM_ADC3_PERIPH_CLOCK, TRUE);
	crm_periph_clock_enable(CRM_IOMUX_PERIPH_CLOCK, TRUE); // 重映射时钟
	
  crm_adc_clock_div_set(CRM_ADC_DIV_6); // 120M / 6 = 20M , ADCCLK 不可大于 28MHz
	nvic_irq_enable(ADC1_2_IRQn, 0, 0);
	nvic_irq_enable(ADC3_IRQn,   0, 1);
	
  gpio_default_para_init(&gpio_initstructure);
  gpio_initstructure.gpio_mode = GPIO_MODE_ANALOG;
  gpio_initstructure.gpio_pins = GPIO_PINS_1; // ADC123_IN0 ~ ADC123_IN1
  gpio_init(GPIOA, &gpio_initstructure);
  
	gpio_default_para_init(&gpio_initstructure);
  gpio_initstructure.gpio_mode = GPIO_MODE_ANALOG;
  gpio_initstructure.gpio_pins = GPIO_PINS_0 | GPIO_PINS_1 | GPIO_PINS_2 | GPIO_PINS_3 | GPIO_PINS_4 | GPIO_PINS_5; // ADC123_IN10 ~ ADC123_IN13
  gpio_init(GPIOC, &gpio_initstructure);
	
	/* select combine mode */
  //adc_combine_mode_select(ADC_INDEPENDENT_MODE);
	
  adc_base_default_para_init(&adc_base_struct);
  adc_base_struct.sequence_mode = TRUE;
  adc_base_struct.repeat_mode = TRUE;
  adc_base_struct.data_align = ADC_RIGHT_ALIGNMENT;
  adc_base_config(ADC1, &adc_base_struct);
	
	adc_base_default_para_init(&adc_base_struct);
  adc_base_struct.sequence_mode = TRUE;
  adc_base_struct.repeat_mode = TRUE;
  adc_base_struct.data_align = ADC_RIGHT_ALIGNMENT;
	adc_base_config(ADC2, &adc_base_struct);
	
	adc_base_default_para_init(&adc_base_struct);
  adc_base_struct.sequence_mode = TRUE;
  adc_base_struct.repeat_mode = TRUE;
  adc_base_struct.data_align = ADC_RIGHT_ALIGNMENT;
	adc_base_config(ADC3, &adc_base_struct);
	
	adc_preempt_channel_length_set(ADC1, 3);
	adc_preempt_channel_length_set(ADC2, 2);
	adc_preempt_channel_length_set(ADC3, 2);
	
  adc_preempt_channel_set(ADC1, ADC_CHANNEL_15, 1, ADC_SAMPLETIME_55_5);
  adc_preempt_channel_set(ADC1, ADC_CHANNEL_14, 2, ADC_SAMPLETIME_55_5);
	adc_preempt_channel_set(ADC1, ADC_CHANNEL_1 , 3, ADC_SAMPLETIME_55_5);
	
	adc_preempt_channel_set(ADC2, ADC_CHANNEL_13, 1, ADC_SAMPLETIME_55_5);
  adc_preempt_channel_set(ADC2, ADC_CHANNEL_12, 2, ADC_SAMPLETIME_55_5);
	
	adc_preempt_channel_set(ADC3, ADC_CHANNEL_10, 1, ADC_SAMPLETIME_55_5);
  adc_preempt_channel_set(ADC3, ADC_CHANNEL_11, 2, ADC_SAMPLETIME_55_5);
	
  adc_preempt_conversion_trigger_set(ADC1, ADC12_PREEMPT_TRIG_TMR1CH4, TRUE);
	
	gpio_pin_remap_config(ADC2_ETP_MUX,TRUE); //外设重映射 ADC2 抢占转换外部触发连接到 TMR8 通道 4
	adc_preempt_conversion_trigger_set(ADC2, ADC12_PREEMPT_TRIG_EXINT15_TMR8CH4, TRUE);
	
	adc_preempt_conversion_trigger_set(ADC3, ADC3_PREEMPT_TRIG_TMR4CH3, TRUE);
	
  adc_preempt_auto_mode_enable(ADC1, TRUE);
  adc_interrupt_enable(ADC1, ADC_PCCE_INT, TRUE);
  adc_dma_mode_enable(ADC1, TRUE);
	
	adc_enable(ADC1, TRUE);
  adc_calibration_init(ADC1);
  while(adc_calibration_init_status_get(ADC1));
  adc_calibration_start(ADC1);
  while(adc_calibration_status_get(ADC1));
	
	adc_preempt_auto_mode_enable(ADC2, TRUE);
  adc_interrupt_enable(ADC2, ADC_PCCE_INT, TRUE);
  adc_dma_mode_enable(ADC2, TRUE);
	
	adc_enable(ADC2, TRUE);
  adc_calibration_init(ADC2);
  while(adc_calibration_init_status_get(ADC2));
  adc_calibration_start(ADC2);
  while(adc_calibration_status_get(ADC2));
	
	adc_preempt_auto_mode_enable(ADC3, TRUE);
  adc_interrupt_enable(ADC3, ADC_PCCE_INT, TRUE);
  adc_dma_mode_enable(ADC3, TRUE);
	
	adc_enable(ADC3, TRUE);
  adc_calibration_init(ADC3);
  while(adc_calibration_init_status_get(ADC3));
  adc_calibration_start(ADC3);
  while(adc_calibration_status_get(ADC3));
}

void ConventionalADC_Init(void)
{
	gpio_config();
  dma_config();
  adc_config();
	adc_ordinary_software_trigger_enable(ADC3, TRUE);
}

void ADC_Config(void)
{
//	ConventionalADC_Init();
	TriggerADC_Init();
}


void Get_InputVolt(void)
{
	Cubli.BatVin_filter += (Cubli.BatVin - Cubli.BatVin_filter) * 0.01f;
}

void Get_ADCTemp(void)
{
	M1_Foc.temp = 0;
	M2_Foc.temp = 0;
}


void ADC1_2_IRQHandler(void) 
{
	float ad;
  if(adc_flag_get(ADC1, ADC_PCCE_FLAG) != RESET)
  {
    adc_flag_clear(ADC1, ADC_PCCE_FLAG);
		
		ad = (ADC1->pdt3_bit.pdt3 * 3.3f)/4096.0f;
		Cubli.BatVin = (10.0f*ad)/1.0f+ad; 
		if(Cubli.BatVin > 30.0f)
		{
			gpio_bits_reset(GPIOA,GPIO_PINS_15);
		}
	
		M1_FOC_handle(Read_M1_Encoder());
  }
	if(adc_flag_get(ADC2, ADC_PCCE_FLAG) != RESET)
  {
    adc_flag_clear(ADC2, ADC_PCCE_FLAG);
		M2_FOC_handle(Read_M2_Encoder());
  }
}

void ADC3_IRQHandler(void) 
{
	if(adc_flag_get(ADC3, ADC_PCCE_FLAG) != RESET)
  {
    adc_flag_clear(ADC3, ADC_PCCE_FLAG);
		M3_FOC_handle(Read_M3_Encoder());
  }
}
