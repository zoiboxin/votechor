@echo off
title VoteChor - stop all servers
echo Stopping VoteChor servers (ports 3000 + 3002) ...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000,3002 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host ('stopped process ' + $_) } catch {} }"
echo Done.
ping -n 3 127.0.0.1 >nul
