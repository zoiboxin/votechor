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

---
Task ID: 4
Agent: Z.ai Code (cron webDevReview round 2)
Task: QA pass + Daily Challenge system + navigation/juice features + styling polish

Work Log:
- QA: all services healthy (Next :3000 fresh Prisma client after restart, game-server :3002, Caddy :81); movement/pickup/connection re-verified in browser
- FEATURE — Daily Challenge system (end-to-end, verified):
  * Schema: Player.dailyDate/dailyKind/dailyProgress/dailyClaimed + db push
  * src/lib/daily.ts — deterministic per-day roll (hash of YYYY-MM-DD over 6-challenge pool: distance/items/tokens/checkpoints/rescues/boss)
  * GET /api/daily (rolls + tracks per-player progress), POST /api/matches now accumulates daily progress per match, grants bonus XP once (dailyBonus + justCompleted flags, idempotent via claimed)
  * Browser-verified: match1 checkpoints=2 → progress 2/3; match2 → 3/3 → dailyBonus 160, xpEarned includes bonus
  * MainMenu DailyCard (reward chip, progress bar, claimed state) + EndScreen bonus ribbon + store setDaily
- FEATURE — Compass strip (top-center): cardinal N/E/S/W relative to camera yaw, 15° ticks, markers for nearest token (≤90m), next checkpoint, boss (gate open), squadmates, with distance labels + edge-cling indicators when off-screen; hidden during cinematic/detained
- FEATURE — Floating world popups (new src/game/fx.ts): canvas-sprite pooled text popups that rise/fade — token (+45 XP / VOTE RECOVERED!), item names, +50 HP, CHECKPOINT +60 XP, boss BONK! -1 SHIELD
- FEATURE — Boss intro cinematic: 4.2s orbiting camera + letterbox bars + "THE GREAT VOTE COLLECTOR — Minister of Missing Votes · 14-term champion of paperwork" banner, input frozen (state 'frozen'), boss theme + gate sting; verified firing and releasing control
- STYLING — CinematicOverlay: vignette (deepens at low HP), low-health pulse ring, animated SVG film grain (respects reducedEffects), boss letterbox; MainMenu drifting paper motes (vc-mote keyframes, 14 flyers)
- BUGFIX — localStorage profile went stale after matches (menu showed old level/XP on reload): finalizeMatch now syncs votechor_profile with fresh xp/level
- BUGFIX — toasts overlapped compass: NotificationStack moved top-3 → top-11
- OPS — Next dev server restarted to pick up regenerated Prisma client (old process cached pre-dailyDate client → PrismaClientValidationError on /api/daily)
- All checks clean: eslint, tsc (game/UI/lib/api), no page errors

Stage Summary:
- Round 2 shipped: Daily Challenges (retention loop), compass navigation, world-space juice popups, boss cinematic, film-grain/vignette dressing
- Verified: daily API accumulation + bonus grant, compass markers w/ live distances, cinematic trigger/release, popup rendering, menu card
- Risks/next: compass markers could include chai/firstaid when needed (kind exists); consider zone-entry vignette tinting; game-server restart needed if shared world-def patrol changes again

---
Task ID: 5
Agent: Z.ai Code (cron webDevReview round 3)
Task: QA assessment + cosmetic unlock system + reconnect overlay + onboarding hints + styling polish + profile-bootstrap bugfix

Work Log:
- QA ASSESSMENT: all services healthy (Next :3000, game-server :3002, Caddy :81); menu/customize/solo boot/multiplayer connect/movement re-verified via agent-browser; zero console errors at round start → project STABLE → chose feature development over bugfixing (one major bug surfaced later, see below)
- BUGFIX (major) — profile bootstrap created a duplicate player on EVERY page reload:
  * GameRoot.tsx captured `const st = useGameStore.getState()` then checked `st.profile` AFTER calling `st.setProfile(...)` — stale snapshot (zustand set replaces the state object) → always truthy-falsy wrong → POST /api/profile created a fresh row named Protester_XXXX each reload, clobbering localStorage profile (all progression wiped per reload)
  * DB evidence: 12 duplicate Protester_7244 rows; fixed by checking fresh `useGameStore.getState().profile` + added server refresh path (POST with x-vc-token + empty body) so stored profiles re-sync XP/unlocks on boot; cleaned 11 dup rows from DB
  * Verified: profile (UnlockTest LV3) now survives reload; DB count stable at 7
