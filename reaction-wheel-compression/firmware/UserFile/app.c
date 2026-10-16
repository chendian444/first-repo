/*

                                                                                                
                                    ~*~~{~%~~(!!~u0~5~~~~~~!                                    
                              ~~~~~K~!~[!Nhn~!~~t~~~*~k{~~!~~~!!~~                              
                          !~C~~~~@@!~~,!~~~~        ~~~!~~S>d~>~~~~~~~                          
                        ~|De~~TE!~~~                        ;~Y~Z~~~A~~x                        
                    ~!~~~~.q!~            ]~!~3w`~L!              ~P~~~~,SZ~                    
                  ~d~~~K!~          x~Ga!>P~~!g~              ~~F~    ;#~ug~~!                  
                ~~~~~M~~          !p!~~!~~                  ~~~~~V~~M6  ~~~Z~T~~                
              f~!c?&!)        !}N~~!p~Z~                  ~M~=B~$~j3!?q.  ~\a2!~2Z              
            ~~H!k~          x~~~~~o~                    (~~y~q9~[jx~~~k~M~    ~x!}~"            
          ~~\~~~xc        ~Q~P!~\,                      ~~,~*~6~c\~~~~X~!!M!    ~~N~!]          
          !~~S0~        M~Z~K~z^            ~y0!      !l~!b1k~~~\~2!!~3~!~1[    ~~!~<-          
        ~~~A~~        ~~~.~~~!          ~!!~~$~>~!~~  ~T~~~!~~xA5i  ~@+~qW~R[3    S~cb~~        
      !~>!~~        2L(~Y~%~        ~MiK!!~!~~"x~~!~  ~?)~~!f!        !~~v~~~~      A~U~q!      
      o`~_~~      !~(DT~x~        d~~H~H~~~~~ON~!~  ~~~$~'!~            i!~Pd~!~    !j/~-~      
    ~*~:7~      ~~~~'8!~      bi~!~%w!uv~~=~~<s~~w  ~!57~p~w              ~~~~f~      i~~~!i    
    I~~(,F      #)YDq~~!    k~~qwm~f  4~~~fe~~_~J~  ~~!8~m                ?!~1~-      ~DK!!!    
    ~~~~'~    !~Q[~~~~~-    ~~~!      ~|~~A!~~~~    u~!~g!                  Tp!8~:      !R~j    
  ~~n~~~      ~!~~~~L7~~            ~~T!~~[~~W    !f~~D~                    Y~!(~~      ~~~~!l  
  ~)~!"P      @mO~~V~2~!          ~~~v!~~~!!K~    ~~E:$~                      ~@F8      G!~!p~  
  ~~~~!~      @jQ~~!M~~b~x~^!~~~~~~~~~~m~Bi+      R~~!:~~~~X!!                1~~!~!    ~4~~!9  
  !/!^~n      !~~!h~~~7!~~C-K~~!~~wT.~0!t~u~f~    ~~~~G^-~~~~j~!                (~iB    ~~~~~~  
  ~~~J        ~!~~~i~~~O~~r!~/'~~~~~~~~mG~~K~~    6|~)Q~~~+!~"~~                  V~      uA~!  
  ;;~~            =?]~~~~~  z!!~~!~~c~~~.~~~~~~~  !:~~~~<~~!_~y~~~                        ~/6~  
  ~V~~                      @!h%5~'~  y~!^{~?~~~~b~~~!!~~~~~~~~B~T                        !~$w  
  ~!~~                    V~f~H~~~    !~~~~~!~  ~~~~~$      1V~~!~~~                      S~~~  
  ~~~~~D                ~~g~~!~\      ~~z~!~.~  z~~E        ~~~U~sKu                    ~;!J~~  
  jI3~~~              C~JAv~8E        !3H!)(R!  n!!,          Pq~~0q~P                  1!!~!~  
  ~~~~~~              ~b~~~~          *0~~;~    !~~!            !!~!~!                  ~~!~~~  
  ~~4~~~            g~~rs2            {!!?~&    ~~~7            $~~x~~                  Yj!^!~  
    ~!V>~\                          6!~~~!      2.~d              ~~!~!!                ~~A!    
    >~t~~~                          ~R~#q~      ~!Vn              :!~~V~              ~b~~~~    
    D*~~-~                        ~!~~-Z        ?L                  ~!~(              Se~~~~    
      !k~~~8                    ~~J~~I          b~                  ~~~~~~          ~av+~+      
      \~~!~~                  t~'v&~            ~~                    ~~!~          !)~~~~      
        ~,^~~!              ~~!H^A              R~                    !*d@        ~~]~Y?        
          `~~c~~          !~~~h~                FL                    ~Q~f      Ke~3!Z          
          >~~~~~~~    ~=UrN+                    2^                    "~~~    ~S.~~~~R          
            A~~!~~  ~!!5                        !~                      !,    {~!~~~            
              ~~!=t~                            !A                          ~~~~~~              
                ~~>~~K:1                        ~~~~                    ~!~!~~<~                
                  ~~~~~k:9                      !ToE                  ~~~~~!~~                  
                    w~0~<h~~~~                  !~~~              ,~~~U~!I~}                    
                        1K~f</~~~:~~                        ~~~~!3~~c~<S                        
                          ~!~*K~B~]jL!!!U~~Q        t~V~8~~t~9~~~,~!~]                          
                              K~~k9~Yi~~~~!!~~L(!!~~~~@~~~~Jz~~~~~                              
                                    iv=~0`~~;X!<,~!p~~~~}~!"                                    


	本项目虽然开源，但请勿以任何形式将本项目进行打包售卖！！！
	
	硬件和结构地址：https://oshwhub.com/nokia82/cubli_-ping-heng-li-fang-ti

	立方体演示视频：https://www.bilibili.com/video/BV1XK421C7t8/?spm_id_from=333.999.0.0

	如果本代码对你有帮助，欢迎关注给UP点个关注，谢谢！
	If this code helps you, please follow us and give us a like. Thank you!
	
	哔哩哔哩、抖音、快手、西瓜、小红书 油管 ID：手工饭
	Bili Bili, Tiktok, Kwai, Watermelon, Little Red Book Tubing ID: 手工饭
	
	QQ群:125654683交流，暗号JLINK
*/

