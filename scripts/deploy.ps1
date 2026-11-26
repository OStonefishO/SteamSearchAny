# 一键发布：重建静态站 → 覆盖到站点仓库 → 推送（自动重试）
# 用法：.\scripts\deploy.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$web = 'D:\综合创作\SteamSearchAny-web'

Set-Location $root
Write-Host '1/3 重建静态站…' -ForegroundColor Cyan
& node scripts/build-static.mjs

if (-not (Test-Path $web)) {
  Write-Host "站点仓库目录不存在：$web" -ForegroundColor Red
  exit 1
}

Write-Host '2/3 同步到站点仓库…' -ForegroundColor Cyan
Copy-Item (Join-Path $root 'dist\*') $web -Recurse -Force
Copy-Item (Join-Path $root 'dist\.nojekyll') $web -Force

Push-Location $web
try {
  git add -A
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
  git -c core.autocrlf=false commit -q -m "site: 语料与前端更新 $stamp" 2>$null
  $pushed = $false
  for ($i = 1; $i -le 10; $i++) {
    & git -c http.postBuffer=157286400 -c http.lowSpeedLimit=2000 push -q origin main 2>$null
    if ($LASTEXITCODE -eq 0) { $pushed = $true; break }
    Write-Host "  推送失败第 $i 次，20 秒后重试…" -ForegroundColor Yellow
    Start-Sleep -Seconds 20
  }
  Write-Host ('3/3 ' + $(if ($pushed) { '已推送，GitHub Pages 约 30 秒后生效' } else { '推送一直失败，检查网络后重跑本脚本' })) -ForegroundColor $(if ($pushed) { 'Green' } else { 'Red' })
} finally {
  Pop-Location
}
Write-Host '线上地址：https://ostonefisho.github.io/SteamSearchAny-web/' -ForegroundColor Cyan
