package com.chendian.wheellink;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.view.View;
import java.util.ArrayDeque;

public final class TrendView extends View {
    private final ArrayDeque<float[]> samples=new ArrayDeque<>();
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
    private final int[] colors={Color.rgb(8,126,131),Color.rgb(64,105,225),Color.rgb(225,112,70)};
    public TrendView(Context context){super(context);setContentDescription("角速度XYZ最近约25秒趋势，界面每秒最多刷新10次");}
    public void add(float[] values){samples.addLast(values.clone());if(samples.size()>250)samples.removeFirst();invalidate();}
    public void clear(){samples.clear();invalidate();}
    @Override protected void onDraw(Canvas c){
        super.onDraw(c);float w=getWidth(),h=getHeight();float pad=48*getResources().getDisplayMetrics().density/2;
        float range=1;
        for(float[] v:samples)for(int j=0;j<3;j++)if(Float.isFinite(v[j]))range=Math.max(range,Math.min(100000,Math.abs(v[j])));
        paint.setStrokeWidth(1);paint.setTextSize(11*getResources().getDisplayMetrics().scaledDensity);
        for(int i=0;i<5;i++){
            float y=12+(h-36)*i/4;
            paint.setColor(Color.rgb(227,234,233));c.drawLine(pad,y,w-6,y,paint);
            paint.setColor(Color.rgb(118,132,132));c.drawText(String.format(java.util.Locale.US,"%.0f",range*(1-i/2f)),0,y+4,paint);
        }
        for(int j=0;j<3;j++){
            paint.setColor(colors[j]);paint.setStrokeWidth(2*getResources().getDisplayMetrics().density);
            float px=0,py=0;int i=0;boolean previous=false;
            for(float[] v:samples){
                float x=pad+(w-pad-8)*i++/249f;
                if(!Float.isFinite(v[j])){previous=false;continue;}
                float y=12+(h-36)*(.5f-Math.max(-range,Math.min(range,v[j]))/(2*range));
                if(previous)c.drawLine(px,py,x,y,paint);px=x;py=y;previous=true;
            }
        }
        paint.setTextSize(11*getResources().getDisplayMetrics().scaledDensity);paint.setColor(Color.GRAY);
        c.drawText(samples.isEmpty()?"开启遥测后显示曲线":"手机接收时间 · XYZ / °/s",pad,h-3,paint);
    }
}
