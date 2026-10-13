# VoteChor Worklog

---
Task ID: 1
Agent: Z.ai Code (main)
Task: Inspect repo, install deps, design architecture, build shared foundation + full 3D game engine

Work Log:
- Read master prompt (VoteChor: 3D multiplayer satirical protest game)
- Installed three, @types/three, socket.io, socket.io-client
- Prisma schema: Player, MatchResult, PlayerStats, Achievement, PlayerAchievement, DailyChallenge → db:push OK
- Built shared pure logic (importable by client + game server):
  - src/game/shared/types.ts — all protocol/world/boss types
  - src/game/shared/constants.ts — archetypes (8), movement, detection, items, XP, achievements, humor pools
  - src/game/shared/world-def.ts — deterministic seeded procedural city (5 zones, colliders, 40+ items, 25 npcs, 6 searchlights, 6 vehicles, 4 checkpoints, boss arena)
  - src/game/shared/npc-brain.ts — NPC FSM (patrol/suspicious/investigate/chase/capture/return), LOS via segment-AABB, noise distractions
  - src/game/shared/boss-brain.ts — 5-phase Great Vote Collector FSM (speech, bureaucracy, stamp, teamwork, final vote) with ballots/telegraphs/stations/paperwork
- Built client engine:
  - engine.ts (renderer/sky/lights/adaptive quality/fixed-step loop), input.ts (kbd+mouse+touch, rebindable), physics.ts (AABB world + step-up), camera.ts (third-person, wall clip, shake)
  - character.ts (procedural rigs, 8 archetypes + police/security/guard + giant boss model), player.ts (accel/sprint-stamina/jump/slide/damage/dazed/detained)
  - world.ts (canvas textures, buildings w/ shop signs+awnings, stalls, fountain particles, banners, watchtowers, searchlight cones, checkpoint gates, boss arena + energy gate, instanced crowd, dust)
  - npcs.ts (server-state interpolation + offline local sim; vehicles incl. cow hazard), items.ts (8 item types, projectiles, respawn), boss.ts (boss visuals, telegraphs, paperwork, ballots, stations), net.ts (socket.io client w/ full protocol), audio.ts (fully synthesized WebAudio SFX + adaptive music + crowd ambience)
  - game.ts orchestrator (~1070 lines): match flow, checkpoint/gate logic, detention, HUD sync, minimap drawing, XP + /api/matches persistence, UI actions bridge
- src/lib/game-store.ts — zustand store contract for UI
- docs/PROTOCOL.md + docs/UI-SPEC.md written for parallel subagents
- tsc --noEmit passes for all game/lib files

Stage Summary:
- Engine is complete and type-checks. Solo offline mode fully playable client-side.
- Next: parallel subagents build (2-a) authoritative game server on port 3002, (2-c) API routes, (2-d) full UI; then integration page.tsx + testing.

---
Task ID: 2-c
Agent: api-backend-agent
Task: Build REST API backend (profile, matches, leaderboard, achievements, stats, health)

Work Log:
- Created 6 route handlers under src/app/api/ (all: `runtime='nodejs'`, force-dynamic, try/catch → 500 {error}, strings sanitized by stripping <>&):
  - POST /api/profile — token-upsert or create (crypto.randomUUID token, default name Protester_<4 digits>), name 2..24 validation, archetype whitelisted from ARCHETYPES, cosmetics deep-sanitized + JSON (≤2000 chars), ensures PlayerStats row + seeds Achievement catalog; returns {profile:{id,name,archetype,xp,level,cosmetics},token}
  - POST /api/matches — x-vc-token required (401), clamps distance 0..20000 / checkpoints 0..4 / rescues,revives,detentions 0..50 / items 0..200 / bossContribution 0..30 / tokens 0..16 / position 0..50; matchId PK duplicate → idempotent 200 {duplicate:true,...} (409 if another player owns the id); server-authoritative XP from XP_TABLE; funnyTitle via VICTORY_TITLES; $transaction: create MatchResult, upsert PlayerStats (increment totals, wins=+victory, bestPosition min>0, bossKills+=victory), Player xp+=xpEarned + level=levelFromXp; achievement checks (first_steps, untouchable, marathoner 3km, token_collector 25 lifetime tokens via MatchResult sum, rescuer 3, medic 5, boss_slayer, democracy_defender, traffic_cone 10 detentions) — existing PlayerAchievement codes queried first, response lists only newly added [{id,name}]
  - GET /api/leaderboard?sort=xp|distance|wins&limit=1..50 — Player+PlayerStats join → {entries:[{name,level,xp,value,archetype}]}
  - GET /api/achievements — seeds catalog if stale, optional x-vc-token → {all: db rows in ACHIEVEMENTS order, unlocked:[ids]}; 401 on bad token
  - GET /api/stats — x-vc-token required → {stats, recent: last 10 MatchResult}
  - GET /api/health — {ok:true,time}
