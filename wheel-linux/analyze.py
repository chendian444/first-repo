#!/usr/bin/env python3
"""Offline signal analysis; raw telemetry and controller remain unchanged."""
import argparse
import csv
import json
import math
import os
from pathlib import Path
os.environ.setdefault('MPLCONFIGDIR','/tmp/wheel-matplotlib')
import numpy as np


def moving_average(values,window,breaks):
    result=[];history=[]
    for i,value in enumerate(values):
        if i in breaks:history=[]
        if not math.isfinite(value):history=[];result.append(float('nan'));continue
        history.append(value)
        if len(history)>window:history.pop(0)
        result.append(sum(history)/len(history))
    return np.array(result)


def analyze(source,output,channel='gyro_x',window=5,fs=None):
    explicit_fs=fs is not None
    if window<1 or window>10000:raise ValueError('window must be 1..10000')
    if fs is not None and (not math.isfinite(fs) or fs<=0):raise ValueError('fs must be finite positive')
    with source.open() as f:
        reader=csv.DictReader(f);headers=reader.fieldnames;rows=list(reader)
    if not rows:raise ValueError('CSV contains no samples')
    if channel not in headers or channel.startswith('reserved_'):raise ValueError('channel missing or reserved')
    if channel in ('received_unix','sequence','ticks_ms','source'):raise ValueError('select a measurement channel')
    if len({r['source'] for r in rows})!=1:raise ValueError('mixed sources: analyze separate sessions')
    values=np.array([float(r[channel]) for r in rows]);full=rows[0]['source']=='2';notes=[];breaks=set();intervals=[]
    if full:
        for i in range(1,len(rows)):
            dt=(int(rows[i]['ticks_ms'])-int(rows[i-1]['ticks_ms']))&0xffffffff
            ds=(int(rows[i]['sequence'])-int(rows[i-1]['sequence']))&0xffffffff
            if ds!=1 or dt==0 or dt>=0x80000000:breaks.add(i)
            if 0<dt<0x80000000:intervals.append(dt)
        median=float(np.median(intervals)) if intervals else None
        regular=bool(median and not breaks and all(abs(d-median)<=max(1,median*.05) for d in intervals))
        inferred=1000/median if median else None
        if fs is None and regular:fs=inferred
        elif fs is not None and inferred and abs(fs-inferred)/inferred>.05:notes.append('Explicit sample rate differs from device timestamp estimate by >5%; FFT disabled');regular=False
        if not regular:notes.append('Device sequence/time is irregular or too short; FFT disabled without resampling')
    else:
        regular=fs is not None
        notes.append('Legacy protocol has no device sample time. --fs is a user-supplied assumption, not a measured hardware sample rate.')
    filtered=moving_average(values,window,breaks);finite=values[np.isfinite(values)]
    stats=None
    if len(finite):
        median_value=float(np.median(finite));mad=float(np.median(abs(finite-median_value)))
        threshold=6*max(1.4826*mad,.01,abs(median_value)*.01)
        stats=dict(min=float(min(finite)),max=float(max(finite)),mean=float(np.mean(finite)),std=float(np.std(finite)),
            rms=float(np.sqrt(np.mean(finite**2))),outlierCount=int(np.sum(abs(finite-median_value)>threshold)),outlierThreshold=threshold)
    spectrum=None;freq=None;amp=None
    if regular and fs and len(values)>=32 and np.isfinite(values).all():
        taper=np.hanning(len(values));freq=np.fft.rfftfreq(len(values),1/fs)
        amp=2*abs(np.fft.rfft((values-values.mean())*taper))/taper.sum();amp[0]/=2
        if len(values)%2==0:amp[-1]/=2
        peak=int(np.argmax(amp[1:])+1)
        spectrum=dict(peakHz=float(freq[peak]),amplitude=float(amp[peak]),resolutionHz=fs/len(values),window='Hann',dcRemoved=True)
    else:notes.append('FFT requires >=32 finite regularly sampled points with known sample rate; no interpolation performed.')
    report=dict(input=source.name,channel=channel,source='RAW26_DEVICE_TIME' if full else 'LEGACY_PC_RECEIPT',samples=len(rows),
        invalidValues=int(np.sum(~np.isfinite(values))),sequenceBreaks=len(breaks),sampleRateHz=fs,
        sampleRateBasis='explicit_assumption' if explicit_fs else 'device_timestamps' if full and fs else 'unknown',
        movingAverageWindow=window,nominalFullWindowDelayMs=(window-1)*500/fs if fs else None,
        statistics=stats,spectrum=spectrum,notes=notes,
        limitation='Offline analysis only; no motor control, no battery health diagnosis. Constant/nonstationary signals can make spectral peaks uninformative.')
    output.mkdir(parents=True,exist_ok=False)
    with (output/'filtered.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=headers+[channel+'_ma']);writer.writeheader()
        for row,v in zip(rows,filtered):writer.writerow(dict(row,**{channel+'_ma':v}))
    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False))
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(2 if spectrum else 1,1,figsize=(11,6),squeeze=False)
    x=np.arange(len(values))/fs if fs and regular else np.arange(len(values))
    axes[0,0].plot(x,values,label='raw',alpha=.65);axes[0,0].plot(x,filtered,label=f'causal mean W={window}')
    axes[0,0].set(xlabel='Time (s)' if fs and regular else 'Sample index',ylabel=channel,title='Offline telemetry analysis');axes[0,0].legend();axes[0,0].grid(alpha=.25)
    if spectrum:axes[1,0].plot(freq,amp);axes[1,0].set(xlabel='Frequency (Hz)',ylabel='Amplitude',title='Hann-window spectrum (DC removed)');axes[1,0].grid(alpha=.25)
    fig.tight_layout();fig.savefig(output/'analysis.png',dpi=150);plt.close(fig)
    return report


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('csv',type=Path);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--channel',default='gyro_x');p.add_argument('--window',type=int,default=5);p.add_argument('--fs',type=float)
    a=p.parse_args()
    try:print(json.dumps(analyze(a.csv,a.output,a.channel,a.window,a.fs),ensure_ascii=False,indent=2))
    except (ValueError,OSError,KeyError) as e:p.exit(1,str(e)+'\n')
if __name__=='__main__':main()
