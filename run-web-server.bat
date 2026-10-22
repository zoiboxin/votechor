@echo off
title VoteChor WEB (port 3000)
cd /d "%~dp0"
echo ============================================
echo  VoteChor web app - http://localhost:3000
echo  /gs/* relayed to the game server on 3002.
echo  Keep this window OPEN while playing.
echo ============================================
echo.
set "NODE_ENV=production"
set "HOSTNAME=0.0.0.0"
set "PORT=3000"
set "DATABASE_URL=file:../db/custom.db"
if not exist ".next\BUILD_ID" (
    echo The web app is not built yet. Run start-windows.bat first.
    pause
    exit /b 1
)
where node >nul 2>nul
if not errorlevel 1 (
    echo  [OK] Node.js found - WebSocket relay enabled.
    node server.js
    goto ENDED
)
echo  [!] Node.js not found - starting with bun instead.
echo      Multiplayer still works (polling mode), but for the best
echo      latency install Node.js LTS once:  winget install OpenJS.NodeJS.LTS
echo      (WebSocket relay needs it - bun cannot forward WS upgrades.)
bun server.js
:ENDED
echo.
echo The web server exited unexpectedly.
echo Press any key to close this window.
pause >nul
