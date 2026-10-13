$ErrorActionPreference = 'Stop'
$stateFile = Join-Path $PSScriptRoot 'started-processes.json'
if (-not (Test-Path -LiteralPath $stateFile)) { Write-Host '没有由本启动器记录的进程。'; exit 0 }
$remaining = @()
foreach ($entry in @(Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json)) {
    try {
        $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$entry.ProcessId)
        if ($null -eq $process) { continue }
        if ($process.Name -notmatch '^javaw?\.exe$' -or -not $process.CommandLine.Contains($entry.Jar)) {
            Write-Host ('跳过不属于本软件的进程：' + $entry.ProcessId)
            continue
        }
        Stop-Process -Id ([int]$entry.ProcessId)
        Write-Host ('已停止：' + $entry.Folder)
    } catch { $remaining += $entry; Write-Warning $_.Exception.Message }
}
if ($remaining.Count -eq 0) { Remove-Item -LiteralPath $stateFile }
else { ConvertTo-Json -InputObject @($remaining) | Set-Content -LiteralPath $stateFile -Encoding UTF8 }
