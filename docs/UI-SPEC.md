# VoteChor UI Spec (React components in src/components/game/)

The 3D engine (src/game/game.ts) and UI communicate ONLY through:
1. `useGameStore` (zustand) in `src/lib/game-store.ts` — read state.
2. `uiActions()` from the same file — call actions (already registered by engine).

EVERYTHING is rendered as overlay on top of a full-screen `<canvas id="game-canvas">`.
Design language: warm satirical Indian protest poster style — saffron/marigold (#f2a541, #f2c14e),
deep chili red (#8c1f28), leaf green (#2e6e4e), ink (#1c1a17), cream paper (#f5efdc).
Use Tailwind 4 classes + existing shadcn/ui components in src/components/ui. Lucide icons.
Fonts: system-ui is fine; use `font-black tracking-tight` headers, uppercase for buttons.

## File layout (create exactly these)
- `src/components/game/GameRoot.tsx` — mounts canvas + minimap canvas + engine boot + all overlays.
  ```tsx
  'use client'
  - two canvases: <canvas id="game-canvas" className="fixed inset-0 w-full h-full" /> and
    <canvas ref={minimapRef} width={140} height={420} className="hidden" /> (minimap buffer; HUD copies from it)
  - on mount: getGame().boot(canvas, minimapRef.current!)
  - also on mount: profile bootstrap — POST /api/profile {name} using name from localStorage('votechor_name') or generated funny default (e.g. 'Protester_4821'); store returned profile via store.setProfile and persist token+profile to localStorage('votechor_profile')
  - render: <MainMenu/>, <LoadingScreen/>, <Hud/>, <PauseMenu/>, <EndScreen/>, <TouchControls/>, <EmoteWheel/>, <BigMap/>, <SquadPanel/>, <NotificationStack/>, <BossBar/> based on uiMode
  ```
- `src/components/game/MainMenu.tsx` — shown when uiMode==='menu'. Full-screen menu with:
  - Hero header: "VOTECHOR" huge + subtitle "The Great Parliament Run" + tagline "The votes are missing. The protest is on. Everybody run!" + animated marquee of funny notification strings.
  - Buttons: PLAY SOLO (uiActions().startSolo()), PLAY MULTIPLAYER (opens PlayScreen with room code input or Quick Match with null), CUSTOMIZE, HOW TO PLAY, SETTINGS, LEADERBOARD, ACHIEVEMENTS, STATS.
  - Show player card: profile name, level, XP progress bar (xpForLevel from shared/constants), archetype.
  - Name editing: input + save → POST /api/profile rename → update store + localStorage.
- `src/components/game/CharacterSelect.tsx` (screen 'customize' or inside 'play') — grid of 8 ARCHETYPES cards (from shared/constants): name, desc, perk, color swatches; 3D-ish preview using CSS (colored circles/hats). Selecting calls uiActions().selectArchetype(id) and persists via POST /api/profile {archetype}. Cosmetics: hat select (none/cap/topi), glasses toggle, signText input (max 24 chars).
- `src/components/game/PlayScreen.tsx` — Solo button, room code input (6 chars, optional → public), QUICK MATCH. On join: uiActions().joinMultiplayer(roomCode || null). Show joining spinner + joinError.
- `src/components/game/Hud.tsx` — visible when uiMode==='playing'. Reads store.hud + store.boss:
  - Top-left: health bar (red), stamina bar (yellow), tokens counter (🗳️ x/12), objective text.
  - Top-right: connection badge (green Connected / amber Connecting / red Offline), ping, playersOnline, match timer, FPS if settings.showFps.
  - Bottom-left: inventory slots (inventoryMax 8) — icon from ITEM_CONFIG[type].icon; click → uiActions().useItem(uid); right-click → drop. Keys hint "1-8 use".
  - Bottom-center: interact prompt (hud.interactPrompt) as floating pill.
  - Bottom-right: minimap panel — copies from the hidden minimap buffer canvas onto a visible <canvas width={140} height={420}> every frame via requestAnimationFrame (drawImage), rounded, border, "M — big map" hint. (Buffer is drawn by engine.)
  - Center-top: zone name banner that fades on change (hud.zoneName + zoneHint).
  - Detention overlay: when hud.detained — big "DETAINED" stamp + funny message + countdown detainRemain.
  - Dazed overlay: when hud.dazed — stars + "Recovering..." 4s.
  - carryingBallot → small "🗳️ carrying ballot — deposit at the box!" pill.
  - Squad list (top-right under connection) when squad.length > 0 or squadOpen: name, health mini-bar, DETAINED badge.
- `src/components/game/BossBar.tsx` — when boss.active: big top-center bar with boss name "THE GREAT VOTE COLLECTOR", phase name, shield segments (5 phases), objective text + progress bar, votes x/10 when phase 5, DIZZY flash when boss.dizzy.
- `src/components/game/NotificationStack.tsx` — top-center toast list from store.notifications, color-coded by kind, auto-dismiss 4.5s (setTimeout → dismissNotification), framer-motion AnimatePresence slide/fade.
- `src/components/game/EmoteWheel.tsx` — when emoteWheelOpen: radial wheel with 6 EMOTES (from game.ts import { EMOTES }) — click calls uiActions().sendEmote(id); Esc/G closes.
- `src/components/game/QuickMessages.tsx` — small panel toggled by holding T or a button: 10 QUICK_MESSAGES buttons → uiActions().sendQuickMessage(i).
- `src/components/game/PauseMenu.tsx` — uiMode==='paused': Resume, Settings, How to Play, Quit to Menu (uiActions().leaveMatch()).
- `src/components/game/EndScreen.tsx` — uiMode==='ended': match summary card from store.matchSummary: victory banner (green DEMOCRACY RESTORED! / red "The Committee Prevails"), funny title, stats grid (tokens, distance, checkpoints, rescues, revives, items, boss hits, detentions), XP earned + level bar, achievements unlocked, buttons: PLAY AGAIN (startSolo), MENU (leaveMatch→ actually just setUIMode('menu')). Countdown 10s auto to menu optional.
- `src/components/game/SettingsPanel.tsx` — shadcn Dialog with sliders: master/music/sfx volume, mouse sensitivity, invert Y, quality select (auto/low/medium/high), showFps toggle, reducedEffects toggle, keybind rebinding for core keys (click → press key). Persist to localStorage('votechor_settings') + store.setSettings.
- `src/components/game/HowToPlay.tsx` — controls table (WASD move, Mouse camera, Space jump, Shift sprint, C slide, E interact, Q throw, G emotes, M map, Tab squad, 1-8 items, Esc pause) + mission briefing with humor + boss phases explanation.
- `src/components/game/LeaderboardPanel.tsx` — fetch /api/leaderboard → tabs: XP / Distance / Wins. Rows with rank medal, name, level, value. Refresh button.
- `src/components/game/AchievementsPanel.tsx` — fetch /api/achievements with x-vc-token header → grid of ACHIEVEMENTS with unlocked state, locked = grayscale + lock icon.
- `src/components/game/StatsPanel.tsx` — fetch /api/stats with token → totals cards.
- `src/components/game/BigMap.tsx` — when mapOpen: large centered map canvas (draw same minimap logic scaled 2.5x with zone labels + landmark names from a copy of the drawing code — simplest: drawImage(buffer) scaled + overlay labels absolutely positioned).
- `src/components/game/TouchControls.tsx` — if touch device ('ontouchstart' in window): left virtual joystick (writes game input via exported bridge), right buttons: Jump, Sprint, Slide, Interact(E), Throw(Q). Implement joystick with pointer events writing to a global exported from GameRoot: `window.__vc_touch = { move:{x,y}, sprint, jump, slide, interact, throw }` and ALSO call getGame().setTouchState(...) — simplest: export a setter from game.ts `export function setTouchMove(x,y)` etc. — ADD to game.ts:
  ```ts
  export function touchBridge() { const g = getGame(); return {
    move: (x:number,y:number)=>{ g['input'].touchMove={x,y}; g['input'].touchActive=true },
    end: ()=>{ g['input'].touchActive=false; g['input'].touchMove={x:0,y:0} },
    btn: (name:'sprint'|'jump'|'slide'|'interact'|'throw', down:boolean)=>{ g['input'].touchButtons[name]=down; if(name==='jump'&&down) g['input'].onOneShot?.('jump'); if(name==='throw'&&down) g['input'].onOneShot?.('throw'); if(name==='slide'&&down) g['input'].onOneShot?.('slide') },
  } }
  ```
  (Subagent may add this tiny bridge function at the end of src/game/game.ts if missing.)
- `src/components/game/SquadPanel.tsx` — Tab overlay listing squad + tips.

## Store field reference (src/lib/game-store.ts — READ IT)
uiMode: 'boot'|'menu'|'loading'|'playing'|'paused'|'ended'; menuScreen; profile; hud; boss; notifications; settings; matchSummary; fps; emoteWheelOpen; mapOpen; squadOpen; joining; joinError; roomCode.
Actions: setUIMode, setMenuScreen, patchHud, patchBoss, notify, dismissNotification, setSettings, setMatchSummary, toggleEmoteWheel, toggleMap, toggleSquad, setJoining...

## API endpoints (Task 10-c builds these — assume they exist)
- POST /api/profile {name?, archetype?, cosmetics?} header x-vc-token? → {profile:{id,name,archetype,xp,level,cosmetics}, token} (creates or updates by token)
- GET /api/leaderboard?sort=xp|distance|wins → {entries:[{name,level,xp,value}]}
- GET /api/achievements (x-vc-token) → {all:[...], unlocked:[codes]}
- GET /api/stats (x-vc-token) → {stats}
- POST /api/matches (x-vc-token) → {xpEarned, level, leveledUp, newAchievements, profile}

## Rules
- No SSR for canvas logic: GameRoot uses dynamic import via `const Game = ...` pattern in page.tsx (already handled — page imports GameRoot with next/dynamic ssr:false).
- ALL buttons must do something real. No lorem ipsum. Use humor strings from shared/constants (CAPTURE_MESSAGES, RANDOM_NOTIFICATIONS...).
- Loading screen: animated "Democracy is loading…" + progress tips, min 600ms.
- Must be responsive: HUD scales down on mobile (text-xs), menus scrollable.
- Footer note in main menu: "VoteChor is a work of satire. All politicians, committees and samosas are fictional." Must stick to bottom on short viewports (min-h-screen flex flex-col, footer mt-auto).
