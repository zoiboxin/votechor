# VoteChor on Windows — one-click local setup

Run the full game (web app + multiplayer game server with bots, crowd and cars)
on any Windows 10 (1803+) / Windows 11 PC. No Caddy, no reverse proxy, no env
plumbing needed — v90+ auto-connects to the game server on localhost/LAN.

## What you need

| Requirement | Notes |
| --- | --- |
| Windows 10 1803+ or Windows 11 | `curl.exe` ships with it (health checks) |
| [Bun](https://bun.sh) 1.0+ | The launcher installs it for you if missing |
| [Node.js](https://nodejs.org) 18+ (recommended) | Enables the WebSocket game relay; without it multiplayer falls back to polling (playable, slightly higher latency) |
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

## Playing on your own domain (Cloudflare Tunnel, v92+)

You can expose the game to the internet through your own domain (e.g.
`votechor.app`) using a Cloudflare Tunnel — **no port forwarding, no firewall
changes, TLS included**.

> **The one rule: the tunnel must point at `http://localhost:3000` ONLY.**
> Since v92 the web server (`server.js`) relays all game traffic (`/gs/*`,
> HTTP polling + WebSocket) to the game server on 127.0.0.1:3002 itself.
> Port 3002 can NEVER be published through Cloudflare — their edge proxy only
> accepts a fixed port list (80, 8080, 8880, 2052, 2082, 2086, 2095,
> 443, 2053, 2083, 2087, 2096, 8443) and 3002 is not one of them. Setting
> `NEXT_PUBLIC_GAME_SERVER_URL=https://yourdomain:3002` always fails with an
> offline red dot / 0 crowd — leave it **EMPTY**.

### Setup

1. Install cloudflared: `winget install Cloudflare.cloudflared` (or download
   `cloudflared-windows-amd64.exe`).
2. `cloudflared tunnel login` → pick your domain in the browser.
3. `cloudflared tunnel create votechor`
4. Create `C:\VoteChor\cloudflared\config.yml` (adjust the credentials path
   shown by step 3):

   ```yaml
   tunnel: <TUNNEL-ID-from-step-3>
   credentials-file: C:\Users\%USERNAME%\.cloudflared\<TUNNEL-ID>.json
   ingress:
     - hostname: votechor.app
       service: http://localhost:3000
     - service: http_status:404
   ```

5. Route DNS and run (or install as a service with `cloudflared service install`):

   ```
   cloudflared tunnel route dns votechor votechor.app
   cloudflared tunnel run votechor
   ```

6. Start the game with `start-windows.bat` as usual, rebuild after updates, and
   open `https://votechor.app`. The browser connects to multiplayer through the
   same origin — WebSockets work through the tunnel automatically **as long as
   Node.js is installed** (the web window then prints
   `[OK] Node.js found - WebSocket relay enabled`). Without Node the game still
   works in polling mode; the console shows `transport: "polling"` instead of
   `"websocket"`.

### Verify it is online

- The HUD connection dot is green and the perf chip shows bots/crowd.
- `https://votechor.app/api/version` returns the current build.
- The console (F12) prints `[net] connected via tunnel-relay → https://votechor.app (path /gs/)`.

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
| **Works on localhost but OFFLINE through my domain/tunnel** | You set `NEXT_PUBLIC_GAME_SERVER_URL` to a domain with `:3002` — that can never work (Cloudflare does not proxy port 3002). Set it to **empty** in `.env.local` and rebuild (`git pull` → start-windows.bat → `Y`). v92+ falls back automatically after a few seconds, but the clean fix is the empty value. |
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

:: Terminal A — web app + /gs relay in one process
set DATABASE_URL=file:../db/custom.db && set NODE_ENV=production && node server.js
::   (node runs the /gs WebSocket relay; bun server.js works in polling-only mode)
:: Terminal B
cd mini-services\game-server && set DATABASE_URL=file:../db/custom.db && bun run start
```

Since v90, `NEXT_PUBLIC_GAME_SERVER_URL` can stay empty for local play — the
client auto-detects `localhost`/LAN and connects directly to port 3002. Set it
explicitly (before `bun run build`) only when the game server runs on another
machine **by its LAN IP**, e.g. `set NEXT_PUBLIC_GAME_SERVER_URL=http://192.168.1.50:3002`.
Never point it at a public domain + port 3002 (see the Cloudflare Tunnel section).
