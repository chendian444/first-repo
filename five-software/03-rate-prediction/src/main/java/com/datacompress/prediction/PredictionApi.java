package com.datacompress.prediction;
import com.datacompress.prediction.service.*;
import com.datacompress.prediction.domain.*;
import org.springframework.web.bind.annotation.*;
import java.util.*;
@RestController
@RequestMapping("/api/prediction")
public class PredictionApi {
    private final CompactLstmRatePredictor predictor;
    private final ForecastSeries series;
    private final PredictionFeedbackService feedback;
    public record Request(List<Double> rates,double lossPercent,double jitterMillis){}
    public record Observation(double predicted,double actual){}
    public PredictionApi(CompactLstmRatePredictor predictor,ForecastSeries series,PredictionFeedbackService feedback){this.predictor=predictor;this.series=series;this.feedback=feedback;}
    @PostMapping public synchronized RateForecast predict(@RequestBody Request request){series.replace(request.rates(),request.lossPercent(),request.jitterMillis());return predictor.predictCurrent();}
    @GetMapping public RateForecast current(){return predictor.predictCurrent();}
    @GetMapping("/health") public PredictionHealth health(){return feedback.health();}
    @PostMapping("/feedback") public PredictionHealth observe(@RequestBody Observation observation){
        if(!Double.isFinite(observation.predicted())||!Double.isFinite(observation.actual())||observation.predicted()<=0||observation.actual()<=0)throw new IllegalArgumentException("预测须为有限正数，实际值须为有限正数");
        feedback.update(observation.predicted(),observation.actual());return feedback.health();
    }

    @ExceptionHandler(IllegalArgumentException.class) public org.springframework.http.ResponseEntity<Map<String,String>> invalid(IllegalArgumentException problem) { return org.springframework.http.ResponseEntity.badRequest().body(Map.of("error","PREDICTION_SERIES_INVALID","message",String.valueOf(problem.getMessage()))); }
}
