package com.datacompress.monitor;
import com.datacompress.monitor.service.NetworkTelemetryService;
import com.datacompress.monitor.domain.*;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import static org.junit.jupiter.api.Assertions.*;
class TelemetryIsolationTest {
    @Test void idleIsNotReportedAsMeasurement(){var source=new NetworkTelemetryService(120,false,1000,32);source.sample();assertFalse(source.status().fresh());assertEquals(0,source.current().throughputKbps());assertEquals("NO_TELEMETRY",source.status().source());}
    @Test void channelsRetainSeparateMeasurements(){var first=new NetworkTelemetryService(120,false,1000,32);var second=new NetworkTelemetryService(120,false,1000,32);first.ingest(new NetworkSample(Instant.now(),1000,25,3,0,0,ConnectionState.CONNECTED,null,0,0,0,0,true));second.ingest(new NetworkSample(Instant.now(),20,500,80,15,2,ConnectionState.DISCONNECTED,null,0,0,0,0,true));assertEquals(1000,first.current().throughputKbps());assertEquals(NetworkQuality.DISCONNECTED,second.current().quality());assertTrue(first.status().fresh());}
    @Test void stoppingDemoClearsFreshness(){var source=new NetworkTelemetryService(120,true,1000,32);assertEquals("SIMULATION",source.status().source());source.setSimulationEnabled(false);source.sample();assertFalse(source.status().fresh());assertFalse(source.current().externallyMeasured());}
}
