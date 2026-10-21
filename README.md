# VoteChor — The Great Parliament Run 🗳️🏃

A 3D open-world multiplayer protest game: **Next.js 16 + Three.js + socket.io**.
The votes are missing, the protest is on — collect vote tokens across the greater
city, dodge the police, survive the Vanodyan jungle (zombies, graveyard, howls),
climb real mountains, and reach the Parliament boss gate.

**Current build: v77** — the restored round world (1300 m disc): CITY → GATED
EXITS → COUNTRYSIDE → DENSE JUNGLE → KABRISTAN GRAVEYARD → GREEN HILLS →
SNOWCAP MOUNTAIN RIM → HAZY FAR RANGE. Mountains are SOLID collision terrain
(render/collision parity ~1e-5): gentle hills are walk-ups, short peaks are
jump-and-stand, steep rims block. Zombies never enter the city.

## Requirements

- [Bun](https://bun.sh/) 1.0+ — that's it (SQLite via Prisma, no external services)

## Quick start

### Windows (10 1803+ / 11) — one click

```
git clone https://github.com/zoiboxin/votechor.git
cd votechor
start-windows.bat
```

The batch file checks every prerequisite (offers to install Bun, prepares
`.env.local` + the SQLite DB, installs dependencies, builds) and starts BOTH
servers in their own windows, then opens http://localhost:3000 with bots and
crowd live. See **WINDOWS-SETUP.md** for LAN play and troubleshooting.

### macOS / Linux

```bash
git clone https://github.com/zoiboxin/votechor.git
cd votechor

bun install
cd mini-services/game-server && bun install && cd ../..

DATABASE_URL=file:../db/custom.db bun run db:push

# Terminal A — web app (http://localhost:3000)
bun run dev

# Terminal B — multiplayer game server (port 3002)
cd mini-services/game-server && bun run dev
```

Open **http://localhost:3000**. Since v90 the client auto-connects to the game
server on localhost/LAN (port 3002) — bots, crowd and cars appear without any
env var. For a game server on a DIFFERENT machine, set
`NEXT_PUBLIC_GAME_SERVER_URL=http://<host>:3002` before building (the game
server allows all CORS origins).

## Useful scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Next.js dev server on port 3000 |
| `bun run lint` | ESLint |
| `bun run db:push` | Push `prisma/schema.prisma` to the SQLite DB |
| `bun tests/route-check.ts` | Vehicle route suite (all 32 routes) |
| `bun tests/world-integrity-test.ts` | World integrity suite |
| `bun tests/maps-test.ts` | Map layout suite |
| `bun tests/physics-test.ts` | Physics/anti-tunnel suite |

## Controls

WASD move · Shift sprint · Space jump (double-tap = double jump) · C slide ·
E interact · Tab squad panel · M big map · T chat · Esc pause

## Notes

- The world is generated deterministically from `src/game/shared/world-def.ts` —
  client renderer and authoritative server build identical worlds.
- Mountains: `src/game/shared/terrain-noise.ts` is the single math source for
  BOTH the renderer (`world.ts getMountainGeo`) and the collision heightfield
  (`src/game/mountain-field.ts`) — do not fork one side.
- `VC_BUILD` in `src/lib/build-version.ts` is the in-game version badge.
- Everything is satire. All politicians, committees and samosas are fictional.
