$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Bridge = Join-Path $Root 'bridge'

if (-not $env:BRIDGE_PORT) { $env:BRIDGE_PORT = '8081' }
if (-not $env:UPLOAD_LIMIT_BYTES) { $env:UPLOAD_LIMIT_BYTES = '5368709120' }
if (-not $env:PRETRANSMISSION_FRAME_BYTES) { $env:PRETRANSMISSION_FRAME_BYTES = '536870912' }
if (-not $env:RECEIVED_DIR) { $env:RECEIVED_DIR = Join-Path $Root 'runtime\received' }

$node = (Get-Command node.exe -ErrorAction Stop).Source

Write-Host "Receiver display ready: http://localhost:$env:BRIDGE_PORT/receiver" -ForegroundColor Green
Write-Host "Receiver service endpoint: http://0.0.0.0:$env:BRIDGE_PORT"
Write-Host "Receive directory: $env:RECEIVED_DIR"
Write-Host 'Press Ctrl+C to stop receiver service.'

& $node (Join-Path $Bridge 'src\server.mjs')