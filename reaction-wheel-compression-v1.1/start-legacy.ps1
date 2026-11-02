param(
    [string]$Port = 'COM6',
    [string]$Backend = 'http://127.0.0.1:8082'
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $Root
try {
    & python -c 'import serial'
    if ($LASTEXITCODE -ne 0) {
        & python -m pip install -r .\serial-agent\requirements.txt
        if ($LASTEXITCODE -ne 0) { throw 'Could not install pyserial.' }
    }
    Write-Host "Legacy firmware -> PC compression -> $Backend ; port $Port @230400"
    Write-Host 'Close XCOM before opening this port. Ctrl+C stops capture, not the motors.'
    & python .\serial-agent\wheel_agent.py --protocol legacy --port $Port --baud 230400 --enable-stream --backend $Backend
    if ($LASTEXITCODE -ne 0) { throw "Capture exited with code $LASTEXITCODE" }
}
finally { Pop-Location }
