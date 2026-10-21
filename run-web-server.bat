@echo off
title VoteChor WEB (port 3000)
cd /d "%~dp0"
echo ============================================
echo  VoteChor web app - http://localhost:3000
echo  Keep this window OPEN while playing.
echo ============================================
echo.
set "NODE_ENV=production"
set "HOSTNAME=0.0.0.0"
set "PORT=3000"
set "DATABASE_URL=file:../db/custom.db"
if not exist ".next\standalone\server.js" (
    echo The web app is not built yet. Run start-windows.bat first.
    pause
    exit /b 1
)
bun .next\standalone\server.js
echo.
echo The web server exited unexpectedly.
echo Press any key to close this window.
pause >nul
