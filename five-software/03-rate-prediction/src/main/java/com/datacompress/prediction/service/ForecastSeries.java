package com.datacompress.prediction.service;
import org.springframework.stereotype.Service;
import java.util.*;
@Service
public class ForecastSeries {
    public record Sample(double packetLossPercent,double jitterMillis) {}
    public record Status(boolean fresh,long ageMillis,String source) {}
    private List<Double> values=List.of();
    private Sample conditions=new Sample(0,0);
    private long received;
    public synchronized void replace(List<Double> rates,double loss,double jitter) {
        if(rates==null || rates.isEmpty() || rates.size()>7200) throw new IllegalArgumentException("请输入 1–7200 个速率样本");
        if(rates.stream().anyMatch(v -> v==null || !Double.isFinite(v) || v<0)) throw new IllegalArgumentException("速率必须为有限非负数");
        if(!Double.isFinite(loss)||loss<0||loss>100||!Double.isFinite(jitter)||jitter<0) throw new IllegalArgumentException("丢包率或抖动无效");
        values=List.copyOf(rates);conditions=new Sample(loss,jitter);received=System.currentTimeMillis();
    }
    public synchronized Sample current(){return conditions;}
    public synchronized List<Double> rateHistory(int limit){return List.copyOf(values.subList(Math.max(0,values.size()-limit),values.size()));}
    public synchronized Status status(){long age=received==0?Long.MAX_VALUE:System.currentTimeMillis()-received;return new Status(age<=10000,age,received==0?"NO_INPUT":"USER_SERIES");}
}
