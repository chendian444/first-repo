#ifndef _Debug_H_
#define _Debug_H_
#include <stdint.h>
#include "app.h"
typedef struct {
    float data1,data2,data3,data4,data5,data6,data7,data8;
    float data9,data10,data11,data12,data13,data14,data15,data16;
} Print_data_t;
extern Print_data_t Print_data;
extern volatile uint32_t WheelRaw26_TicksMs;
void UsartPrint(void);
#endif
