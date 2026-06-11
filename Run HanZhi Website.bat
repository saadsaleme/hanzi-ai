@echo off
title HanZi AI Website
cd /d "%~dp0"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Node.js / npm was not found.
  echo Install Node.js LTS, then close and reopen this window.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing website packages...
  npm install
  if errorlevel 1 (
    echo.
    echo Package installation failed.
    pause
    exit /b 1
  )
)

echo Starting HanZi AI...
echo Browser will open at http://127.0.0.1:5173/
echo.
echo If this window closes, send me the error text shown here.

start "" powershell -NoProfile -WindowStyle Hidden -Command "$url='http://127.0.0.1:5173/'; for($i=0; $i -lt 80; $i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1; if($r.StatusCode -lt 500){ Start-Process $url; exit } } catch {} Start-Sleep -Milliseconds 500 }; Start-Process $url"

call npm.cmd run dev -- --host 127.0.0.1 --port 5173

echo.
echo Website server stopped.
pause
