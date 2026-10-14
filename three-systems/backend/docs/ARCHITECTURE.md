# 系统架构与研究内容映射

```text
Data Source Layer
  ├─ Sensor / Instrument / Camera
  ├─ Edge Gateway / Control System
  └─ Log / Third-party System
            ↓
Unified Access & Multimodal Recognition
            ↓
Priority Classification
            ↓
PriorityBlockingQueue
            ↓
Network Telemetry ── Compact LSTM Forecast
            ↓                 ↓
Prediction Feedback ← Actual Transfer Result
            ↓
Dynamic Strategy Engine
  ├─ Preprocess recommendation
  ├─ Algorithm and level
  ├─ Chunk size
  ├─ Send order
  ├─ Cache / batch
  └─ Retry policy
            ↓
Compression → Modeled/Physical Link → Receiver Restore
            ↓
Checksum / Metrics / Alarm / Strategy Feedback
```

## 快速预测

模型输入最近 24 个速率点，一次输出未来 12 个点。模型权重位于：

```text
src/main/resources/model/rate-lstm.json
```

Java 端实现 LSTM 门计算，不依赖深度学习运行库。实际速率到达后更新：

```text
correction = EMA(actual / prediction)
safeRate = prediction × correction × loss/jitter penalty
```

## 策略目标函数

```text
T =
  preprocess time
  + compression time
  + compressed bytes / safe rate
  + decompression time
  + queue penalty
  + retransmission penalty
  + switching penalty
```

系统仅在新策略收益超过阈值且当前策略保持时间满足要求时切换。

## 任务状态

```text
QUEUED
PROFILING
WAITING_NETWORK
TRANSMITTING
VERIFYING
CACHED
RETRYING
COMPLETED
FAILED
```

## 真实链路接入

边缘节点每个采样周期发送：

```json
{
  "timestamp": "2026-06-25T08:00:00Z",
  "throughputKbps": 1250.4,
  "rttMillis": 43.2,
  "jitterMillis": 8.1,
  "packetLossPercent": 0.7,
  "retransmissions": 0,
  "connectionState": "CONNECTED",
  "quality": "GOOD",
  "queuedBytes": 0,
  "cachedTasks": 0,
  "cpuPercent": 35.0,
  "memoryPercent": 48.0,
  "externallyMeasured": true
}
```

然后关闭模拟：

```http
POST /api/network/simulation?enabled=false
```
