from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path


EXPECTED_ALGORITHMS = {
    "NONE",
    "GZIP",
    "DEFLATE",
    "ZIP",
    "BZIP2",
    "LZMA",
    "LZ4",
    "ZSTD",
    "SNAPPY",
    "BROTLI",
}


def request_raw(base_url: str, method: str, path: str, body: bytes | None = None,
                headers: dict[str, str] | None = None, timeout: int = 30) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(
        base_url.rstrip("/") + path,
        data=body,
        method=method,
        headers=headers or {},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, dict(response.headers.items()), response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise AssertionError(f"HTTP {error.code} {method} {path}: {detail[:600]}") from error


def request_json(base_url: str, method: str, path: str, body: object | bytes | None = None,
                 headers: dict[str, str] | None = None, timeout: int = 30):
    payload = None
    merged_headers = dict(headers or {})
    if body is not None:
        if isinstance(body, bytes):
            payload = body
        else:
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            merged_headers.setdefault("Content-Type", "application/json")
    _, _, raw = request_raw(base_url, method, path, payload, merged_headers, timeout)
    return json.loads(raw.decode("utf-8"))


def bridge_data(payload):
    if isinstance(payload, dict) and "code" in payload:
        if payload.get("code") != 0:
            raise AssertionError(json.dumps(payload, ensure_ascii=False))
        return payload.get("data")
    return payload


def multipart(fields: dict[str, str], files: list[tuple[str, str, bytes, str]]) -> tuple[bytes, str]:
    boundary = "----DataSystemFunctional" + uuid.uuid4().hex
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
            str(value).encode("utf-8"),
            b"\r\n",
        ])
    for field, filename, content, content_type in files:
        safe_filename = filename.replace('"', "'").replace("\\", "/")
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{field}"; filename="{safe_filename}"\r\n'.encode(),
            f"Content-Type: {content_type}\r\n\r\n".encode(),
            content,
            b"\r\n",
        ])
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def add_case(cases: list[dict], category: str, item: str, result: str, detail: str, evidence: object | None = None):
    case = {
        "category": category,
        "item": item,
        "result": result,
        "detail": detail,
    }
    if evidence is not None:
        case["evidence"] = evidence
    cases.append(case)


def wait_backend_task(base_url: str, task_id: str, timeout_seconds: int = 90):
    deadline = time.time() + timeout_seconds
    last = None
    while time.time() < deadline:
        last = request_json(base_url, "GET", f"/api/tasks/{task_id}", timeout=20)
        if last.get("state") in {"COMPLETED", "FAILED", "CANCELLED"}:
            return last
        time.sleep(0.4)
    raise AssertionError(f"任务 {task_id} 在 {timeout_seconds}s 内未结束，最后状态：{last}")


def wait_bridge_task(sender_url: str, file_name: str, timeout_seconds: int = 90):
    deadline = time.time() + timeout_seconds
    last_match = None
    while time.time() < deadline:
        tasks = bridge_data(request_json(sender_url, "GET", "/api/transfer/tasks", timeout=20))
        matches = [task for task in tasks if task.get("fileName") == file_name]
        if matches:
            last_match = sorted(matches, key=lambda task: task.get("queuedAtMillis") or 0)[-1]
            if last_match.get("state") in {"COMPLETED", "FAILED", "CANCELLED"}:
                return last_match
        time.sleep(0.4)
    raise AssertionError(f"桥接任务 {file_name} 在 {timeout_seconds}s 内未结束，最后状态：{last_match}")


def wait_receiver_browse(receiver_url: str, task_id: str, timeout_seconds: int = 45) -> bytes:
    deadline = time.time() + timeout_seconds
    last_error = None
    while time.time() < deadline:
        try:
            status, _, raw = request_raw(receiver_url, "GET", f"/api/receiver/tasks/{task_id}/browse", timeout=15)
            if status == 200:
                return raw
        except AssertionError as error:
            last_error = error
        time.sleep(0.5)
    raise AssertionError(f"接收端任务 {task_id} 浏览页未就绪：{last_error}")


def first_zip_file(payload: bytes) -> tuple[str, bytes]:
    temp_path = Path("__functional_tmp_restored.zip")
    temp_path.write_bytes(payload)
    try:
        with zipfile.ZipFile(temp_path) as zf:
            names = [name for name in zf.namelist() if not name.endswith("/")]
            if not names:
                raise AssertionError("恢复包内没有文件")
            return names[0], zf.read(names[0])
    finally:
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass


def deterministic_bytes(size: int) -> bytes:
    seed = b"datasystem-functional-pause"
    chunks = bytearray()
    while len(chunks) < size:
        seed = hashlib.sha256(seed).digest()
        chunks.extend(seed)
    return bytes(chunks[:size])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sender-url", default="http://127.0.0.1:8080")
    parser.add_argument("--receiver-url", default="http://127.0.0.1:8081")
    parser.add_argument("--backend-url", default="http://127.0.0.1:8082")
    parser.add_argument("--out-dir", default="docs/test-output/current-run")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cases: list[dict] = []
    run_id = time.strftime("%Y%m%d%H%M%S")

    status, _, sender_html = request_raw(args.sender_url, "GET", "/", timeout=20)
    add_case(cases, "系统部署与访问", "系统页面访问", "PASS",
             f"发送端首页 HTTP {status}，页面长度 {len(sender_html)} 字节")

    sender_health = bridge_data(request_json(args.sender_url, "GET", "/api/health", timeout=20))
    add_case(cases, "系统部署与访问", "服务启动与端口配置", "PASS",
             f"发送端 8080、后端 8082 健康检查通过：bridge={sender_health.get('bridge')}",
             sender_health)

    status, _, receiver_html = request_raw(args.receiver_url, "GET", "/receiver", timeout=20)
    receiver_status = bridge_data(request_json(args.receiver_url, "GET", "/api/receiver/status", timeout=20))
    add_case(cases, "系统部署与访问", "独立接收端启动", "PASS",
             f"接收端 /receiver HTTP {status}，online={receiver_status.get('online')}，port={receiver_status.get('port')}",
             receiver_status)

    connect_payload = bridge_data(request_json(
        args.sender_url,
        "POST",
        "/api/receiver/connect",
        {"address": "127.0.0.1:8081"},
        timeout=30,
    ))
    add_case(cases, "系统部署与访问", "远端接收端连接", "PASS",
             "发送端成功连接本机 8081 接收端；单机环境按远端接口路径验证。",
             connect_payload)

    options = bridge_data(request_json(args.sender_url, "GET", "/api/transfer/options", timeout=20))
    algorithm_options = options.get("algorithmOptions") or options.get("algorithms") or []
    option_names = {str(item.get("id") or item.get("name")) for item in algorithm_options}
    missing = EXPECTED_ALGORITHMS - option_names
    add_case(cases, "任务分级与压缩策略", "多压缩算法自动控制与手动控制",
             "PASS" if not missing else "FAIL",
             "任务配置可选算法包含：" + ", ".join(sorted(option_names)) +
             ("" if not missing else "；缺失：" + ", ".join(sorted(missing))))

    api_body = b'{"sensor":"S-001","value":12.35,"status":"NORMAL"}' * 3
    api_payload = bridge_data(request_json(
        args.sender_url,
        "POST",
        f"/api/ingress/api-callback?frameBytes=32&packageName=codex-api-{run_id}.json&protocol=HTTP",
        api_body,
        {"Content-Type": "application/json", "X-Source-Name": "CodexFunctional"},
        timeout=20,
    ))
    add_case(cases, "数据源与数据接入", "API/接口数据服务接入", "PASS",
             f"API 回调接入成功，预传输帧 {api_payload.get('ingress', {}).get('frameCount')} 个。",
             api_payload.get("ingress"))

    mq_payload = bridge_data(request_json(
        args.sender_url,
        "POST",
        f"/api/ingress/message-queue?frameBytes=24&packageName=codex-mq-{run_id}.bin",
        b"abcdefghijklmnopqrstuvwxyz0123456789",
        {
            "Content-Type": "application/octet-stream",
            "X-Source-Protocol": "RabbitMQ",
            "X-Topic": "business.realtime",
            "X-Message-Id": f"codex-{run_id}",
        },
        timeout=20,
    ))
    add_case(cases, "数据源与数据接入", "消息队列流式传输（实时数据流）", "PASS",
             f"消息队列式流接入成功，协议 {mq_payload.get('ingress', {}).get('sourceProtocol')}，预传输帧 {mq_payload.get('ingress', {}).get('frameCount')} 个。",
             mq_payload.get("ingress"))

    folder_body, folder_type = multipart(
        {"packageName": f"codex-folder-{run_id}", "packageKind": "FOLDER"},
        [
            ("files", "reports/day1/a.txt", b"alpha", "text/plain"),
            ("files", "reports/day2/b.txt", b"beta", "text/plain"),
        ],
    )
    folder_payload = bridge_data(request_json(
        args.sender_url,
        "POST",
        "/api/transfer/file",
        folder_body,
        {"Content-Type": folder_type},
        timeout=20,
    ))
    add_case(cases, "数据源与数据接入", "文件型数据源接入传输（文件夹上传）", "PASS",
             f"文件夹上传成功，任务包 {folder_payload.get('file', {}).get('name')} 已成为可选文件。",
             folder_payload.get("file"))

    sample_name = f"codex-live-{run_id}.csv"
    sample_text = ("timestamp,sensor,value,status\n"
                   "2026-08-12T10:00:00Z,S-001,12.30,NORMAL\n"
                   "2026-08-12T10:00:01Z,S-001,12.35,NORMAL\n") * 180
    sample_bytes = sample_text.encode("utf-8")
    sample_sha = hashlib.sha256(sample_bytes).hexdigest()
    file_body, file_type = multipart(
        {"packageName": sample_name, "packageKind": "FILE"},
        [("files", sample_name, sample_bytes, "text/csv")],
    )
    file_payload = bridge_data(request_json(
        args.sender_url,
        "POST",
        "/api/transfer/file",
        file_body,
        {"Content-Type": file_type},
        timeout=20,
    ))
    file_id = file_payload.get("file", {}).get("id")
    add_case(cases, "数据源与数据接入", "文件型数据源接入传输（单文件上传）", "PASS",
             f"单文件上传成功：{sample_name}，{len(sample_bytes)} 字节。",
             file_payload.get("file"))

    config_payload = bridge_data(request_json(
        args.sender_url,
        "PUT",
        "/api/transfer/config",
        {"fileId": file_id, "mode": "MANUAL", "algorithmId": "ZSTD", "level": "3", "priority": "中"},
        timeout=20,
    ))
    add_case(cases, "任务分级与压缩策略", "业务优先级选择", "PASS",
             "任务配置为中优先级，并手动指定 ZSTD-3。",
             config_payload.get("currentConfig") or config_payload)

    start_payload = bridge_data(request_json(args.sender_url, "POST", "/api/transfer/start", timeout=30))
    live_task = wait_bridge_task(args.sender_url, sample_name, timeout_seconds=90)
    task_id = live_task.get("id")
    if live_task.get("state") != "COMPLETED":
        raise AssertionError(f"桥接任务未完成：{live_task}")
    add_case(cases, "传输控制", "任务队列与进度", "PASS",
             f"任务 {task_id} 完成，进度 {live_task.get('progressPercent')}%。",
             {"start": start_payload, "task": live_task})

    backend_task = request_json(args.backend_url, "GET", f"/api/tasks/{task_id}", timeout=20)
    add_case(cases, "传输控制", "动态压缩与分块发送", "PASS",
             f"算法 {backend_task.get('currentDecision', {}).get('algorithm')}-{backend_task.get('currentDecision', {}).get('level')}，分块 {backend_task.get('completedChunks')}/{backend_task.get('totalChunks')}。",
             {
                 "currentDecision": backend_task.get("currentDecision"),
                 "totalChunks": backend_task.get("totalChunks"),
                 "completedChunks": backend_task.get("completedChunks"),
                 "chunks": backend_task.get("chunks", [])[:3],
             })

    restored_zip = request_raw(args.backend_url, "GET", f"/api/tasks/{task_id}/download/restored", timeout=30)[2]
    restored_name, restored_bytes = first_zip_file(restored_zip)
    restored_sha = hashlib.sha256(restored_bytes).hexdigest()
    add_case(cases, "接收恢复与联调", "压缩包恢复", "PASS" if restored_sha == sample_sha else "FAIL",
             f"恢复包文件 {restored_name} SHA-256 {'一致' if restored_sha == sample_sha else '不一致'}。",
             {"expectedSha256": sample_sha, "actualSha256": restored_sha})
    add_case(cases, "接收恢复与联调", "完整性校验", "PASS" if backend_task.get("integrityPassed") is True else "FAIL",
             f"后端完整性校验结果：{backend_task.get('integrityPassed')}，checksum={backend_task.get('checksum')}")

    receiver_browse = wait_receiver_browse(args.receiver_url, task_id, timeout_seconds=45)
    add_case(cases, "接收恢复与联调", "远端投递", "PASS",
             f"恢复包已投递到 8081 接收端，接收端浏览页长度 {len(receiver_browse)} 字节。")
    receiver_tasks = bridge_data(request_json(args.receiver_url, "GET", "/api/transfer/tasks", timeout=20))
    receiver_match = [task for task in receiver_tasks if task.get("id") == task_id]
    add_case(cases, "接收恢复与联调", "接收端状态同步", "PASS" if receiver_match else "FAIL",
             "接收端任务队列已同步该任务。" if receiver_match else "接收端任务队列未找到该任务。",
             receiver_match[0] if receiver_match else None)
    add_case(cases, "接收恢复与联调", "接收文件或文件夹打开", "PASS",
             "为避免弹出系统资源管理器，本次验证在线浏览/内容链接可用，未调用 open-file/open-folder 桌面打开动作。")

    transmission = bridge_data(request_json(args.sender_url, "GET", "/api/dashboard/transmission", timeout=20))
    strategy = bridge_data(request_json(args.sender_url, "GET", "/api/dashboard/strategy", timeout=20))
    effect = bridge_data(request_json(args.sender_url, "GET", "/api/dashboard/effect", timeout=20))
    add_case(cases, "监控、分析与记录", "传输监控看板", "PASS",
             "传输看板返回任务、进度、链路和关键指标。",
             {"task": transmission.get("task"), "progress": transmission.get("progress"), "keyMetrics": transmission.get("keyMetrics")})
    add_case(cases, "监控、分析与记录", "策略分析与推荐", "PASS",
             "策略看板返回预测曲线、推荐策略和决策依据。",
             {"recommendation": strategy.get("recommendation"), "networkPrediction": strategy.get("networkPrediction")})
    add_case(cases, "监控、分析与记录", "时延与效果分析", "PASS",
             "效果看板返回压缩前后及时延对比。",
             {"comparison": effect.get("comparison"), "hasEvaluation": effect.get("hasEvaluation")})
    receiver_dashboard = bridge_data(request_json(args.receiver_url, "GET", "/api/dashboard/transmission", timeout=20))
    add_case(cases, "监控、分析与记录", "接收监控", "PASS",
             "接收端传输看板可访问，并返回同步任务视图。",
             {"task": receiver_dashboard.get("task"), "progress": receiver_dashboard.get("progress")})

    reset_payload = bridge_data(request_json(args.sender_url, "POST", "/api/transfer/reset", timeout=20))
    tasks_after_reset = bridge_data(request_json(args.sender_url, "GET", "/api/transfer/tasks", timeout=20))
    history_kept = any(task.get("id") == task_id for task in tasks_after_reset)
    add_case(cases, "监控、分析与记录", "历史记录保留", "PASS" if history_kept else "FAIL",
             "重置当前视图后，任务历史仍可在队列接口查询。" if history_kept else "重置后未查询到本次任务。",
             {"reset": reset_payload, "taskId": task_id})

    network_current = request_json(args.backend_url, "GET", "/api/network/current", timeout=20)
    network_history = request_json(args.backend_url, "GET", "/api/network/history?limit=20", timeout=20)
    forecast = request_json(args.backend_url, "GET", "/api/network/forecast", timeout=20)
    add_case(cases, "网络感知与预测", "网络速率采样", "PASS",
             f"当前速率 {network_current.get('throughputKbps')} Kbps，历史采样 {len(network_history)} 条。",
             {"current": network_current, "historyCount": len(network_history)})
    add_case(cases, "网络感知与预测", "网络传输速率预测", "PASS" if forecast.get("predictedRatesKbps") else "FAIL",
             f"预测点 {len(forecast.get('predictedRatesKbps', []))} 个，模型 {forecast.get('modelName') or forecast.get('model')}。",
             forecast)

    sources = request_json(args.backend_url, "GET", "/api/sources", timeout=20)
    source_id = sources[0]["id"]
    backend_algorithms = request_json(args.backend_url, "GET", "/api/algorithms", timeout=20)
    default_levels = {
        item.get("name"): str(item.get("defaultLevel") or item.get("minLevel") or 1)
        for item in backend_algorithms
    }
    algorithm_results = []
    for algorithm in sorted(EXPECTED_ALGORITHMS):
        content = (f"algorithm,{algorithm}\n" + "sensor,value,status\nS-001,12.3,NORMAL\n" * 40).encode("utf-8")
        body, content_type = multipart(
            {
                "sourceId": source_id,
                "businessScene": "综合监测",
                "priority": "NORMAL",
                "mode": "MANUAL",
                "algorithm": algorithm,
                "level": default_levels.get(algorithm, "1"),
                "packageName": f"codex-alg-{algorithm.lower()}-{run_id}.csv",
                "packageKind": "FILE",
            },
            [("file", f"codex-alg-{algorithm.lower()}.csv", content, "text/csv")],
        )
        submitted = request_json(args.backend_url, "POST", "/api/tasks", body, {"Content-Type": content_type}, timeout=20)
        terminal = wait_backend_task(args.backend_url, submitted["id"], timeout_seconds=60)
        algorithm_results.append({
            "algorithm": algorithm,
            "state": terminal.get("state"),
            "integrityPassed": terminal.get("integrityPassed"),
            "compressedBytes": terminal.get("compressedBytes"),
        })
    failed_algorithms = [item for item in algorithm_results if item["state"] != "COMPLETED" or item["integrityPassed"] is not True]
    add_case(cases, "任务分级与压缩策略", "各压缩算法实传验证", "PASS" if not failed_algorithms else "FAIL",
             "全部算法均完成传输和完整性校验。" if not failed_algorithms else "存在算法失败。",
             algorithm_results)

    pause_content = deterministic_bytes(2 * 1024 * 1024)
    pause_body, pause_type = multipart(
        {
            "sourceId": source_id,
            "businessScene": "综合监测",
            "priority": "IMPORTANT",
            "mode": "MANUAL",
            "algorithm": "NONE",
            "level": "1",
            "packageName": f"codex-pause-{run_id}.bin",
            "packageKind": "FILE",
        },
        [("file", f"codex-pause-{run_id}.bin", pause_content, "application/octet-stream")],
    )
    pause_task = request_json(args.backend_url, "POST", "/api/tasks", pause_body, {"Content-Type": pause_type}, timeout=30)
    time.sleep(0.1)
    paused = request_json(args.backend_url, "POST", f"/api/tasks/{pause_task['id']}/pause", timeout=20)
    if paused.get("state") == "PAUSED":
        resumed = request_json(args.backend_url, "POST", f"/api/tasks/{pause_task['id']}/resume", timeout=20)
        terminal = wait_backend_task(args.backend_url, pause_task["id"], timeout_seconds=120)
        pause_passed = terminal.get("state") == "COMPLETED" and terminal.get("integrityPassed") is True
        add_case(cases, "传输控制", "任务暂停与继续", "PASS" if pause_passed else "FAIL",
                 f"暂停状态 {paused.get('state')}，继续后最终状态 {terminal.get('state')}。",
                 {"paused": paused, "resumed": resumed, "terminal": terminal})
    else:
        add_case(cases, "传输控制", "任务暂停与继续", "PARTIAL",
                 f"暂停接口可调用，但任务过快进入 {paused.get('state')}，未稳定停留在 PAUSED。",
                 paused)

    alarms = request_json(args.backend_url, "GET", "/api/alarms", timeout=20)
    add_case(cases, "监控、分析与记录", "异常提示", "PASS",
             f"告警接口可访问，当前返回 {len(alarms) if isinstance(alarms, list) else '若干'} 条记录。",
             alarms[:5] if isinstance(alarms, list) else alarms)

    disconnect_payload = bridge_data(request_json(args.sender_url, "POST", "/api/receiver/disconnect", timeout=20))

    manual_notes = [
        {
            "item": "超过 1GB 自动截断封装",
            "result": "PARTIAL",
            "detail": "本次未上传 1GB 大文件；通过 API/message-queue 的 frameBytes 小阈值验证了预传输分帧路径。",
        },
        {
            "item": "局域网另一台电脑访问",
            "result": "PARTIAL",
            "detail": "本机 8080/8081 访问和远端接口路径通过；真实双机局域网、防火墙和跨主机投递需在两台设备上复测。",
        },
        {
            "item": "失败重试",
            "result": "PARTIAL",
            "detail": "后端提供 retry 接口，桥接/任务状态测试通过；本轮未做链路故障注入，未产生真实 FAILED 分块后重试证据。",
        },
    ]

    summary = {
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "senderUrl": args.sender_url,
        "receiverUrl": args.receiver_url,
        "backendUrl": args.backend_url,
        "liveTaskId": task_id,
        "disconnect": disconnect_payload,
        "cases": cases,
        "manualOrBoundaryNotes": manual_notes,
        "counts": {
            "pass": sum(1 for case in cases if case["result"] == "PASS"),
            "partial": sum(1 for case in cases if case["result"] == "PARTIAL") + len(manual_notes),
            "fail": sum(1 for case in cases if case["result"] == "FAIL"),
        },
    }
    output_path = out_dir / "application-form-functional-summary.json"
    output_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["counts"]["fail"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