- Basic in-memory rate limiting (Map<key,timestamps[]>, 30 req/min, 429) on both POST routes, keyed by token (or IP for anonymous profile create)
- SCHEMA ADDITION (additive, non-destructive): prisma/schema.prisma MatchResult += `tokens Int @default(0)` + `prisma db push` + client regen — required by spec ("sum of MatchResult tokens ≥ 25" for token_collector); client (game.ts) already posts tokens per match
- DEVIATION NOTE: Prisma 6 SQLite createMany does NOT support skipDuplicates (typed never) → seeding + PlayerAchievement grants use per-row upserts (idempotent, same semantics)
- tsc --noEmit: zero errors in src/app/api; live smoke tests all green (see below)

Smoke tests (curl, dev server :3000 — real outputs):
- POST /api/profile create → {"profile":{"id":"cmv6j0cfj0000ooxjjxn8lj5z","name":"RavanRunner","archetype":"chai_sprinter","xp":0,"level":1,"cosmetics":{"hat":"cap","glasses":true,"signText":"bChai/b over chai"}},"token":"4524179f-..."} (cosmetics XSS stripped)
- profile update + validations → rename OK; {"name":"X"} → 400 "Name must be 2-24 characters"; {"archetype":"dictator"} → 400 "Unknown archetype"
- POST /api/matches victory → {"xpEarned":2595,"level":5,"leveledUp":true,"newAchievements":[first_steps,untouchable,rescuer,medic,boss_slayer,democracy_defender],"funnyTitle":"Jailbreak Legend"} (XP hand-verified: 50+1420.5×0.35+4×60+12×45+3×90+5×70+26×4+12×12+400)
- same matchId replay → {"duplicate":true,"xpEarned":2595,...,"newAchievements":[]} — no double XP
- match 2 → marathoner+token_collector+traffic_cone unlocked; match 3 (999999m/999 tokens/99 checkpoints) → clamped to 20000/16/4 → xpEarned 8370
- no token → 401 "Missing x-vc-token header"; bogus token → 401; missing matchId → 400
- leaderboard xp/distance/wins → sorted correctly (13080 / 23320.5 / 2)
- GET /api/achievements → 12 rows, 9 unlocked; GET /api/stats → stats + 3 recent; GET /api/health → {"ok":true,...}
- rate limit: 31 rapid POSTs → 30×200 + 1×429

Stage Summary:
- Full REST API backend complete, type-clean, and live-verified end-to-end (XP math, clamps, idempotency, achievements, rate limits). UI subagent (2-d) can consume endpoints per docs/UI-SPEC.md contracts.
- Next: UI components (2-d), game server integration (2-a), then page wiring + integration testing.

---
Task ID: 2-d
Agent: ui-agent
Task: Build the complete React UI for VoteChor (src/components/game/) per docs/UI-SPEC.md

