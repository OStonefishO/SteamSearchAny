@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Steam 灯塔

set "NODE_EXE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%i"

if not defined NODE_EXE (
  set "BUNDLED=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  if exist "!BUNDLED!" set "NODE_EXE=!BUNDLED!"
)

if not defined NODE_EXE (
  echo.
  echo   [x] 没找到 Node.js
  echo       装一个 Node 20+ 再回来：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" if not exist "package.json" (
  echo   [!] 当前目录不像项目根目录，请把本文件放在 steam-lighthouse 目录下。
  pause
  exit /b 1
)

echo.
echo   Steam 灯塔 正在启动…
echo   浏览器稍后会自动打开 http://127.0.0.1:5173
echo   关闭这个窗口即停止服务。
echo.

start "" /b cmd /c "timeout /t 3 >nul && start http://127.0.0.1:5173"
"%NODE_EXE%" server\index.mjs

echo.
echo   服务已停止。
pause
