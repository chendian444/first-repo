"""Make a NEW copy of the integrated wheel-linux v1.0 AT32 project; replace only two telemetry files."""
import argparse
from pathlib import Path
import shutil
import tempfile
import xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]
def prepare(source,output):
    source=source.resolve();output=output.resolve()
    if not source.is_dir():raise ValueError('source must be the extracted firmware directory, not a ZIP')
    if output.exists():raise ValueError('output exists; choose a new directory')
    if source==output or source in output.parents:raise ValueError('output must be outside source')
    def text(name):return (source/name).read_bytes().decode('gb18030',errors='replace')
    checks={'UserFile/app.c':['WheelTelemetry_Poll();'],
        'UserFile/timer.c':['WheelTelemetry_TicksMs','TMR7_GLOBAL_IRQHandler'],
        'UserFile/usart.c':['WheelTelemetry_HandleRx','len > BUFFER_SIZE || Tx3_Flag','Tx3_Flag = 1'],
        'UserFile/usart.h':['extern volatile u8 Tx3_Flag','BUFFER_SIZE'],
        'UserFile/Control.h':['BatVin_filter','Cali_flag'],
        'UserFile/AT32F403A_FOC_LIB.h':['Encoder_data','float Id;']}
    for name,markers in checks.items():
        content=text(name)
        if any(marker not in content for marker in markers):raise ValueError('project does not match integrated pack: '+name+'; merge against your current source manually')
    project=source/'USER/AT32F403A.uvprojx'
    for item in ET.parse(project).iter('FilePath'):
        if not (project.parent/item.text.replace('\\','/')).exists():raise ValueError('missing project reference: '+item.text)
    def ignore(folder,names):return [n for n in names if n in ('Objects','Listings','.git','__pycache__') or n.lower().endswith(('.axf','.bin','.hex','.o','.dep','.crf','.lst','.map','.lnp')) or '.uvguix.' in n]
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='pack-raw26-',dir=output.parent) as tmp:
        staging=Path(tmp)/'project';shutil.copytree(source,staging,ignore=ignore)
        for name in ('WheelTelemetry.c','WheelTelemetry.h'):
            shutil.copyfile(ROOT/'firmware-raw26-pack/UserFile'/name,staging/'UserFile'/name)
        staging.rename(output)
    print('Prepared:',output)
    print('Replaced only UserFile/WheelTelemetry.c and WheelTelemetry.h; control and UART2 preserved from source.')
    print('No licensed Keil build, flash/Verify or hardware timing validation performed.')
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();prepare(a.source,a.output)
