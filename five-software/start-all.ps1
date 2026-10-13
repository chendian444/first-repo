$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$java = Get-Command java -ErrorAction SilentlyContinue
if (-not $java) { throw '未找到 Java。请先安装 Java 17 或更高版本，再重新打开。' }
$apps = @(
    @{ Folder = '01-network-monitor'; Title = '多源网络传输状态实时监测软件'; Port = 8101 };
    @{ Folder = '02-adaptive-strategy'; Title = '自适应数据压缩策略分析与优化软件'; Port = 8102 };
    @{ Folder = '03-rate-prediction'; Title = '基于时序特征的网络传输速率智能预测软件'; Port = 8103 };
    @{ Folder = '04-compression-library'; Title = '多算法无损数据压缩方法库管理与可视化软件'; Port = 8104 };
    @{ Folder = '05-transfer-manager'; Title = '数据压缩传输任务交互与全流程管理软件'; Port = 8105 }
)
$stateFile = Join-Path $PSScriptRoot 'started-processes.json'
$started = @()
if (Test-Path -LiteralPath $stateFile) {
    $started = @(Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json)
}
function Test-AppReady($app) {
    try {
        $health = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $app.Port + '/actuator/health') -TimeoutSec 2
        if ($health.status -ne 'UP') { return $false }
        $page = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:' + $app.Port + '/') -TimeoutSec 2
        return $page.Content.Contains($app.Title)
    } catch { return $false }
}
foreach ($app in $apps) {
    $directory = Join-Path $PSScriptRoot $app.Folder
    $jar = Join-Path $directory 'app.jar'
    if (-not (Test-Path -LiteralPath $jar)) { throw ('缺少 ' + $jar + '。请先完整解压下载包。') }
    if (-not (Test-AppReady $app)) {
        $client = New-Object System.Net.Sockets.TcpClient
        try { $client.Connect('127.0.0.1', $app.Port); $occupied = $true } catch { $occupied = $false } finally { $client.Close() }
        if ($occupied) { throw ('端口 ' + $app.Port + ' 已被其他程序占用。请关闭占用程序后重试。') }
        Write-Host ('正在启动：' + $app.Title)
        $process = Start-Process -FilePath $java.Source -WorkingDirectory $directory -ArgumentList @('-jar', ('"' + $jar + '"'), '--server.address=127.0.0.1') -RedirectStandardOutput (Join-Path $directory 'launcher-output.log') -RedirectStandardError (Join-Path $directory 'launcher-error.log') -PassThru
        $started += [pscustomobject]@{ ProcessId = $process.Id; Jar = $jar; Folder = $app.Folder }
        ConvertTo-Json -InputObject @($started) | Set-Content -LiteralPath $stateFile -Encoding UTF8
        $deadline = (Get-Date).AddSeconds(60)
        $ready = $false
        while ((Get-Date) -lt $deadline) {
            if (Test-AppReady $app) { $ready = $true; break }
            $process.Refresh()
            if ($process.HasExited) { throw ($app.Title + ' 启动失败，请查看其 launcher-error.log 和 launcher-output.log；确认 Java 为 17 或更高版本。') }
            Start-Sleep -Milliseconds 500
        }
        if (-not $ready) { throw ($app.Title + ' 未在 60 秒内启动，请查看其启动日志。已启动的程序可用“关闭五个软件.bat”停止。') }
    }
    Start-Process ('http://127.0.0.1:' + $app.Port + '/')
    Write-Host ('已打开：' + $app.Title)
}
Write-Host '五个软件已打开。关闭浏览器不会停止后台服务；结束使用后双击“关闭五个软件.bat”。'
