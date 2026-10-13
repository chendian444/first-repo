package com.datacompress.prediction;
import com.datacompress.prediction.service.*;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.beans.factory.annotation.Autowired;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.NONE)
class PredictionModelTest {
    @Autowired CompactLstmRatePredictor predictor;
    @Autowired ForecastSeries series;
    @Autowired PredictionFeedbackService feedback;
    @Autowired PredictionApi endpoint;
    @Test void fullHistoryRunsOriginalLstm(){series.replace(java.util.stream.IntStream.range(0,60).mapToObj(i->1200+100*Math.sin(i/7.0)).toList(),0,3);var forecast=predictor.predictCurrent();assertTrue(forecast.modelName().contains("LSTM"));assertEquals(12,forecast.predictedRatesKbps().size());assertTrue(forecast.safeRateKbps()>0);assertFalse(forecast.degraded());}
    @Test void shortHistoryReportsWarmup(){series.replace(List.of(1000.0,1100.0,1050.0),0,0);assertEquals("FAST_HOLT_WARMUP",predictor.predictCurrent().modelName());}
    @Test void invalidRatesAreRejected(){assertThrows(IllegalArgumentException.class,()->series.replace(List.of(-1.0),0,0));assertThrows(IllegalArgumentException.class,()->series.replace(List.of(Double.NaN),0,0));}
    @Test void observationsUpdateCorrection(){int previous=feedback.health().rollingSamples();feedback.update(1000,900);assertEquals(previous+1,feedback.health().rollingSamples());}
    @Test void zeroActualFeedbackIsRejectedRatherThanSilentlyIgnored(){assertThrows(IllegalArgumentException.class,()->endpoint.observe(new PredictionApi.Observation(1000,0)));}
}
