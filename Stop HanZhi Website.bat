@echo off
title Stop HanZi AI Website

powershell -NoProfile -Command "$ports = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue; if(!$ports){ Write-Host 'HanZi website server is not running on port 5173.'; exit }; $ports | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force; Write-Host ('Stopped process ' + $_) }"

echo.
pause