- FEATURE — Cosmetic unlock system (server-authoritative, per master prompt §16):
  * src/lib/cosmetics.ts (new): 6-hat catalog — none/cap free, topi LV3, garland→medic, cone→traffic_cone, crown→boss_slayer; pure `unlockedHatIds`/`hatIsUnlocked` helpers shared by API + UI
  * /api/profile: validates requested hat vs player level + granted PlayerAchievements → 403 "Locked — Reach level 3" / "Locked — Earn medal: BOSS SLAYER"; rejects unknown ids; response now includes unlockedHats[]
  * character.ts: 3D hat renders — traffic cone (cone+white band+base), Crown of Chaos (metallic gold band + 5 spikes + red/green jewels), marigold garland (two torus rings on torsoPivot)
  * CharacterSelect.tsx: "Headgear Locker" grid (6 cards) with lock icons, criteria labels (hover/focus reveals full unlock text), X/6 unlocked counter, dashed grayscale locked cards, locked-click warning toast; CSS pixel previews for cone/crown/garland; fetches /api/achievements for unlocked codes
  * Verified via curl: locked crown/topi → 403; level-up to LV3 → topi equips; unlockedHats grows; in-game 3D screenshots confirm crown/cone/garland all render on the rig
- FEATURE — Reconnect system (master prompt §15 "reconnecting screens"):
  * ReconnectOverlay.tsx (new): full-screen poster overlay — "SIGNAL LOST" rubber stamp, WifiOff badge, "THE COMMITTEE CUT OUR LINE", spinner strip, [Keep Playing Offline] [Quit to Menu]; auto-hides when connection returns
  * store: +matchMode field (set in startMatch, cleared on leave); game.ts: lastRoomCode + reconnectNotified tracking; multiplayer onDisconnect flags reconnect; onConnect auto-rejoins the room (name/archetype/cosmetics/roomCode)
  * net.ts: reconnectionAttempts 3→Infinity, reconnectionDelayMax 3000 (retry for as long as the match lives)
  * End-to-end verified: kill -9 server mid-match → overlay appears (conn=false) → server restart → socket auto-reconnects → auto-rejoin (new playerId) → overlay hides, match continues
- FEATURE — First-match onboarding: one-time 4-tip toast sequence (compass→tokens, E/Q interact, checkpoints, boss gate) at 2.5s/9.5s/16.5s/23.5s, localStorage('votechor_onboarded') gated, timers cleared on leave; verified firing in-game
- STYLING (mandatory polish):
  * PlayerCard: conic-gradient XP progress RING around level badge (was flat pill) + "WEARING <hat>" emoji watermark row
  * MenuButton: shine sweep on hover (vc-shine keyframe) + icon rotate/scale micro-interaction
  * MarchStrip (new): 5 silhouetted protesters (2 carrying "CHAI!" signs) endlessly marching along the menu bottom above the footer (vc-march + vc-march-bob keyframes, ground line) — scaled/staggered
  * ReconnectOverlay/locker/lock cards all use the protest-poster system (paper, hard shadows, stamps)
- OPS FINDINGS (important for future rounds):
  * Sandbox reaps background processes spawned plainly (setsid alone died silently twice in ~2min, no log trace). WORKING pattern: `( setsid bun --hot index.ts > /tmp/gs.log 2>&1 < /dev/null & )` from mini-services/game-server — double-fork subshell survived >10min
  * agent-browser WebGL contexts exhaust after many game reloads in one session ("Context Lost" + blocked creation) → `agent-browser close --all` resets before 3D QA
  * game.ts eval clicks need case-insensitive /play solo/i (CSS uppercase ≠ DOM text)
- All checks green: tsc (game/UI/lib/api), eslint, no console errors; services running (Next :3000, game-server :3002 via double-fork, Caddy :81)

