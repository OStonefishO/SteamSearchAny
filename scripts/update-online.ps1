# 自动更新：抓新游戏 -> 重建静态站 -> 推送上线
# 由 Windows 计划任务每天调用，也可以用  .\scripts\update-online.ps1  手动跑
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$log = Join-Path $root 'data\update.log'
function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $log -Value $line -Encoding UTF8
  Write-Host $line
}

Log '=== 开始增量更新 ==='

# 1) 抓新游戏
try {
  $out = & node scripts/sync-new-games.mjs --limit=600 --tags=24 2>&1
  Log ($out | Select-Object -Last 3 | Out-String)
} catch {
  Log "同步失败：$($_.Exception.Message)"
}

# 2) 重建静态站
try {
  $out = & node scripts/build-static.mjs 2>&1
  Log ($out | Select-Object -First 1 | Out-String)
} catch {
  Log "构建失败：$($_.Exception.Message)"
  exit 1
}

# 3) 同步到站点仓库并推送
$web = 'D:\综合创作\SteamSearchAny-web'
if (Test-Path $web) {
  Copy-Item (Join-Path $root 'dist\*') $web -Recurse -Force
  Copy-Item (Join-Path $root 'dist\.nojekyll') $web -Force
  Push-Location $web
  try {
    git add -A
    git -c core.autocrlf=false commit -q -m "site: 自动更新 $(Get-Date -Format 'yyyy-MM-dd HH:mm')" 2>$null
    if ($LASTEXITCODE -ne 0) { Log '没有变化，跳过推送' }
    else {
      for ($i = 1; $i -le 8; $i++) {
        & git -c http.postBuffer=157286400 -c http.lowSpeedLimit=2000 push -q origin main 2>$null
        if ($LASTEXITCODE -eq 0) { Log "已推送（第 $i 次）"; break }
        Start-Sleep -Seconds (15 * $i)
      }
    }
  } finally {
    Pop-Location
  }
}
Log '=== 结束 ==='
