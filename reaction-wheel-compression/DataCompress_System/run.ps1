$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Frontend = Join-Path $Root 'frontend'
$Backend = Join-Path $Root 'backend'
$Bridge = Join-Path $Root 'bridge'
$BackendLog = Join-Path $Root 'backend.log'
$BackendErrorLog = Join-Path $Root 'backend-error.log'
$BridgeLog = Join-Path $Root 'main-bridge.log'
$BridgeErrorLog = Join-Path $Root 'main-bridge-error.log'
$FrontendIndex = Join-Path $Frontend 'dist\index.html'
$BackendJar = Join-Path $Backend 'target\data-compress-control-system-v5-5.0.0.jar'
$PortableMaven = Join-Path $Root '.tooling\apache-maven-3.9.11\bin\mvn.cmd'

if (-not $env:UPLOAD_LIMIT_BYTES) { $env:UPLOAD_LIMIT_BYTES = '5368709120' }
if (-not $env:PRETRANSMISSION_FRAME_BYTES) { $env:PRETRANSMISSION_FRAME_BYTES = '536870912' }
if (-not $env:BACKEND_MAX_PART_COUNT) { $env:BACKEND_MAX_PART_COUNT = '350' }
if (-not $env:BACKEND_JAVA_XMS) { $env:BACKEND_JAVA_XMS = '512m' }
if (-not $env:BACKEND_JAVA_XMX) {
    try {
        $totalMemoryMb = [math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)
        if ($totalMemoryMb -ge 16000) { $env:BACKEND_JAVA_XMX = '8192m' }
        elseif ($totalMemoryMb -ge 10000) { $env:BACKEND_JAVA_XMX = '6144m' }
        elseif ($totalMemoryMb -ge 7000) { $env:BACKEND_JAVA_XMX = '4096m' }
        else { $env:BACKEND_JAVA_XMX = '2048m' }
    } catch { $env:BACKEND_JAVA_XMX = '4096m' }
}
$env:BACKEND_URL = 'http://127.0.0.1:8082'
$env:FRONTEND_DIST = Join-Path $Frontend 'dist'

function Test-BackendReady {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8082/actuator/health' -TimeoutSec 2
        return $health.status -eq 'UP'
    }
    catch { return $false }
}


function Test-BackendBuildCurrent {
    if (-not (Test-Path $BackendJar)) { return $false }
    $jarTime = (Get-Item -LiteralPath $BackendJar).LastWriteTimeUtc
    $sourcePaths = @((Join-Path $Backend 'src'), (Join-Path $Backend 'pom.xml'))
    $newestSource = Get-ChildItem -Path $sourcePaths -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    return (-not $newestSource) -or ($newestSource.LastWriteTimeUtc -le $jarTime)
}
function Test-BridgeReady {
    param([int]$Port = 8080)
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
        return $health.code -eq 0 -and $health.data.bridge -eq 'UP'
    }
    catch { return $false }
}

function Get-ActiveTransferTaskCount {
    try {
        $tasks = Invoke-RestMethod -Uri 'http://127.0.0.1:8082/api/tasks' -TimeoutSec 3
        $activeStates = @('QUEUED','PROFILING','WAITING_NETWORK','TRANSMITTING','VERIFYING','CACHED','RETRYING','PAUSED')
        return @($tasks | Where-Object { $activeStates -contains ([string]$_.state).ToUpperInvariant() }).Count
    }
    catch { return 0 }
}

function Get-ListeningPid {
    param([int]$Port)
    $pattern = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)"
    $line = netstat -ano | Select-String -Pattern $pattern | Select-Object -First 1
    if ($line) { return [int]$line.Matches[0].Groups[1].Value }
    return $null
}

function Stop-ProcessAndWait {
    param([int]$ProcessId, [string]$Name = 'process')
    try { Stop-Process -Id $ProcessId -Force -ErrorAction Stop } catch { return }
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 300
    }
    Write-Warning "$Name $ProcessId did not exit within 10 seconds."
}

function Stop-StaleBackendIfIdle {
    if (-not (Test-BackendReady)) { return }
    if ((Get-ActiveTransferTaskCount) -gt 0) {
        Write-Host 'Existing backend has active tasks; reusing it for this run.' -ForegroundColor Yellow
        return
    }
    $backendProcesses = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -like 'java*' -and $_.CommandLine -like '*data-compress-control-system-v5-5.0.0.jar*'
    }
    foreach ($proc in $backendProcesses) {
        Write-Host "Stopping stale backend process $($proc.ProcessId)..." -ForegroundColor Cyan
        Stop-ProcessAndWait -ProcessId $proc.ProcessId -Name 'backend'
    }
}

