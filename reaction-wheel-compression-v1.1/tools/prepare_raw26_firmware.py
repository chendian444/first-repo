"""Prepare a NEW project from the uploaded balanced-cube-v1.02 source.
Only Debug.c/h, timer.c and the USART3 DMA guard change. No control/ESP32 changes.
"""
import argparse
from pathlib import Path
import re
import shutil
import tempfile

ROOT=Path(__file__).resolve().parents[1]

def read(p):
    data=p.read_bytes()
    try:return data.decode('utf-8'),'utf-8'
    except UnicodeDecodeError:return data.decode('gb18030'),'gb18030'

def once(pattern,replacement,text):
    value,count=re.subn(pattern,replacement,text,count=0)
    if count!=1:raise ValueError('Source does not match uploaded project: '+pattern)
    return value

def prepare(source,output):
    source=source.resolve();output=output.resolve()
    if output.exists():raise ValueError('Output already exists; choose a NEW directory')
    if source==output or source in output.parents:raise ValueError('Output must be outside source')
    updates={}
    timer,enc=read(source/'UserFile/timer.c')
    if 'WheelRaw26_TicksMs' in timer:raise ValueError('Timer already patched')
    timer=once(r'(tmr_flag_clear\(TMR7,\s*TMR_OVF_FLAG\);)',r'\1\n        WheelRaw26_TicksMs++;',timer)
    timer='#include "Debug.h"\n'+timer
    updates['UserFile/timer.c']=(timer,enc)
    uart,enc=read(source/'UserFile/usart.c')
    uart=once(r'(?m)^u8 Tx3_Flag\s*=\s*0;', 'volatile u8 Tx3_Flag = 0;',uart)
    body='''uint32_t UART3_SendDataDMA(uint8_t *data, uint16_t len)
{
    if(!data || !len || len > BUFFER_SIZE || Tx3_Flag) return 0;
    Tx3_Flag=1;
    memcpy((void*)Tx3_buffer,data,len);
    usart_dma_transmitter_enable(USART3, TRUE);
    dma_channel_enable(DMA2_CHANNEL6, FALSE);
    dma_data_number_set(DMA2_CHANNEL6,len);
    dma_channel_enable(DMA2_CHANNEL6, TRUE);
    return len;
}'''
    pattern=r'uint32_t UART3_SendDataDMA\(uint8_t \*data, uint16_t len\)\s*\{.*?\n\}'
    uart,n=re.subn(pattern,body,uart,flags=re.S)
    if n!=1:raise ValueError('UART3 DMA function does not match original source')
    updates['UserFile/usart.c']=(uart,enc)
    header,enc=read(source/'UserFile/usart.h')
    header=once(r'extern\s+u8\s+Tx3_Flag\s*;', 'extern volatile u8 Tx3_Flag;',header)
    updates['UserFile/usart.h']=(header,enc)
    # Preserve all control/radio files; strip only generated build artifacts.
    def ignored(folder,names):
        return [n for n in names if n in ('Objects','Listings','.git','__pycache__') or n.lower().endswith(('.o','.axf','.bin','.hex','.dep','.crf','.lst','.map','.lnp','.bak')) or '.uvguix.' in n]
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='raw26-build-',dir=output.parent) as tmp:
        staged=Path(tmp)/'project';shutil.copytree(source,staged,ignore=ignored)
        for relative,(text,encoding) in updates.items():(staged/relative).write_bytes(text.encode(encoding))
        for name in ('Debug.c','Debug.h'):
            shutil.copyfile(ROOT/'firmware-raw26-overlay/UserFile'/name,staged/'UserFile'/name)
        staged.rename(output)
    print('Prepared:',output)
    print('Changed only UserFile/Debug.c, Debug.h, timer.c, usart.c and usart.h.')
    print('No firmware BIN generated; Keil Rebuild, flash/verify and hardware timing still required.')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',required=True,type=Path)
    p.add_argument('--output',required=True,type=Path)
    a=p.parse_args();prepare(a.source,a.output)
