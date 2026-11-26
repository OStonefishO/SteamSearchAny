# Steam Lighthouse - PowerShell launcher
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    $bundled = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path $bundled) { $node = $bundled }
}
if (-not $node) {
    Write-Host '  [x] Node.js not found. Install Node 20+ first: https://nodejs.org/' -ForegroundColor Red
    exit 1
}

$port = if ($env:PORT) { $env:PORT } else { 5173 }
Write-Host ''
Write-Host '  Steam Lighthouse starting...' -ForegroundColor Cyan
Write-Host "  http://127.0.0.1:$port   (Ctrl+C to stop)"
Write-Host ''

Start-Job -ScriptBlock {
    param($url)
    Start-Sleep -Seconds 3
    Start-Process $url
} -ArgumentList "http://127.0.0.1:$port" | Out-Null

& $node 'server\index.mjs'