function Stop-StaleBridgeIfIdle {
    param([int]$Port)
    if (-not (Test-BridgeReady -Port $Port)) { return }
    if ((Get-ActiveTransferTaskCount) -gt 0) {
        Write-Host "Existing bridge on port $Port has active backend tasks; reusing it." -ForegroundColor Yellow
        return
    }
    $pidOnPort = Get-ListeningPid -Port $Port
    if (-not $pidOnPort) { return }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $pidOnPort" -ErrorAction SilentlyContinue
    if ($proc -and $proc.Name -like 'node*' -and $proc.CommandLine -like '*bridge*server.mjs*') {
        Write-Host "Stopping stale bridge process $pidOnPort on port $Port..." -ForegroundColor Cyan
        Stop-ProcessAndWait -ProcessId $pidOnPort -Name 'bridge'
    }
}

function Wait-Backend {
    param([System.Diagnostics.Process]$Process, [int]$TimeoutSeconds = 120)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $Process.Refresh()
        if ($Process.HasExited) {
            Start-Sleep -Milliseconds 200
            $details = ''
            if (Test-Path $BackendErrorLog) { $details = (Get-Content -Path $BackendErrorLog -Raw -ErrorAction SilentlyContinue).Trim() }
            if (-not $details -and (Test-Path $BackendLog)) { $details = (Get-Content -Path $BackendLog -Raw -ErrorAction SilentlyContinue).Trim() }
            if ($details) { throw "Backend service exited during startup (exit code $($Process.ExitCode)).`n$details" }
            throw "Backend service exited during startup (exit code $($Process.ExitCode))."
        }
        if (Test-BackendReady) { return }
        Start-Sleep -Milliseconds 750
    }
    throw "Backend service was not ready within $TimeoutSeconds seconds. Check $BackendErrorLog"
}

function Wait-Bridge {
    param([int]$Port, [System.Diagnostics.Process]$Process, [int]$TimeoutSeconds = 30)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $Process.Refresh()
        if ($Process.HasExited) { throw "Bridge service exited during startup (exit code $($Process.ExitCode)). Check $BridgeErrorLog" }
        if (Test-BridgeReady -Port $Port) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "Bridge service was not ready within $TimeoutSeconds seconds. Check $BridgeErrorLog"
}

function Start-RunWatchdog {
    param([int[]]$ProcessIds)
    $ids = @($ProcessIds | Where-Object { $_ -gt 0 })
    if (-not $ids.Count) { return }
    $idsLiteral = $ids -join ','
    $command = @"
`$parentPid = $PID
`$children = @($idsLiteral)
while (Get-Process -Id `$parentPid -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 2 }
foreach (`$childPid in `$children) {
    try { Stop-Process -Id `$childPid -Force -ErrorAction SilentlyContinue } catch {}
}
"@
    Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-Command',$command) -WindowStyle Hidden | Out-Null
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$java = (Get-Command java.exe -ErrorAction Stop).Source
$bridgePort = if ($env:BRIDGE_PORT) { [int]$env:BRIDGE_PORT } else { 8080 }

if (-not (Test-Path $FrontendIndex)) {
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    Push-Location $Frontend
    try {
        if (-not (Test-Path (Join-Path $Frontend 'node_modules'))) {
            & $npm install
            if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed' }
        }
        & $npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
    }
    finally { Pop-Location }
}

if (-not (Test-Path (Join-Path $Bridge 'node_modules\amqplib'))) {
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
    if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
    if (-not $npm) { throw 'Bridge dependency amqplib is missing and npm is not installed' }
    Push-Location $Bridge
    try {
        & $npm.Source install --cache .npm-cache
        if ($LASTEXITCODE -ne 0) { throw 'Bridge dependency installation failed' }
    }
    finally { Pop-Location }
}

