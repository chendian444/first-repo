package com.datacompress.control.controller;

import com.datacompress.control.domain.*;
import com.datacompress.control.service.*;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/network")
public class NetworkController {
    private final NetworkTelemetryService network;
    private final CompactLstmRatePredictor predictor;

    public NetworkController(NetworkTelemetryService network,
                             CompactLstmRatePredictor predictor) {
        this.network = network;
        this.predictor = predictor;
    }

    @GetMapping("/current")
    public NetworkSample current() { return network.current(); }

    @GetMapping("/history")
    public List<NetworkSample> history(@RequestParam(value = "limit", defaultValue = "120") int limit) {
        return network.history(limit);
    }

    @GetMapping("/forecast")
    public RateForecast forecast() { return predictor.predictCurrent(); }

    @GetMapping("/health")
    public Map<String,Object> health() {
        Map<String,Object> result = new LinkedHashMap<>();
        result.put("telemetry", network.status());
        result.put("prediction", predictor.health());
        result.put("measurementMode", network.isSimulationEnabled()
                ? "SIMULATION_COMPATIBILITY" : "EXTERNAL_OR_INTERNAL_MEASUREMENT");
        return result;
    }

    @PostMapping("/telemetry")
    public NetworkSample ingest(@RequestBody NetworkSample sample) {
        network.ingest(sample);
        return network.current();
    }

    @PostMapping("/simulation")
    public Map<String,Object> simulation(@RequestParam("enabled") boolean enabled) {
        network.setSimulationEnabled(enabled);
        return Map.of("simulationEnabled", network.isSimulationEnabled());
    }
}
