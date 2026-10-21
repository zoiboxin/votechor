@echo off
title VoteChor GAME SERVER (port 3002)
cd /d "%~dp0mini-services\game-server"
echo ============================================
echo  VoteChor game server - port 3002
echo  Keep this window OPEN while playing.
echo  Bots, crowd, cars and zombies live here.
echo ============================================
echo.
set "DATABASE_URL=file:../db/custom.db"
bun run start
echo.
echo The game server exited unexpectedly.
echo Press any key to close this window.
pause >nul