if (-not (Test-BackendBuildCurrent)) {
    $mavenCommand = Get-Command mvn.cmd -ErrorAction SilentlyContinue
    if (-not $mavenCommand) { $mavenCommand = Get-Command mvn -ErrorAction SilentlyContinue }
    $mavenExecutable = $null
    if ($mavenCommand) { $mavenExecutable = $mavenCommand.Source }
    elseif (Test-Path $PortableMaven) { $mavenExecutable = $PortableMaven }

    if ($mavenExecutable) {
        Push-Location $Backend
        try {
            & $mavenExecutable package '-DskipTests'
            if ($LASTEXITCODE -ne 0) { throw 'Backend build failed' }
        }
        finally { Pop-Location }
    }
    elseif (Test-Path $BackendJar) {
        Write-Warning "Maven not found; using existing backend jar: $BackendJar"
    }
    else {
        throw "Backend jar not found and Maven is not installed. Install Maven or build backend\target\data-compress-control-system-v5-5.0.0.jar first."
    }
}

Write-Host "Backend Java heap: Xms=$env:BACKEND_JAVA_XMS Xmx=$env:BACKEND_JAVA_XMX" -ForegroundColor Cyan

Stop-StaleBridgeIfIdle -Port $bridgePort
Stop-StaleBackendIfIdle

$backendArgs = @(
    "-Xms$env:BACKEND_JAVA_XMS",
    "-Xmx$env:BACKEND_JAVA_XMX",
    '-XX:+ExitOnOutOfMemoryError',
    '-jar',
    $BackendJar,
    '--server.port=8082',
    '--spring.servlet.multipart.max-file-size=768MB',
    '--spring.servlet.multipart.max-request-size=800MB',
    "--server.tomcat.max-part-count=$env:BACKEND_MAX_PART_COUNT",
    '--app.transfer.max-file-bytes=805306368',
    '--app.network.simulation-enabled=true',
    '--app.transfer.simulation-delay-cap-ms=5000'
)

$backendProcess = $null
$bridgeProcess = $null
$managedProcessIds = @()
try {
    if (Test-BackendReady) {
        Write-Host 'Existing backend detected on http://127.0.0.1:8082; reusing it.' -ForegroundColor Cyan
    }
    else {
        $backendProcess = Start-Process -FilePath $java `
            -ArgumentList $backendArgs `
            -WorkingDirectory $Backend `
            -RedirectStandardOutput $BackendLog `
            -RedirectStandardError $BackendErrorLog `
            -WindowStyle Hidden `
            -PassThru
        $managedProcessIds += $backendProcess.Id
        Wait-Backend -Process $backendProcess
    }

    if (Test-BridgeReady -Port $bridgePort) {
        Write-Host "Existing bridge detected on http://127.0.0.1:$bridgePort; reusing it." -ForegroundColor Cyan
        Write-Host "System ready: http://localhost:$bridgePort" -ForegroundColor Green
        if ($env:RECEIVER_URL) { Write-Host "Remote receiver: $env:RECEIVER_URL" -ForegroundColor Cyan }
        Write-Host 'Press Ctrl+C to close this window. The reused bridge service will keep running.'
        while ($true) { Start-Sleep -Seconds 3600 }
    }

    $bridgeProcess = Start-Process -FilePath $node `
        -ArgumentList (Join-Path $Bridge 'src\server.mjs') `
        -WorkingDirectory $Bridge `
        -RedirectStandardOutput $BridgeLog `
        -RedirectStandardError $BridgeErrorLog `
        -WindowStyle Hidden `
        -PassThru
    $managedProcessIds += $bridgeProcess.Id
    Start-RunWatchdog -ProcessIds $managedProcessIds
    Wait-Bridge -Port $bridgePort -Process $bridgeProcess

    Write-Host "System ready: http://localhost:$bridgePort" -ForegroundColor Green
    if ($env:RECEIVER_URL) { Write-Host "Remote receiver: $env:RECEIVER_URL" -ForegroundColor Cyan }
    Write-Host 'Press Ctrl+C or close this window to stop this system.'

    while ($true) {
        $bridgeProcess.Refresh()
        if ($bridgeProcess.HasExited) { throw "Bridge service exited (exit code $($bridgeProcess.ExitCode)). Check $BridgeErrorLog" }
        if ($backendProcess) {
            $backendProcess.Refresh()
            if ($backendProcess.HasExited) { throw "Backend service exited (exit code $($backendProcess.ExitCode)). Check $BackendErrorLog" }
        }
        Start-Sleep -Seconds 1
    }
}
finally {
    if ($bridgeProcess -and -not $bridgeProcess.HasExited) { Stop-Process -Id $bridgeProcess.Id -Force -ErrorAction SilentlyContinue }
    if ($backendProcess -and -not $backendProcess.HasExited) { Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue }
}