package com.datacompress.strategy;
public class StrategyInputs {
    public enum Urgency {CRITICAL,IMPORTANT,NORMAL}
    public enum LinkGrade {GOOD,FLUCTUATING,RECOVERING,CONGESTED,DISCONNECTED}
    public record ContentHints(boolean alreadyCompressed,String suggestedPreprocess){}
    public record SchedulingHints(Urgency priority,boolean cacheAllowed,boolean batchAllowed){}
    public record LinkConditions(LinkGrade quality,double packetLossPercent){}
    public record RateBudget(double safeRateKbps){}
}
