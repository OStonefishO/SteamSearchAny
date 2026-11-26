# 自动更新：拉取云端新增 -> 抓新游戏 -> 重建静态站 -> 推送上线
# 计划任务每天 11:00 调用；也可手动 .\scripts\update-online.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$web = 'D:\综合创作\SteamSearchAny-web'
Set-Location $root

$log = Join-Path $root 'data\update.log'
function Log($msg) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $log -Value $line -Encoding UTF8
  Write-Host $line
}

Log '=== 开始增量更新 ==='

# 0) 先把云端（GitHub Actions）已经加的拉下来，避免本地构建把它们覆盖掉
if (Test-Path $web) {
  Push-Location $web
  try {
    & git -c http.sslVerify=false pull --ff-only origin main 2>&1 | Out-Null
  } catch {
    Log '拉取云端更新失败（忽略，继续本地流程）'
  } finally {
    Pop-Location
  }
  try {
    $out = & node scripts/merge-web-games.mjs 2>&1
    Log ($out | Select-Object -Last 1 | Out-String)
  } catch {
    Log '反向合并失败（忽略）'
  }
}

# 1) 本地再抓一轮新游戏
try {
  $out = & node scripts/sync-new-games.mjs --limit=600 --tags=24 2>&1
  Log ($out | Select-Object -Last 2 | Out-String)
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

# 3) 覆盖到站点仓库并推送（比远端少就中止，防止把云端数据冲掉）
if (Test-Path $web) {
  $localCount = (Get-Content (Join-Path $root 'dist\data\version.json') -Raw | ConvertFrom-Json).count
  $remoteCount = (Get-Content (Join-Path $web 'data\version.json') -Raw | ConvertFrom-Json).count
  if ($localCount -lt $remoteCount) {
    Log "中止：本地 $localCount 款 < 远端 $remoteCount 款，先跑 merge-web-games.mjs"
    exit 1
  }
  Copy-Item (Join-Path $root 'dist\*') $web -Recurse -Force
  Copy-Item (Join-Path $root 'dist\.nojekyll') $web -Force
  Push-Location $web
  try {
    git add -A
    git -c core.autocrlf=false commit -q -m "site: 自动更新 $(Get-Date -Format 'yyyy-MM-dd HH:mm')" 2>$null
    if ($LASTEXITCODE -ne 0) {
      Log '没有变化，跳过推送'
    } else {
      for ($i = 1; $i -le 8; $i++) {
        & git -c http.sslVerify=false -c http.postBuffer=157286400 push -q origin main 2>$null
        if ($LASTEXITCODE -eq 0) { Log "已推送（第 $i 次）"; break }
        Start-Sleep -Seconds (15 * $i)
      }
    }
  } finally {
    Pop-Location
  }
}
Log '=== 结束 ==='