Work Log:
- Created 19 files under src/components/game/ (3,116 lines total, all 'use client', zero static imports of '@/game/game'):
  - GameRoot.tsx — fixed #game-canvas + hidden 140x420 minimap buffer canvas; dynamic `import('@/game/game')` boot with StrictMode guard; hydrates localStorage('votechor_settings') before boot; profile bootstrap (reads votechor_profile, else POST /api/profile with Protester_XXXX name, persists {token, profile}); per-mode overlay routing (menu/loading/playing/paused/ended); global <style> block with poster utilities (.vc-paper texture, .vc-stamp-texture, .vc-scroll scrollbars) + keyframes (vc-marquee, vc-orbit, vc-blink, vc-stamp-in, vc-wobble); inline LoadingScreen ("Democracy is loading…" + rotating tips + animated bar).
  - MainMenu.tsx — hero (VOTECHOR w/ wobble, tilted "THE GREAT PARLIAMENT RUN" stamp, tagline), marquee of RANDOM_NOTIFICATIONS, menu grid w/ Lucide icons wired to uiActions().startSolo/menuScreen, player card (level via levelFromXp, XP progress vs xpForLevel, archetype chip, inline rename → POST /api/profile), satire footer pinned via mt-auto, menuScreen routing to Customize/Play screens + Settings/HowToPlay/Leaderboard/Achievements/Stats dialogs.
  - CharacterSelect.tsx — 8 ARCHETYPES cards with CSS character preview (skin/hair/shirt/pants/accent + cap/topi hats + glasses), perk badges, color swatches; select → uiActions().selectArchetype + POST /api/profile; cosmetics (hat, glasses, 24-char sign text with live sign preview) → uiActions().updateCosmetics + POST.
  - PlayScreen.tsx — Solo start, 6-char room code input (sanitized/uppercased), public join + Quick Match → uiActions().joinMultiplayer(code|null), joining spinner, joinError panel, server info strip; resets joining state on mount.
  - Hud.tsx — health/stamina bars (Heart/Zap), tokens pill + distance + speed-boost countdown, objective banner with checkpoint progress, connection/ping/players/match-timer/FPS cluster, squad mini-list, inventory slots (ITEM_CONFIG emoji, 1-8 keycaps, click=use, right-click=drop, hover labels, dashed empties), interact prompt pill, revive progress, carrying-ballot pill, rAF minimap strip copied from engine buffer (click → big map), fading zone banner on zoneName change, DETAINED stamp overlay (random CAPTURE_MESSAGES + countdown, vc-stamp-in), Dazed overlay (orbiting stars), low-health vignette, per-corner scale-90 sm:scale-100 mobile compaction.
  - BossBar.tsx — spring-in top bar: boss name/health, BOSS_PHASE_NAMES phase w/ icons, 5 phase-segment shield bar, objective + progress, votes x/needed in phase 5, flashing DIZZY alert.
  - NotificationStack.tsx — AnimatePresence toasts, 6 kind-based color/icon styles, 4.5s auto-dismiss, click-dismiss, popLayout.
  - EmoteWheel.tsx — radial 6-emote wheel (local EMOTES copy), spring bloom, click → uiActions().sendEmote, G/Esc/backdrop close.
  - QuickMessages.tsx — floating T-button + panel of 10 local QUICK_MESSAGES copies → uiActions().sendQuickMessage(i), ignores keystrokes typed into inputs, Esc closes.
  - PauseMenu.tsx — Resume (setUIMode('playing')), Settings, How to Play (dialogs), Quit to Menu (uiActions().leaveMatch()), match time/tokens chips.
  - EndScreen.tsx — victory/defeat banner, funny-title stamp (springs in), 10-stat grid, XP earned + animated level bar + LEVEL UP flash, new achievements chips, Play Again / Menu, cancellable 14s auto-return.
  - SettingsPanel.tsx — Dialog with volume/sensitivity sliders, invert-Y/showFps/reducedEffects switches, quality Select, 13 keybinds with click-to-rebind (captures event.code, rejects clashes, ESC cancels), reset-to-defaults; every change → store.setSettings + localStorage('votechor_settings').
  - HowToPlay.tsx — mission briefing, 13-row controls table with keycaps, 6-phase boss field guide, Uncle Ji survival tips; usable from menu (screen) and pause (dialog).
  - LeaderboardPanel.tsx — /api/leaderboard?sort=xp|distance|wins with Tabs, medal ranks, level chips, value formatting, refresh + loading skeletons + humor error state.
  - AchievementsPanel.tsx — /api/achievements with x-vc-token; ACHIEVEMENTS grid mapped to Lucide icons, unlocked vs grayscale+Lock, XP rewards, progress bar, local fallback on failure.
  - StatsPanel.tsx — /api/stats with token; 10 defensive total cards (?? 0), total XP strip, refresh, error state.
  - BigMap.tsx — rAF-scaled buffer copy to 320x700 canvas (imageSmoothing off), hardcoded zone label overlays matching world z 4→-572 mapping, checkpoint/boss markers, legend column, live current-zone chip, backdrop/close.
  - TouchControls.tsx — touch detection (lazy useState), lazy `import('@/game/game').touchBridge()` cache (no static import); 124px pointer-capture joystick → move(dx,dy) normalized -1..1 (matches input.ts forward=-y), buttons Jump/Slide/Throw one-shots + Sprint/Interact holds via bridge.btn.
  - SquadPanel.tsx — Tab overlay: squad rows (archetype dot, health bar, DETAINED/Dazed badges, distance), squad field-manual tips.

Verification:
- `bunx tsc --noEmit 2>&1 | grep "src/components/game"` → EMPTY (only pre-existing errors in mini-services/ and skills/, untouched)
- `bun run lint 2>&1 | grep "components/game"` → EMPTY (fixed lucide Signpost name, react-compiler set-state-in-effect ×3, unused eslint-disable directives, component-created-in-render)
- No console.log / TODO / placeholder code; EMOTES + QUICK_MESSAGES are local copies so three.js never enters the UI graph.