Stage Summary:
- Round 3 shipped: server-validated cosmetic unlocks (6 hats, 3 new 3D renders), reconnect overlay + auto-rejoin with infinite retry, onboarding tips, XP ring/marchers/shine styling, and a major progression-wiping bootstrap bug fixed + DB deduped
- Verified end-to-end in browser: locks render + enforced by API, all hats render in 3D, kill→overlay→restart→auto-rejoin loop, profile persistence across reloads
- Risks/next: CharacterSelect achievement fetch is mount-once (unlock doesn't live-refresh mid-session — reload picks it up); remote-player new-hat rendering untested with 2 clients (flows through same rig code); consider cosmetics section in HowToPlay; game-server restarts must use the double-fork pattern

---
Task ID: 6
Agent: Z.ai Code (cron webDevReview round 4)
Task: QA assessment + mouse-look critical bugfix + speech bubbles + spectate mode + photo mode + zone tint + first-aid compass + styling polish

Work Log:
- QA ASSESSMENT: all services healthy (Next :3000, game-server :3002 via double-fork, Caddy :81); menu/solo boot/movement/multiplayer re-verified via agent-browser; zero console errors at round start → project STABLE → chose feature development
- BUGFIX (CRITICAL) — mouse-look was completely dead since round 1:
  * game.ts fixedUpdate called `input.consumeLook()` but DISCARDED the result; renderUpdate passed hardcoded `[0,0]` to camRig.update → camRig.yaw/pitch NEVER changed from mouse input (camera was permanently fixed behind player)
  * Fixed: fixedUpdate now applies consumed look deltas to camRig.yaw/pitch (clamped; wider pitch range -0.2..1.25 in photo mode)
  * Verified: synthetic lookDx injection rotates camRig.yaw 0 → 0.6; camera orbits correctly
- FEATURE — NPC satire speech bubbles (master prompt §14 humor):
  * src/game/bubbles.ts (new): SpeechBubbleSystem — pooled canvas-sprite paper bubbles (ink border, tail, word-wrap, pop-in animation, bob, fade), one bubble per NPC key, POOL_MAX 10
  * NPC_LINES pools: 8 police lines, 4 chase lines ("STOP! You are under arrest for jogging!"), 5 security lines, 5 guard lines; chasing officers get chase-specific lines at shorter duration
  * npcs.ts: bubbles group added to NPC group; update(dt, alpha, t, px?, pz?) spawns a bubble every 3.6-7s on a random NPC within 34m of player; game.ts passes player pos (render loop only, both playing + paused)
  * Occlusion: bubbles hide when a physics raycast (camera → anchor) is blocked (walls/buildings) — wired via bubbles.occlusionCheck in game.ts boot
  * Verified in browser: "No assembly of more than one (1) citizen." rendered above a market patrol officer, correctly hidden when behind buildings
- FEATURE — Spectate mode while detained (multiplayer):
  * game.ts renderUpdate: when detained, camera focus switches to nearest non-detained teammate (smooth camRig lerp), tracks spectateName; syncHud patches hud.spectating (8Hz)
  * DetainedOverlay: SPECTATING chip (live ping dot, teammate name) + "The revolution continues through them" caption; DETAINED stamp shrinks and blur removed so the teammate stays visible; offline/solo unchanged
  * Verified with 2 live sessions in one public room: fake capture → camera flew to teammate + chip rendered; release → cleared (8Hz race noted, correct on next sync)
- FEATURE — Photo Mode (P key):
  * game.ts: window keydown handler (P toggle, O filter, K snapshot — gated by uiMode==='playing'); player frozen ('frozen' state), camera auto-drifts 0.1 rad/s + full mouse orbit, distance 7.2 (restored 5.4 on exit)
  * engine.ts: preserveDrawingBuffer:true for snapshot support
  * 4 filters on the WebGL canvas: Natural / Poster Punch (saturate 1.4) / Vintage Press (sepia) / Committee Noir (grayscale); O cycles with toast
  * K downloads PNG via canvas.toDataURL → anchor download (`votechor_photo_<timestamp>.png`) + "Protest Press Club" toast
  * PhotoHud.tsx (new): viewfinder frame, corner ticks, camera badge + filter chip, EXIT/FILTER/SNAPSHOT buttons (touch-friendly), key hints; GameRoot hides ALL HUD/companions when photoActive and renders PhotoHud instead
  * PauseMenu: new "Photo Mode" button (yellow, camera icon) → resume + deferred toggle (touch access); exits cleanly on capture/detention/pause/leave/finalize
  * Verified: P/O/K keys + pause-menu entry + snapshot download all work; filters apply visually
- FEATURE — Zone-entry styling: ZONE_ACCENTS map (game-store.ts) — Hud zone banner got accent color top strip; CinematicOverlay renders zone-tinted radial wash re-keyed per zone (vc-zonetint keyframe fades 0→1→0 over 2.4s, pure CSS, no state); verified banner strip in Security Checkpoint
- FEATURE — First-aid compass markers: when health < 45, nearest untaken firstaid within 130m gets a 'firstaid' marker (pink Cross icon + edge cling); verified markers ["token:44m","firstaid:31m","checkpoint:70m","squad:0m"] with health forced to 30
- FIX — CharacterSelect hat unlocks now live-refresh: achievements refetch on mount + window focus + 15s interval (was mount-once)
- HowToPlay controls table: added P (Photo Mode) row
- OPS: game-server restarted (double-fork pattern) to flush 2 stale zombie sessions polluting the public room; reconnect system auto-rejoined both times (re-verified)
- All checks green: eslint (fixed react-hooks/set-state-in-effect in CinematicOverlay by going stateless), tsc (game/UI/lib), zero console errors in QA sessions

Stage Summary:
- Round 4 shipped: CRITICAL mouse-look fix (camera was permanently frozen since round 1 — biggest gameplay bug yet), world satire speech bubbles with wall-occlusion, multiplayer spectate-while-detained, full Photo Mode (orbit/filters/PNG export, pause-menu + touch access), zone accent banners + tint washes, first-aid compass guidance, live hat-unlock refresh
- Verified end-to-end in browser incl. 2-session multiplayer spectate; snapshot download confirmed; lint/tsc clean
- Risks/next: preserveDrawingBuffer has minor GPU cost (acceptable); bubbles max 1 concurrent per NPC (fine); consider Photo Mode zoom via wheel, achievements toast integration for hats, squad respawn/emote propagation polish; headless QA env still ~3.5fps (sim slowed) — real browsers unaffected

---
Task ID: 7
Agent: Z.ai Code (cron webDevReview round 5)
Task: QA assessment + social speech bubbles for players + touch camera-look + photo wheel zoom + WANTED chase alert + chai compass markers + duplicate-toast bugfix

Work Log:
- QA ASSESSMENT: all services healthy (Next :3000, game-server :3002, Caddy :81); lint + tsc clean; menu/solo boot/movement/quick-messages re-verified via agent-browser; zero console errors at round start → project STABLE → chose feature development
- FEATURE — Player social speech bubbles (emotes + quick messages now visible in-world):
  * game.ts: new playerBubbles SpeechBubbleSystem instance (same paper/ink style as NPC bubbles, shared occlusion check vs camera raycast), group added to scene, updated in renderUpdate, cleared on leave/startMatch
  * playEmote → bubble with EMOTE_LABELS text ("Hello, democracy!", "Protest dance move!", …) above own head; playRemoteEmote → bubble above remote rig; new sayBubble(key, text) helper anchors to local player or remote rig
  * BUGFIX (real gap): onQuickMsg relay existed in net.ts + server but was never bound in game.ts — remote quick messages were silently dropped. Now bound → bubble above sender's rig + toast "Name: msg"
  * BUGFIX: server relays game:quickmsg to the WHOLE room incl. sender → sender got duplicate toast + bubble from own echo; fixed with `playerId === this.net.playerId` self-echo guard
  * BUGFIX: QuickMessages.tsx added its own "You: …" toast on top of game.ts's notify → duplicate toasts for the sender; consolidated into game.ts (`You: ${msg}`), component notify removed (+ unused store selector removed)
- FEATURE — Touch camera-look (mobile could not orbit the camera at all before):
  * InputManager.addLook(dx,dy) — applies sensitivity + invertY like mouse; touchBridge().look() exposes it
  * TouchControls: right-half-screen invisible drag-to-look layer (pointer capture, sits under action buttons), LOOK_GAIN 2.6; pulsing "drag to look" affordance hint fades out after first use (per-mount)
- FEATURE — Photo Mode zoom (wheel + buttons):
  * photoZoom(dir) clamps targetDistance 2.2..11; wheel listener registered in ensurePhotoKeyHandler (wheel up = zoom in, wheel down = zoom out)
  * CRITICAL BUGFIX found during QA: renderUpdate forced camRig.targetDistance = 7.2 EVERY FRAME in photo mode → all zoom (wheel AND the new buttons) was instantly overridden. Removed; targetDistance now owned by photoZoom (set 7.2 on enter, 5.4 restore on exit unchanged)
  * PhotoHud: −/+ zoom button pair between Exit and Filter; hint bar now "P exit · O filter · K snapshot · wheel zoom"
- FEATURE — WANTED chase alert: renderUpdate computes chased (existing nearestChaserDistance < 18, works offline + online via server NPC states) → patchHud({hunted}) on state CHANGE only; Hud: red rubber-stamp "WANTED — RUN!" (Siren icon, vc-stamp-texture, spring stamp-in, pulse) at 30% screen height + red pulsing edge vignette when hunted (suppressed while detained or when low-health vignette already active); reset on leaveMatch
- FEATURE — Chai compass markers: stamina < 30 and no chai in inventory → nearest untaken chai within 120m gets orange Coffee-icon marker (kind existed in store/Compass but was never emitted; icon swapped Vote → Coffee; edge-cling color added). Verified dynamic appear/disappear with stamina
- STYLING (mandatory polish): WANTED stamp + hunted vignette (above), zoom buttons + hint text, drag-to-look hint chip, StatBar low-state treatment (bar + icon pulse, red value text when < 30%)
- QA METHODOLOGY NOTES (important for future rounds):
  * agent-browser console buffer ACCUMULATES across page loads — do not count duplicate log lines as multi-boot
  * An instrumented handler that throws on its first line looks identical to "event never delivered" — verify closures reference this.x correctly; my bootStamp debug (missing this.) created a false "wheel events don't arrive" rabbit hole
  * Fast Refresh while a Game instance is live leaves the OLD instance's closures holding dead module bindings (imported functions can throw) — ALWAYS hard-reload the page after editing game.ts before debugging runtime behavior
  * Direct method-call checks (window.__vc.photoZoom) + instance-method wrapping (g.photoZoom = wrapped(orig)) are reliable; wrapping window.__vc properties is NOT the registered listener ref
- All checks green: tsc (src clean; mini-services smoke-test errors pre-existing), eslint, zero console errors in final QA session
- Verified end-to-end in browser: emote bubble render, quickmsg single-toast + bubble, chai marker dynamic toggling, WANTED stamp + vignette render, photo zoom via wheel (7.2→6.0 in / back out) with persistence after renderUpdate fix, zoomed photo screenshot

Stage Summary:
- Round 5 shipped: in-world social bubbles (emotes + quick messages, local + remote, with 3 related bugs fixed incl. a previously-dead net relay), mobile drag-to-look camera, photo-mode wheel/button zoom (plus the per-frame override bug that would have broken it), WANTED chase alarm, chai compass guidance, and stat-bar polish
- Remote quickmsg bubble verified by code-path symmetry with the round-4-verified onEmote flow (2-session CLI limitation noted; recommend 2-session replay next round)
- Risks/next: consider squad emote propagation polish, remote-hat render re-verify with 2 clients, zone-entry vignette tinting exists (done round 4); game-server unchanged this round (no restart needed); worklog cumulative console note above

---
Task ID: 8
Agent: Z.ai Code (cron webDevReview round 6)
Task: QA assessment + Weekly Challenge system + Create Private Room + match history UI + stats key-mismatch bugfix

Work Log:
- QA ASSESSMENT: all services healthy (Next :3000, game-server :3002, Caddy :81); menu/solo boot/movement (z -8→-11 via synthetic key hold) re-verified via agent-browser; zero console errors at round start → project STABLE → chose feature development
- BUGFIX (pre-existing, found during QA) — 8 of 10 lifetime stat cards ALWAYS showed 0:
  * /api/stats returned the raw Prisma PlayerStats row (keys: matchesPlayed, totalDistance, totalItems…) while StatsPanel CARDS expect (matches, distance, itemsCollected, tokens, checkpoints, bossHits…) — only wins/detentions ever matched
  * Fixed server-side: route now returns normalized keys (UI contract) alongside legacy raw keys, plus NEW lifetime aggregates via MatchResult _sum: tokens, checkpoints, bossHits (= Σ bossContribution, rounded); browser-verified cards now show 200 m / 65 items for the test profile
- FEATURE — Weekly Challenge system (master prompt §16 "Daily and weekly challenges"; completes the pair):
  * src/lib/weekly.ts (new): WEEKLY_POOL (6 kinds, 4-5× daily targets, 600-950 XP rewards), weekKey() ISO-8601 Monday weeks ("2026-W42"), weeklyForDate() deterministic djb2 hash roll, weeklyContribution reuses dailyContribution
  * Prisma Player += weeklyDate/weeklyKind/weeklyProgress/weeklyClaimed → db push (additive)
  * GET /api/daily now also upserts a weekly_{week} DailyChallenge catalog row + rolls stale weekly + returns { weekly: { challenge, week, progress, claimed } }; POST /api/matches accumulates weekly progress in the same transaction, grants weeklyBonus ONCE on crossing target (claimed flag), returns weekly + weeklyBonus + weeklyJustCompleted
  * Store: WeeklyState (+week), weekly field, setWeekly; MatchSummary += weeklyBonus/weeklyJustCompleted; GameRoot boot fetch hydrates weekly; game.ts finalizeMatch parses + setWeekly + "WEEKLY CHALLENGE COMPLETE!" toast; EndScreen green ribbon (CalendarRange, mirrored rotation, delay 0.95)
  * VERIFIED end-to-end via curl: match1 25 items → weekly 25/60 no bonus; match2 +40 → 60/60 clamped, weeklyBonus 600, xpEarned 845 = 245 base + 600, justCompleted true; wk_test_1 replay → duplicate:true, xpEarned 185 (no double-anything); browser: WeeklyCard shows "WEEK 42 · DONE · Loot 60 items… 60/60 · WEEKLY QUOTA MET. GO HOME EARLY." with full green bar
- FEATURE — Create Private Room (master prompt §15 menu requirement):
  * PlayScreen: "Private Room" button (Ticket icon, maroon) generates a 6-char code from an unambiguous alphabet (no I/L/O/0/1) via crypto.getRandomValues, fills input + joins immediately; joining strip now shows a dashed protest-ticket code chip with Copy button (navigator.clipboard + execCommand fallback, 2s Check feedback, aria-label)
  * VERIFIED in browser: click → code TEZA4Q generated → joined online (running, offline:false, room=TEZA4Q, CONNECTED badge, multiplayer world)
- FEATURE — Match History in StatsPanel (endpoint returned `recent` since round 2 but UI never rendered it):
  * RecentMatch typed from API rows; renders last 10 as paper rows: tilted WIN/LOSS stamp (green/maroon), funnyTitle (fallback "Uncertified Protest"), MP badge for multiplayer, distance/checkpoints/tokens/XP/timestamp row (tabular-nums), #position chip; vc-scroll max-h-56 list; empty-state humor line
  * VERIFIED in browser: "MATCH HISTORY — LAST 2" + 2 rows (STREET KABADIWALAN, +245/+185 XP, Oct 13 · 13:33)
- STYLING (mandatory): WeeklyCard distinct leaf-green identity (gradient from-[#2e6e4e]/25, dashed orbit circle decoration, Week-N chip, green gradient progress fill), EndScreen weekly ribbon, maroon Private Room button + dashed code ticket, history stamp rows
- OPS: Next dev server restarted after prisma client regen (weekly fields) — old process served stale client → tx.player.update("weeklyDate") validation error on /api/matches; restart pattern: kill next pid tree then `( setsid bash -c 'bunx next dev -p 3000 2>&1 | tee dev.log' < /dev/null & )` from project root (plain `next` not on PATH in setsid shell; bunx works)
- All checks green: tsc (project src clean; only pre-existing skills/stock-analysis error), eslint clean, zero console errors across the whole QA session
- Test data left in DB: Protester_6328 (+wk_test_1/2 matches, 430 XP) — harmless, useful for leaderboard/history demos

Stage Summary:
- Round 6 shipped: Weekly Challenges (full retention loop: roll → accumulate → one-time bonus → reset Monday), Create Private Room with shareable code + copy ticket, Match History UI, and a stats-display bug that had silently zeroed 8/10 lifetime cards since round 1
- Verified: weekly accumulation/bonus/idempotency (curl), WeeklyCard done-state (browser), private-room online join (browser TEZA4Q), history rows (browser), stat card values (browser)
- Risks/next: weekly ribbon renders only when a match crosses the weekly target mid-session (code path symmetric to verified daily ribbon; not triggered live this round); browser QA session localStorage was re-pointed to the test profile Protester_6328 (real users unaffected); consider emote unlocks at levels (§16), item gifting to teammates (§11), remote-hat 2-client re-verify, squad creation/invitations as the next feature front
