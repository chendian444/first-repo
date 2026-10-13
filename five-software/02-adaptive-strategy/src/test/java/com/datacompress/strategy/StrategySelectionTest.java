package com.datacompress.strategy;
import com.datacompress.strategy.domain.*;
import com.datacompress.strategy.service.DynamicStrategyService;
import com.datacompress.strategy.StrategyInputs.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
class StrategySelectionTest {
    final DynamicStrategyService engine=new DynamicStrategyService(3);
    final ContentHints content=new ContentHints(false,"NONE");
    final SchedulingHints normal=new SchedulingHints(Urgency.NORMAL,true,true);
    final List<AlgorithmProfile> profiles=List.of(new AlgorithmProfile("NONE",0,true,1,0,0,null),new AlgorithmProfile("ZSTD",3,true,.1,10,10,null));
    @Test void slowLinkBenefitsFromCompression(){var result=engine.select(profiles,content,normal,new LinkConditions(LinkGrade.GOOD,0),new RateBudget(10),262144,null,0);assertEquals("ZSTD",result.algorithm());}
    @Test void disconnectedNormalDataIsCached(){var result=engine.select(profiles,content,normal,new LinkConditions(LinkGrade.DISCONNECTED,0),new RateBudget(10),100,null,0);assertTrue(result.cache());}
    @Test void minimumHoldPreventsImmediateSwitch(){var link=new LinkConditions(LinkGrade.GOOD,0);var previous=engine.select(List.of(profiles.get(0)),content,normal,link,new RateBudget(10),262144,null,0);var chosen=engine.select(profiles,content,normal,link,new RateBudget(10),262144,previous,200);assertEquals("NONE",chosen.algorithm());}
    @Test void criticalDataDoesNotRequestCaching(){var result=engine.select(profiles,content,new SchedulingHints(Urgency.CRITICAL,false,false),new LinkConditions(LinkGrade.DISCONNECTED,0),new RateBudget(10),100,null,0);assertFalse(result.cache());assertEquals(1,result.sendOrder());}
}