#include "app.h"
#include "WheelTelemetry.h"
char chy[32];

u8 Breath_Cnt0;
u8 Breath_Cnt1;
u8 Breath_Flag;
s32 WS2812S_data;

u16 IMU_cnt = 0;

u32 colour_data;
u16 colour_cnt=2000,colour_cnt2;
u8  colour_flag;
u32 led_cou1,led_cou2,led_cou3;

u8 A_cnt = 0;
u8 B_cnt = 0;
void Peripherals_Init(void)
{
	int ws_j = 0;
	int ws_i = 0;
	u32 ws_daley = 0;
	Read_Cali_Data();
	Gpio_config();
	Key_Init();
	delay_ms(100);
	gpio_bits_set(GPIOA,GPIO_PINS_15);	
	
	TLE5012B_Init();
	TIM2_Init();
	TIM7_Init();
	USART2_init(115200*8); 
	USART3_init(230400); // 串口打印
	IMU_Init();
	memset(lcd_data,0,sizeof(lcd_data));
	LCD_Init();//LCD初始化
	Logo_init();

	parameters_Init();
	TIM1_Init();
	TIM8_Init();
	TIM4_Init();

	ADC_Config();
  while(Key1==0);
	Cubli.Power_flag = 1;
	memset(lcd_data,0x0,sizeof(lcd_data));

	delay_ms(200); // 等待A电压采样稳定

	Cubli.data[0] = (25.2f -	Cubli.BatVin) * 0.00065f + 0.005f;
	Cubli.data[1] = (25.2f -	Cubli.BatVin) * 0.00006f + 0.001f;
	
	WS2812_init();
	
//	srand(10);
  colour_data = 0x00a0a0;
	
	Display_Logo();
	
	while(1) 
	{	 
    if(TIM_Flag == 1)
		{
			TIM_Flag = 0;
			RcData();
			Key_Scan();
			Car_Cali();
			IMU_handle();
			if(++IMU_cnt >= 2000) // 等待姿态稳定
			{
				IMU_cnt = 2000;
				if(IMU_Initial == 1 && Cubli.Cali_flag == 1)
				{
					if(Cubli.ManualUp == 0)
					{
						if(Cubli.AutoStandUp == 1) // 单边平衡自动模式 蓝灯
						{
							edge_balance(); 
							if(++dot_auto_up_cnt >= 3500) 
							{
								dot_auto_up_cnt = 3500;
								colour_data = 0xa000a0;
							}
						}
						else if(Cubli.AutoStandUp == 2)dot_balance();  // 单点平衡自动模式 紫灯
					}
					else if(Cubli.ManualUp == 1) // 单边平衡手动模式 白灯
					{
						edge_balance(); 
					}
					else if(Cubli.ManualUp == 2) // 单点平衡手动模式 黄灯
					{
						dot_balance();
					}
				}
			}
			
			WheelTelemetry_Poll();

			if(WS2812_Flag3 == 0)
			{
				ws_daley ++;
				if (ws_daley > 10  && abs((int)mpu6500.gyroAngle.x)<30)
				{
					SetBrightness(10);
					ws_daley = 0;
					//if ((direction == 1 && j >= 255) || (direction == -1 && j <= 0)) {
					  // 在这里可以选择改变方向，或者保持不变
						//direction *= -1; // 如果需要自动切换方向，取消注释这行
					//}
					for (ws_i = 0; ws_i < 72; ws_i++) 
					{
					  RGB_Data[ws_i]=Wheel((ws_i * 256 / 72 + ws_j) & 255);
					}
					send_Data(RGB_Data,72);
					WS2812_Flag3 = 1;
					//j += direction * 2; // 根据direction的值正向或反向增加j
					if(mpu6500.gyroAngle.x>0){
						ws_j += 2;
					}
					else{
						ws_j += -2;
					}
				}
			}
			
			if(DMA1_CHANNEL1_Flag == 0)
			{	
				DMA1_CHANNEL1_Flag = 1;
				if(M1_Foc.Cali_flag != 3 && M2_Foc.Cali_flag != 3 && M3_Foc.Cali_flag != 3)
				{
					sprintf(chy,"Bat_DC:%.1fV ",Cubli.BatVin);
					LCD_ShowString(79,20,chy,12,BRRED,BLACK);
					
					sprintf(chy,"Cube_X:%.1f ",mpu6500.gyroAngle.x);
					LCD_ShowString(79,37,chy,12,BRRED,BLACK);
					
					sprintf(chy,"Cube_Y:%.1f ",mpu6500.gyroAngle.y);
					LCD_ShowString(79,53,chy,12,BRRED,BLACK);
					
//					Fill_Show(79,2,2,80,BLACK);
//					Fill_Show(79,2,2,B_cnt,GREEN);
//					if(++A_cnt >= 10)
//					{
//						A_cnt = 0;
//						if(++B_cnt >= 80)
//						{
//							B_cnt = 0;
//						}
//					}
				}
				else if(M1_Foc.Cali_flag == 3 && M2_Foc.Cali_flag == 3 && M3_Foc.Cali_flag == 3)
				{
					sprintf(chy,"%4.1fV",Cubli.BatVin);
					LCD_ShowString(18,0,chy,12,RED|GREEN,BLACK);
					
					sprintf(chy,"%-5d",M1_Foc.Encoder_data);
					LCD_ShowString(30,38,chy,12,WHITE,BLACK);
					
					sprintf(chy,"%-5d",M2_Foc.Encoder_data);
					LCD_ShowString(30,52,chy,12,WHITE,BLACK);
					
					sprintf(chy,"%-5d",M3_Foc.Encoder_data);
					LCD_ShowString(30,64,chy,12,WHITE,BLACK);
					
					if(++A_cnt >= 100)
					{
						A_cnt = 0;
						sprintf(chy,"%-5.2f",M1_Foc.Id);
						LCD_ShowString(104,0,chy,12,RED,BLACK);
						sprintf(chy,"%-5.2f",M1_Foc.Iq);
						LCD_ShowString(104,12,chy,12,RED,BLACK);
						
						sprintf(chy,"%-5.2f",M2_Foc.Id);
						LCD_ShowString(104,26,chy,12,GREEN,BLACK);
						sprintf(chy,"%-5.2f",M2_Foc.Iq);
						LCD_ShowString(104,38,chy,12,GREEN,BLACK);			
						
						sprintf(chy,"%-5.2f",M3_Foc.Id);
						LCD_ShowString(104,52,chy,12,BLUE,BLACK);
						sprintf(chy,"%-5.2f",M3_Foc.Iq);
						LCD_ShowString(104,64,chy,12,BLUE,BLACK);	
					}
				}
				SPI2_DMA_Send((u32)lcd_data,12800);	
			}
		}
	}
}
