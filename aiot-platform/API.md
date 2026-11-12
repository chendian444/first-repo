# HTTP API v0.1

默认 http://127.0.0.1:8090。除静态页面和GET /health外均需 Authorization: Bearer <token>。管理员令牌与设备令牌不能互换；不支持任意跨域。

| 方法/路径 | 权限 | 内容 |
|---|---|---|
| POST /api/devices | admin | {"id":"wheel-001","name":"动量轮"}；返回一次性token |
| GET /api/devices | admin | 身份、enabled、网关心跳、新鲜度、累计数据量 |
| POST /api/devices/{id}/disable | admin | {}；禁用设备后拒绝后续认证；无删除或自动恢复 |
| POST /api/devices/{id}/heartbeat | 该设备token | 自报状态、frames、lastFrameAt、pendingBatches、origin；不是硬件认证 |
| POST /api/devices/{id}/telemetry | 该设备token | 下述批次结构，最多100帧、请求体100000字节 |
| GET /api/devices/{id}/samples | admin | 最近200样本，包含全部协议字段 |
| GET /api/devices/{id}/alerts | admin | 最近200异常提示，按样本关联 |
| GET /api/devices/{id}/export.csv?after=0 | admin | 长表CSV，最多10000个样本，下一页after=上页最大sample_id |
| POST /api/tests | admin | {"profile":"all"}或baseline/latency/loss/ack_loss/disconnect/bandwidth；202异步返回id，只允许一个活动任务 |
| GET /api/tests | admin | 最近20次状态与完整报告 |

批次：session/batch仅允许1–80字符[A-Za-z0-9_-]；origin=hardware/replay/synthetic（网关自报）；capturedAt为网关接收时Unix秒；frames是1–100个完整DCW1帧的Base64字符串。raw26与legacy先由PC编码。设备序号/毫秒仍在DCW1内。

```json
{"session":"example-session","batch":"example-batch","origin":"replay","capturedAt":1794440000,"frames":["此处替换为完整有效DCW1帧的Base64"]}
```

上例不是可直接上传的有效测试向量，使用gateway回放生成合法帧。成功返回accepted=N,duplicate=false；相同device/session/batch及内容重复返回accepted=0,duplicate=true；复用ID但内容不同返回400。鉴权401、设备已存在/测试忙409、超大请求413。原始帧校验失败整批不入库。