Assumptions:
- /api/profile POST returns {token, profile}; rename/archetype/cosmetics updates POST with x-vc-token (Task 10-c contract).
- Engine registers uiActions inside boot() and sets uiMode='menu' at the end of boot, so all action calls are safe by the time menus render; UI never imports game.ts statically.
- page.tsx wiring (<GameRoot/> via next/dynamic ssr:false) is deliberately left to the integration task per worklog plan.
- /api/stats shape is defensive (unknown keys render 0); leaderboard entries {name,level,xp,value} per spec.

Stage Summary:
- Full game UI complete: menu → customize → play → HUD → boss → pause → end, plus panels, map, touch, toasts, emotes, squad. Design system: saffron/marigold/chili/leaf/ink/paper protest-poster style with hard shadows, stamps, paper texture, framer-motion entrances, responsive scaling.
- Next: integration task mounts GameRoot in src/app/page.tsx (dynamic ssr:false) and end-to-end testing with API routes (2-c) and game server (2-a).

---
Task ID: 3
Agent: Z.ai Code (main, integration + QA)
Task: Integrate all subsystems, fix bugs found in browser QA, run end-to-end verification

Work Log:
- Wired src/app/page.tsx (dynamic GameRoot ssr:false) + layout.tsx (game metadata, viewport, overflow-hidden body)
- Added touchBridge() to game.ts (mobile UI → InputManager) and window.__vc debug handle
- Fixed real bugs found via agent-browser QA:
  1. Camera yaw at spawn was π (facing backwards) → 0 (down the road)
  2. Spawn-camping: plaza patrols crossed the center road → moved to plaza sides; added 10s spawn grace (server room.ts joinedAt + client offline hidden flag)
  3. InputManager: normalized missing e.code (automation/IME safety)
  4. touchBridge never called input.sync() → touch input would not move player (real mobile bug) → fixed
  5. Client vehicle clock now synced to server matchStartedAt (visuals match server-side damage)
  6. Menu button text truncation ("OPTIO…") → responsive sizing
  7. game.ts: removed require() calls (ESM), fixed boss HUD progress fields, fog cast, TDZ in test
- Rewrote game-server integration test to be self-correcting (hops from server snapshots, capture-aware waiting, filtered listeners)
- game-server: 28/28 integration tests PASS (join, snapshots, capture+detention 15s accidental, release at checkpoint, tokens, anti-teleport snap, vehicle damage 35/auto, health 65, heal 95, gate snap, ping, throw validation, emote rate-limit, quickmsg validation, private rooms, playerleft×2)
- Browser E2E verified (agent-browser, http://localhost:81 via Caddy):
  * Main menu renders (protest-poster style, marquee, player card)
  * Solo + multiplayer both CONNECT through gateway (XTransformPort=3002)
  * World renders: buildings w/ shop signs, fountain, stalls, crowd protesters w/ signs, trees, benches, billboards
  * Player movement (walk 5.2 m/s verified), jump verified
  * Token pickup via E verified (tokens: 1), bottle throw verified (projectile spawned)
  * Server captured player → DETAINED overlay w/ funny message + countdown + release
  * Boss: gate opens at 12 tokens, arena trigger, intro → Phase 1 speech w/ megaphone stations (interruptPoints rising, station active), Phase 3 stamp telegraphs + DIZZY window + HUD "Throw items!"
  * Victory: phase 6 → EndScreen "DEMOCRACY RESTORED!" + funny title "Ghost of the Galli" + XP 501 + LEVEL 3
  * DB persistence verified via /api/stats: matchesPlayed 1, wins 1, bossKills 1, totalXp 501
  * Big map overlay (5 zones, checkpoints, legend, current zone)
  * TWO independent agent-browser sessions in same public room: both show playersOnline=2, P1 renders P2's rig with name tag, position sync verified to ~20cm, squad panel live health
- Note: headless QA env runs ~3.5fps (rAF throttled) → game sim runs ~30% speed there; real browsers run full 60fps step loop
- Services running: Next dev :3000, game-server :3002 (setsid bun --hot), Caddy gateway :81

Stage Summary:
- COMPLETE GAME LOOP VERIFIED END-TO-END: menu → play → move/pickup/throw → capture/detention → checkpoints → token gate → 5-phase boss → victory → XP/level/achievements persisted → leaderboard-ready
- Multiplayer is real (2 sessions verified), server-authoritative (captures, damage, items, boss)
- Known limitations: headless perf, ESLint clean, tsc clean for game/UI/api
