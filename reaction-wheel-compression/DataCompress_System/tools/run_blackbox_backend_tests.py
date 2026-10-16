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


def request_json(base_url: str, method: str, path: str, body: bytes | None = None, headers: dict[str, str] | None = None):
    req = urllib.request.Request(
        base_url.rstrip("/") + path,
        data=body,
        method=method,
        headers=headers or {},
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        raw = response.read()
    return json.loads(raw.decode("utf-8"))


def request_bytes(base_url: str, path: str) -> bytes:
    with urllib.request.urlopen(base_url.rstrip("/") + path, timeout=30) as response:
        return response.read()


def multipart(fields: dict[str, str], files: dict[str, tuple[str, bytes, str]]) -> tuple[bytes, str]:
    boundary = "----DataSystemBlackbox" + uuid.uuid4().hex
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
            str(value).encode("utf-8"),
            b"\r\n",
        ])
    for name, (filename, content, content_type) in files.items():
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode(),
            f"Content-Type: {content_type}\r\n\r\n".encode(),
            content,
            b"\r\n",
        ])
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def pass_case(cases: list[dict], item: str, detail: str):
    cases.append({"item": item, "result": "PASS", "detail": detail})


def fail_case(cases: list[dict], item: str, detail: str):
    cases.append({"item": item, "result": "FAIL", "detail": detail})
    raise AssertionError(f"{item}: {detail}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8092")
    parser.add_argument("--out-dir", default="docs/test-output")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cases: list[dict] = []

    health = request_json(args.base_url, "GET", "/actuator/health")
    if health.get("status") == "UP":
        pass_case(cases, "后端健康检查", "actuator health 返回 UP")
    else:
        fail_case(cases, "后端健康检查", json.dumps(health, ensure_ascii=False))

    algorithms = request_json(args.base_url, "GET", "/api/algorithms")
    algorithm_names = {str(item.get("name")) for item in algorithms}
    expected = {"NONE", "GZIP", "DEFLATE", "ZIP", "BZIP2", "LZMA", "LZ4", "ZSTD", "SNAPPY", "BROTLI"}
    if expected.issubset(algorithm_names):
        pass_case(cases, "压缩算法列表", "算法列表包含 " + ", ".join(sorted(expected)))
    else:
        fail_case(cases, "压缩算法列表", "缺失算法：" + ", ".join(sorted(expected - algorithm_names)))

    sources = request_json(args.base_url, "GET", "/api/sources")
    source_id = sources[0]["id"]
    pass_case(cases, "数据源列表", f"获取到 {len(sources)} 个数据源，选用 {source_id}")

    current = request_json(args.base_url, "GET", "/api/network/current")
    forecast = request_json(args.base_url, "GET", "/api/network/forecast")
    if current.get("throughputKbps", 0) > 0 and len(forecast.get("predictedRatesKbps", [])) > 0:
        pass_case(cases, "网络采样与速率预测", f"当前速率 {current.get('throughputKbps')} Kbps，预测点 {len(forecast.get('predictedRatesKbps', []))} 个")
    else:
        fail_case(cases, "网络采样与速率预测", "网络当前样本或预测点为空")

    sample_text = ("timestamp,sensor,value,status\n"
                   "2026-08-03T10:00:00Z,S-001,12.30,NORMAL\n"
                   "2026-08-03T10:00:01Z,S-001,12.35,NORMAL\n") * 120
    sample_bytes = sample_text.encode("utf-8")
    sample_sha = hashlib.sha256(sample_bytes).hexdigest()

    recognize_body, recognize_type = multipart(
        {"sourceId": source_id, "scene": "综合监测"},
        {"file": ("blackbox-monitoring.csv", sample_bytes, "text/csv")},
    )
    recognition = request_json(args.base_url, "POST", "/api/recognize", recognize_body, {"Content-Type": recognize_type})
    if recognition.get("modality") and recognition.get("candidateAlgorithms"):
        pass_case(cases, "文件识别", f"识别模态 {recognition.get('modality')}，候选算法 {recognition.get('candidateAlgorithms')}")
    else:
        fail_case(cases, "文件识别", json.dumps(recognition, ensure_ascii=False))

    task_body, task_type = multipart(
        {
            "sourceId": source_id,
            "businessScene": "综合监测",
            "priority": "IMPORTANT",
            "mode": "AUTO",
            "packageName": "blackbox-monitoring.csv",
            "packageKind": "FILE",
        },
        {"file": ("blackbox-monitoring.csv", sample_bytes, "text/csv")},
    )
    task = request_json(args.base_url, "POST", "/api/tasks", task_body, {"Content-Type": task_type})
    task_id = task["id"]
    pass_case(cases, "任务提交", f"任务 ID {task_id}")

    terminal = None
    for _ in range(120):
        terminal = request_json(args.base_url, "GET", f"/api/tasks/{task_id}")
        if terminal.get("state") in {"COMPLETED", "FAILED", "CANCELLED"}:
            break
        time.sleep(0.5)
    if terminal and terminal.get("state") == "COMPLETED" and terminal.get("integrityPassed") is True:
        pass_case(cases, "任务执行与完整性校验", f"状态 COMPLETED，分块 {terminal.get('completedChunks')}/{terminal.get('totalChunks')}，压缩后 {terminal.get('compressedBytes')} 字节")
    else:
        fail_case(cases, "任务执行与完整性校验", json.dumps(terminal, ensure_ascii=False))

    restored_zip = request_bytes(args.base_url, f"/api/tasks/{task_id}/download/restored")
    restored_path = out_dir / f"{task_id}-restored.zip"
    restored_path.write_bytes(restored_zip)
    with zipfile.ZipFile(restored_path) as zf:
        names = [name for name in zf.namelist() if not name.endswith("/")]
        restored_content = zf.read(names[0])
    restored_sha = hashlib.sha256(restored_content).hexdigest()
    if restored_sha == sample_sha:
        pass_case(cases, "恢复包下载和字节一致性", f"恢复文件 {names[0]} SHA-256 与原始样本一致")
    else:
        fail_case(cases, "恢复包下载和字节一致性", f"expected {sample_sha}, got {restored_sha}")

    summary = {
        "baseUrl": args.base_url,
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "taskId": task_id,
        "sourceId": source_id,
        "sampleBytes": len(sample_bytes),
        "sampleSha256": sample_sha,
        "finalTask": terminal,
        "cases": cases,
    }
    (out_dir / "backend-blackbox-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
