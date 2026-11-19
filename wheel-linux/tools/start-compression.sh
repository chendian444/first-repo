#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
system="$root/reaction-wheel-compression-v1.1/DataCompress_System"
logs="$root/wheel-linux/runtime/services"
mkdir -p "$logs"
command -v java >/dev/null || { echo 'Install Java 17+ first'; exit 1; }
command -v node >/dev/null || { echo 'Install Node.js 18.17+ first'; exit 1; }
python3 - <<'PY'
import socket
for port in (8080,8082):
    with socket.socket() as s:s.bind(('127.0.0.1',port))
PY
backend_pid='';bridge_pid=''
cleanup() {
  if [[ -n "$bridge_pid" ]]; then kill "$bridge_pid" 2>/dev/null || true; wait "$bridge_pid" 2>/dev/null || true; fi
  if [[ -n "$backend_pid" ]]; then kill "$backend_pid" 2>/dev/null || true; wait "$backend_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM
(cd "$system/backend" && exec java -Xms128m -Xmx1024m -jar target/data-compress-control-system-v5-5.0.0.jar --server.port=8082 --server.address=127.0.0.1) >"$logs/backend.log" 2>&1 &
backend_pid=$!
python3 - <<'PY'
import time,urllib.request
for attempt in range(60):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8082/api/wheel/status',timeout=1) as r:
            if r.status==200:break
    except OSError:time.sleep(.5)
else:raise SystemExit('Backend startup failed: inspect runtime/services/backend.log')
PY
(cd "$system/bridge" && exec env BRIDGE_HOST=127.0.0.1 BACKEND_URL=http://127.0.0.1:8082 AUTO_START_RECEIVER=false node src/server.mjs) >"$logs/bridge.log" 2>&1 &
bridge_pid=$!
echo 'Compression UI: http://127.0.0.1:8080/wheel; upload backend: http://127.0.0.1:8082'
echo 'Logs: wheel-linux/runtime/services; Ctrl+C stops only these service processes.'
wait -n "$backend_pid" "$bridge_pid"
