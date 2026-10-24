#!/bin/bash
# v94 sandbox QA: keep the game server alive across mystery kills; log every exit
while true; do
  echo "[keepalive] starting bun index.ts at $(date +%H:%M:%S)" >> /home/z/my-project/game-server.log
  cd /home/z/my-project/mini-services/game-server
  bun index.ts >> /home/z/my-project/game-server.log 2>&1
  code=$?
  echo "[keepalive] server EXITED code=$code at $(date +%H:%M:%S)" >> /home/z/my-project/game-server.log
  sleep 1
done
