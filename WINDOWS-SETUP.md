# VoteChor on Windows — one-click local setup

Run the full game (web app + multiplayer game server with bots, crowd and cars)
on any Windows 10 (1803+) / Windows 11 PC. No Caddy, no reverse proxy, no env
plumbing needed — v90+ auto-connects to the game server on localhost/LAN.

## What you need

| Requirement | Notes |
| --- | --- |
| Windows 10 1803+ or Windows 11 | `curl.exe` ships with it (health checks) |
| [Bun](https://bun.sh) 1.0+ | The launcher installs it for you if missing |
| ~1.5 GB free disk | Dependencies + build |
| Any GPU that runs a browser | v89+ self-heals the "empty world" GPU fault |

## Quick start

1. Get the code: `git clone https://github.com/zoiboxin/votechor.git`
   (or download + extract the ZIP).
2. **Double-click `start-windows.bat`** in the repo folder. First run it will:
   - offer to install Bun automatically (press `Y`),
   - install dependencies (root + `mini-services/game-server`),
   - create `.env.local` and prepare the SQLite database (`db\custom.db`),
   - free ports 3000/3002 from any previous run,
   - build the web app (**2–4 minutes, first run only**),
   - start **two server windows** and open http://localhost:3000.
3. Play. Bots, NPC crowd, cars and zombies appear because the game server
   (port 3002) is running — keep both server windows open while playing.

## Updating to a newer version

```
git pull
start-windows.bat     → answer Y to "Rebuild anyway?"
```

## Playing with friends on your home network

1. Find your PC IP: open Command Prompt → `ipconfig` → **IPv4 Address**
   (e.g. `192.168.1.42`).
2. Friends open `http://192.168.1.42:3000` on the same Wi-Fi.
3. If Windows Firewall asks on first start, click **Allow** (private networks).
   The launcher also tries to pre-open ports 3000 + 3002 (needs admin rights —
   right-click `start-windows.bat` → *Run as administrator* once to be sure).

## Files this ships

| File | Purpose |
| --- | --- |
| `start-windows.bat` | Full prerequisite check + build + start + health checks |
| `run-web-server.bat` | Starts the web app alone (port 3000, LAN-visible) |
| `run-game-server.bat` | Starts the multiplayer server alone (port 3002) |
| `stop-windows.bat` | Kills anything still listening on ports 3000/3002 |

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| **No bots / no players / 0 CROWD · 0 CARS on the perf chip** | The game server (port 3002) is not reachable. Check the "VoteChor GAME SERVER" window is open and the launcher printed `[OK] game server is up`. If Windows Firewall asked, click Allow. Since v90 the game auto-connects on localhost/LAN — make sure you rebuilt (`git pull` → rebuild `Y`). |
| `bun` not found after auto-install | Close and reopen the window (PATH refresh), re-run `start-windows.bat`. |
| Port already in use | Run `stop-windows.bat`, then start again. |
| Web window shows errors after an update | Re-run `start-windows.bat` → rebuild `Y`. Worst case delete the `.next` folder and rebuild. |
| World looks empty/black but HUD is live | v89+ detects the GPU fault class and auto-recovers within ~30 s. Also update your GPU/Edge drivers. |
| Build step fails | Check the error text in this window; usually fixed by `git pull`, deleting `.next`, and re-running. |
| Progress lost | Progress lives in `db\custom.db` (profiles) + your browser's localStorage token. Don't delete those to "reset" just one of them. |

## What the launcher checks (in order)

1. `bun` installed (auto-installer offered when missing)
2. `git` present (optional — only used to detect "repo updated → rebuild")
3. `curl` present (Windows 10 1803+ / 11 ship it)
4. `.env.local` exists with `DATABASE_URL` + empty `NEXT_PUBLIC_GAME_SERVER_URL`
5. dependencies installed (root **and** `mini-services/game-server`)
6. Prisma client generated + SQLite schema pushed
7. ports 3000/3002 freed from stale runs
8. firewall rules pre-opened (best effort, needs admin)
9. build freshness (auto-detected via `.build-commit` vs current git HEAD)
10. both servers health-checked (`/api/version` + game-server JSON health)
    before the browser is opened

## Manual equivalent (if you prefer terminals)

```bat
bun install
cd mini-services\game-server && bun install && cd ..\..
set DATABASE_URL=file:../db/custom.db
bun run db:generate && bun run db:push
set NEXT_PUBLIC_GAME_SERVER_URL=
bun run build

:: Terminal A
set DATABASE_URL=file:../db/custom.db && bun .next\standalone\server.js
:: Terminal B
cd mini-services\game-server && set DATABASE_URL=file:../db/custom.db && bun run start
```

Since v90, `NEXT_PUBLIC_GAME_SERVER_URL` can stay empty for local play — the
client auto-detects `localhost`/LAN and connects directly to port 3002. Set it
explicitly (before `bun run build`) only when the game server runs on another
machine, e.g. `set NEXT_PUBLIC_GAME_SERVER_URL=http://192.168.1.50:3002`.
