# Steam 灯塔 · PowerShell 启动脚本
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$node = (Get-Command node -ErrorAction SilentlyContinue)?.Source
if (-not $node) {
    $bundled = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path $bundled) { $node = $bundled }
}
if (-not $node) {
    Write-Host "  [x] 没找到 Node.js，装个 Node 20+ 再回来：https://nodejs.org/" -ForegroundColor Red
    exit 1
}

$port = if ($env:PORT) { $env:PORT } else { 5173 }
Write-Host ""
Write-Host "  Steam 灯塔 正在启动…" -ForegroundColor Cyan
Write-Host "  http://127.0.0.1:$port   （Ctrl+C 停止）"
Write-Host ""

Start-Job -ScriptBlock {
    param($url)
    Start-Sleep -Seconds 3
    Start-Process $url
} -ArgumentList "http://127.0.0.1:$port" | Out-Null

& $node "server\index.mjs"
