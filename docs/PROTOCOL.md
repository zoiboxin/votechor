# VoteChor Multiplayer Server Protocol (mini-services/game-server, port 3002)

Authoritative socket.io server. It MUST import shared pure logic from `../../src/game/shared/`:
- `constants.ts` (DETECT, TOKENS_NEEDED, MOVE, DETENTION_SECONDS, CAPTURE_MESSAGES...)
- `world-def.ts` → `buildWorldDef()` (identical world data: colliders, item spawns, npc spawns, checkpoints, vehicles)
- `npc-brain.ts` → `createNpcStates`, `tickNpc`, `applyNoise`
- `boss-brain.ts` → `createBossBrain`, `tickBoss`, `grabBallot`, `depositBallot`, `registerBossHit`

Use relative imports (`../../src/game/shared/constants`) — path aliases (@/) do NOT work in the mini-service.
socket.io Server config: `{ path: '/', cors: { origin: '*', methods: ['GET','POST'] } }` (Caddy requirement).

## Rooms
- Public room per 20 players: id `pub_<n>`. Private rooms: join code (6 chars). Room capacity 20.
- Room state: players Map, npc brain states (createNpcStates from world.npcs), item states, boss brain,
  checkpoints Set, tokens count, gateOpen, matchStartedAt, vehicles (deterministic from worldTime — no sync needed).

## Client → Server events
| event | payload | server behavior |
|---|---|---|
| `game:join` | `{ name, archetype, roomCode, cosmetics }` | assign room (public if no roomCode; private creates/joins by code), ack callback NOT used — emit `game:joined` back to socket |
| `game:state` | `{ x,y,z,ry,anim, tokens?, carrying? }` | clamp to world bounds; validate speed (teleport jump > 25m since last update → snap to last valid); store; relay in snapshot |
| `game:pickup` | `{ itemId }` | validate: item exists, not taken, player within 3m of spawn pos → mark taken (tokens increment room count; others respawn 30s), broadcast `game:items` |
| `game:throw` | `{ type,x,y,z,vx,vy,vz }` | validate values sane (|v| < 30) → broadcast `game:projectile` to others |
| `game:noise` | `{ x,z }` | `applyNoise(npcs, x, z, 5.5)` |
| `game:emote` | `{ emote }` | broadcast `game:emote {playerId, emote}` |
| `game:quickmsg` | `{ msgId }` | broadcast `game:quickmsg` (msgId 0..9) |
| `game:revive` | `{ targetId }` | validate target dazed & within 3m → set target health 50, broadcast `game:health` |
| `game:heal` | `{ targetId }` | validate target within 3m & room item economy ignored → target +30 hp, broadcast |
| `game:bossHit` | `{}` | `registerBossHit(boss, playerId, Date.now())` (validates phase/dizzy/rate) |
| `game:bossBallot` | `{ x,z }` | `grabBallot(boss, playerId, x, z)` using SERVER player position |
| `game:bossDeposit` | `{ x,z }` | `depositBallot(boss, serverPlayerPos)` → if true votes++, broadcast |
| `game:ping` | `sentAt` | emit `game:pong` back with same value |
| `game:leave` | — | cleanup |

## Server → Client events
| event | payload | rate |
|---|---|---|
| `game:joined` | `{ ok, playerId, roomId, roomCode, serverTime, players, npcs, items, checkpoints, tokensNeeded, tokensCollected, boss, matchStartedAt }` | once |
| `game:players` | `PlayerNetState[]` (id,name,archetype,x,y,z,ry,anim,health,detained,dazed,tokens,carrying) | 12 Hz |
| `game:npcs` | `NpcNetState[]` (id,x,z,ry,state,alert) | 10 Hz (include searchlight ry in `ry`) |
| `game:items` | `ItemNetState[]` | on change |
| `game:boss` | `(bossNetState, ballots)` — boss fields include speechProgress, interruptPoints, documents, hits, dizzyTimer, teamworkProgress, votes, votesNeeded | 10 Hz when active, 1 Hz idle |
| `game:capture` | `(playerId, untilEpochMs, message)` — from tickNpc capture events; server sets player.detained, freezes their position updates; detention = DETENTION_SECONDS (× 0.75 if archetype accidental) | on event |
| `game:release` | `(playerId, x, z)` — at checkpoint.detention of furthest activated checkpoint | on timer |
| `game:checkpoint` | `(checkpointId, byName, totalActivated)` — player position enters cp radius | on event |
| `game:tokens` | `(count)` | on change |
| `game:gate` | `(open)` — tokens >= TOKENS_NEEDED; also clears the gate collider server-side (allow z < gateZ) | on change |
| `game:health` / `game:damage` | `(playerId, health, dazed)` / `(playerId, amount, kind)` — boss tickBoss damage events + stamp/paperwork hits applied server-side | on event |
| `game:matchend` | `{ matchId, victory, duration, position, tokens, distance?, ... }` — matchId = `m_<random>`; victory when boss phase 6; **distance** per player may be omitted (client tracks own) | once |
| `game:playerjoined` / `game:playerleft` | `(playerId, name)` | on event |

## Server tick (setInterval 100ms)
1. dt = 0.1, now = Date.now()
2. For each room: tick NPC brains `tickNpc(brain, playerViews, world.colliders, dt, now)` → capture events → handle detention.
   playerViews = players not detained/dazed.
3. Searchlights: `ry += speed * dt` (store on room; include in npc snapshot via ry for searchlight ids).
4. Vehicles: deterministic from `matchStartedAt` — no simulation needed, but collision damage IS server-side:
   compute vehicle positions from elapsed time; any player within hit radius → `game:damage` (cooldown 1.2s/player).
5. Boss: if any eligible player inside arena radius 30 of boss center → boss.started = true.
   `tickBoss(boss, playerViews, dt, now)` → damage events → `game:damage`; phaseDone → broadcast; defeated →
   `game:matchend` per room + mark room ended.
6. Broadcast `game:players` + `game:npcs` snapshots.
7. Detention timers: expired → release at furthest activated checkpoint detention point → `game:release`.
8. Match duration cap 900s → emit matchend (non-victory).

## Validation & anti-cheat
- Clamp positions to world bounds ±47/±570.
- Speed check: max 12m/100ms; offenders snapped back.
- Pickup radius 3m from item spawn. Revive radius 3m. Rate-limit noise/emote (5/s).
- Never trust client health/boss/tokens — server owns these.
- Room cleanup when empty; global player cap 200.
