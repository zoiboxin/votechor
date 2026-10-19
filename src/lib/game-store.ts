// VoteChor game state store — the contract between the 3D engine and React UI.
'use client'
import { create } from 'zustand'
import type { AnimName, MatchEndPayload } from '@/game/shared/types'

export type UIMode = 'boot' | 'menu' | 'loading' | 'playing' | 'paused' | 'ended'
export type MenuScreen = 'main' | 'customize' | 'play' | 'leaderboard' | 'achievements' | 'settings' | 'howto' | 'stats'

export interface Notification { id: number; text: string; kind: 'info' | 'capture' | 'achievement' | 'squad' | 'boss' | 'warning' }

export interface SquadMember { id: string; name: string; health: number; detained: boolean; dazed: boolean; archetype: string; distance: number; bot?: boolean }

export interface CompassMarker { kind: 'token' | 'checkpoint' | 'boss' | 'chai' | 'firstaid' | 'squad'; deg: number; dist: number }

/** v44 — one relayed chat line (T comms panel). Coordinates are parsed by the HUD. */
export interface ChatEntry {
  id: number
  name: string
  text: string
  at: number
  mine: boolean
  bot: boolean
}

/** Parse "X 12.5 · Z -80" / "x-3, z 210" style coordinates out of a chat line. */
export function parseCoords(text: string): { x: number; z: number } | null {
  const m = /X\s*(-?\d{1,4}(?:\.\d)?)\s*[,·\s]+\s*Z\s*(-?\d{1,4}(?:\.\d)?)/i.exec(text)
  if (!m) return null
  const x = Number(m[1])
  const z = Number(m[2])
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  return { x, z }
}

/** Zone accent colors — used by the HUD banner and the zone-entry vignette tint. */
export const ZONE_ACCENTS: Record<string, string> = {
  'Protest Plaza': '#c96f4a',
  'Chowk Market': '#b85c3e',
  'Security Checkpoint': '#7f9a8c',
  'Grand Avenue': '#c9a86a',
  'Government District': '#8c1f28',
}

export interface HudState {
  health: number
  maxHealth: number
  stamina: number
  zoneName: string
  zoneHint: string
  objective: string
  checkpoint: number
  totalCheckpoints: number
  tokens: number
  tokensNeeded: number
  inventory: { uid: string; type: string }[]
  inventoryMax: number
  detained: boolean
  detainRemain: number
  dazed: boolean
  squad: SquadMember[]
  playersOnline: number
  ping: number
  connection: 'connected' | 'connecting' | 'offline'
  speedBoostUntil: number
  rallyReadyAt: number
  interactPrompt: string | null
  matchTime: number
  distance: number
  revivedProgress: number | null // 0..1 while reviving
  carryingBallot: boolean
  score: number
  /** local player's chosen side — HUD shows the officer badge + arrest objective when 'police' */
  role: 'protector' | 'police'
  /** suspects arrested this match (police role) */
  arrests: number
  compass: { yawDeg: number; markers: CompassMarker[] }
  cinematic: boolean
  spectating: string | null // teammate name when camera follows them while detained
  hunted: boolean // police/security actively chasing the local player
  /** v51 — soft escape: the badge lingers (dimmed, "losing them…") for a few
   *  seconds after the last chaser drops off, then clears itself. */
  wantedFading: boolean
  mapX: number // player world x (0.5m grid) — used by the big-map minimap-window overlay
  mapZ: number // player world z
  /** live day/night + weather readout for the HUD environment chip */
  env: EnvHud
  /** v43 — the district (level map) this match plays, for the HUD district chip */
  mapName: string
  /** 1..5 difficulty pips of the current district */
  mapDifficulty: number
  /** district XP multiplier (stakes) shown in the HUD chip tooltip */
  mapXpMul: number
  /** live performance readout for the optional HUD chip (patched at 1Hz, only on change) */
  perf: PerfHud
  /** user-set map marker — circular minimap draws it + route; null clears */
  waypoint: Waypoint | null
}

/** v44 — recent T-chat lines (newest last; the HUD feed shows the freshest few). */
export interface ChatState {
  log: ChatEntry[]
}

export interface Waypoint {
  x: number
  z: number
  label: string
}

export interface EnvHud {
  time: string // "14:30" in-game clock
  phase: string // Morning / Golden Hour / Dusk / Night…
  weather: string // Clear Skies / Monsoon Rain / Thunderstorm…
  icon: 'sun' | 'sunrise' | 'sunset' | 'moon'
  wIcon: 'clear' | 'cloudy' | 'overcast' | 'rain' | 'storm' | 'fog'
  /** Date.now() of the last lightning flash — HUD shows a white flash overlay */
  flashAt: number
}

/** 1Hz perf readout for the optional HUD chip. */
export interface PerfHud {
  fps: number
  frameMs: number // observed frame time (rAF delta, ms)
  drawCalls: number // GL draw calls per frame (main + shadow pass)
  trisK: number // triangles per frame, thousands
  kbps: number // estimated player-state download (KiB/s)
  crowd: number // impostor-crowd silhouettes currently rendered
  rigs: number // full character rigs active
  res: number // effective render resolution scale (auto-quality ladder)
  gl: 'ok' | 'lost' | 'error' // GPU context / frame-phase health (set by the engine hooks)
  glMsg: string // short fault text for the chip tooltip (empty when ok)
}

export interface BossHud {
  active: boolean
  phase: number
  phaseName: string
  health: number
  maxHealth: number
  objectiveText: string
  progress: number // 0..1 phase objective progress
  documents?: number
  votes?: number
  votesNeeded?: number
  dizzy: boolean
}

export interface Settings {
  masterVolume: number
  musicVolume: number
  sfxVolume: number
  mouseSensitivity: number
  invertY: boolean
  quality: 'low' | 'medium' | 'high' | 'auto'
  showFps: boolean
  reducedEffects: boolean
  keybinds: Record<string, string>
  /** How many world-meters the corner minimap shows vertically (80 = close-up, 582 = full city). */
  minimapZoom: number
  /** day/night selector — 'cycle' runs a real-time clock, others pin the sky */
  timeMode: 'cycle' | 'dawn' | 'noon' | 'dusk' | 'night'
  /** weather selector — 'auto' runs the living weather state machine */
  weatherMode: 'auto' | 'clear' | 'cloudy' | 'overcast' | 'rain' | 'storm' | 'fog'
  /** live perf chip (FPS · net · crowd · rigs · render res) on the HUD */
  perfHud: boolean
  /** GTA-style circular minimap rotates with player heading (false = north-up) */
  minimapRotate: boolean
  /** accessibility — dampens camera shake on hits/explosions */
  reducedShake: boolean
  /** High-Fi GLB player model (keyframed animation clips) — auto-falls back to the procedural rig when unavailable */
  hiFiModel: boolean
  /** Distance culling for static world geometry (big draw-call win). Off = the
   *  pre-optimization rendering path (everything always drawn). The culler also
   *  self-disables permanently if it ever mass-hides on this device. */
  distanceCulling: boolean
  /** Persistent squad pane docked on the right edge of the HUD (v42) — also gates
   *  the Tab squad manager. Off = a cleaner HUD for players who never use squads. */
  squadPanel: boolean
}

// ---- minimap zoom window helpers (shared by the engine renderer + BigMap settings UI) ----
export const MINIMAP_ASPECT = 140 / 420 // HUD strip aspect (w/h)
export const MINIMAP_MIN_ZOOM = 80
export const MINIMAP_MAX_ZOOM = 582 // full world z-span
const WORLD_MIN_X = -120
const WORLD_MAX_X = 120
const WORLD_MIN_Z = -572
const WORLD_MAX_Z = 10

/**
 * The world-rectangle the corner minimap currently shows: a window of `zoom` meters
 * (vertically) centered on the player, clamped so it never sticks out past the city bounds.
 */
export function minimapWindow(x: number, z: number, zoom: number) {
  const spanZ = Math.max(MINIMAP_MIN_ZOOM, Math.min(MINIMAP_MAX_ZOOM, zoom || MINIMAP_MAX_ZOOM))
  const spanX = spanZ * MINIMAP_ASPECT
  const fullW = WORLD_MAX_X - WORLD_MIN_X
  const fullH = WORLD_MAX_Z - WORLD_MIN_Z
  const cx = spanX >= fullW
    ? (WORLD_MIN_X + WORLD_MAX_X) / 2
    : Math.max(WORLD_MIN_X + spanX / 2, Math.min(WORLD_MAX_X - spanX / 2, x))
  const cz = spanZ >= fullH
    ? (WORLD_MIN_Z + WORLD_MAX_Z) / 2
    : Math.max(WORLD_MIN_Z + spanZ / 2, Math.min(WORLD_MAX_Z - spanZ / 2, z))
  return { cx, cz, spanX, spanZ }
}

export interface MatchSummary extends MatchEndPayload {
  xpEarned: number
  funnyTitle: string
  newAchievements: { id: string; name: string }[]
  leveledUp: boolean
  newLevel: number
  dailyBonus?: number
  dailyDesc?: string
  dailyJustCompleted?: boolean
  weeklyBonus?: number
  weeklyJustCompleted?: boolean
  streak?: number
  streakUp?: boolean
  solidarityBonus?: number
  squadSize?: number
  gifts?: number
  /** v43 — district XP multiplier applied to this match (solo only) */
  xpMul?: number
  /** v43 — the new district unlocked by this match's level-up (solo only) */
  unlockedMap?: { name: string; tagline: string; minLevel: number }
}

export interface Profile {
  id: string
  name: string
  archetype: string
  xp: number
  level: number
  dailyStreak?: number
  /** chosen side — 'police' spawns an officer instead of a protester */
  role?: 'protector' | 'police'
  /** account creation date (ISO) — shown on the stats ID card */
  createdAt?: string
  cosmetics: { hat?: string; glasses?: boolean; signText?: string; skinTone?: string; face?: string; build?: string; outfit?: string; footwear?: string; gear?: string; held?: string; gender?: 'male' | 'female'; hair?: string; policeOutfit?: string; policeHat?: string }
}

export interface DailyState {
  kind: string
  desc: string
  target: number
  reward: number
  progress: number
  claimed: boolean
}

export interface WeeklyState extends DailyState {
  week?: string
}

export interface CellMember {
  id: string
  name: string
}

export interface SquadState {
  code: string
  members: CellMember[]
}

/** A live squad invite addressed to the local player (auto-expires client + server side). */
export interface PendingInvite {
  fromId: string
  fromName: string
  code: string
  at: number
}

export interface RoomRosterEntry { id: string; name: string; archetype: string; bot?: boolean }

/** Persistent season state (solo queue) — mirrored from the server's game:season event. */
export interface SeasonState {
  id: string
  name: string
  humans: number
  bots: number
  cap: number
  humansMax: number
  lastEvent: string | null
  lastEventAt: number
}

export interface MvpTallyRow { id: string; name: string; votes: number }

/** Live post-match honors state — kudos counters + MVP vote tally (multiplayer). */
export interface PostMatchState {
  kudosReceived: number
  tally: MvpTallyRow[] | null
  voters: number
  roomPlayers: number
  mvp: { winnerId: string; winnerName: string } | null
}

const defaultPostMatch: PostMatchState = {
  kudosReceived: 0,
  tally: null,
  voters: 0,
  roomPlayers: 0,
  mvp: null,
}

export interface GameState {
  uiMode: UIMode
  menuScreen: MenuScreen
  profile: Profile | null
  profileLoading: boolean
  daily: DailyState | null
  weekly: WeeklyState | null
  hud: HudState
  boss: BossHud
  notifications: Notification[]
  settings: Settings
  matchSummary: MatchSummary | null
  fps: number
  emoteWheelOpen: boolean
  mapOpen: boolean
  /** v44 — T comms panel open: engine releases pointer lock + suppresses movement while up */
  chatOpen: boolean
  squadOpen: boolean
  joining: boolean
  joinError: string | null
  roomCode: string | null
  matchMode: 'solo' | 'multiplayer' | null
  photoMode: boolean
  photoFilter: number // 0 = off, 1 = poster, 2 = vintage, 3 = noir
  squad: SquadState | null
  pendingInvite: PendingInvite | null
  postMatch: PostMatchState
  roomRoster: RoomRosterEntry[]
  season: SeasonState | null
  /** v44 — recent T-chat lines (fed by local sends + remote relays) */
  chat: ChatState
  /** v44 — solo district choice; null = AUTO (highest district the level earns) */
  selectedMapId: string | null
  /** Non-null when the 3D engine failed to boot on this device — GameRoot swaps the
   *  whole UI for a visible fatal-error card (never a silent dead canvas). */
  fatalError: string | null

  setUIMode: (m: UIMode) => void
  setFatalError: (msg: string | null) => void
  setMenuScreen: (s: MenuScreen) => void
  setProfile: (p: Profile | null) => void
  setProfileLoading: (v: boolean) => void
  setDaily: (d: DailyState | null) => void
  setWeekly: (w: WeeklyState | null) => void
  patchHud: (h: Partial<HudState>) => void
  patchBoss: (b: Partial<BossHud>) => void
  notify: (text: string, kind?: Notification['kind']) => void
  dismissNotification: (id: number) => void
  setSettings: (s: Partial<Settings>) => void
  setMatchSummary: (s: MatchSummary | null) => void
  setSelectedMapId: (id: string | null) => void
  pushChat: (e: ChatEntry) => void
  clearChat: () => void
  setFps: (f: number) => void
  toggleEmoteWheel: (v?: boolean) => void
  toggleMap: (v?: boolean) => void
  toggleChat: (v?: boolean) => void
  toggleSquad: (v?: boolean) => void
  setJoining: (v: boolean, err?: string | null) => void
  setRoomCode: (c: string | null) => void
  setMatchMode: (m: 'solo' | 'multiplayer' | null) => void
  setSquad: (s: SquadState | null) => void
  setPendingInvite: (inv: PendingInvite | null) => void
  setPhotoMode: (v: boolean) => void
  setPhotoFilter: (i: number) => void
  resetPostMatch: () => void
  bumpKudosReceived: () => void
  setMvpTally: (t: { tally: MvpTallyRow[]; voters: number; roomPlayers: number } | null) => void
  setMvpWinner: (m: { winnerId: string; winnerName: string } | null) => void
  setRoomRoster: (r: RoomRosterEntry[]) => void
  setSeason: (s: { id: string; name: string; humans: number; bots: number; cap: number; humansMax: number } | null) => void
  patchSeason: (p: Partial<SeasonState>) => void
}

const defaultHud: HudState = {
  health: 100, maxHealth: 100, stamina: 100,
  zoneName: 'Protest Plaza', zoneHint: '', objective: 'Reach the market',
  checkpoint: 0, totalCheckpoints: 4, tokens: 0, tokensNeeded: 12,
  inventory: [], inventoryMax: 8,
  detained: false, detainRemain: 0, dazed: false,
  squad: [], playersOnline: 1, ping: 0, connection: 'connecting',
  speedBoostUntil: 0, rallyReadyAt: 0, interactPrompt: null, matchTime: 0, distance: 0,
  revivedProgress: null, carryingBallot: false, score: 0,
  role: 'protector', arrests: 0,
  compass: { yawDeg: 0, markers: [] },
  cinematic: false,
  spectating: null,
  hunted: false,
  wantedFading: false,
  mapX: 0, mapZ: 0,
  env: { time: '10:30', phase: 'Morning', weather: 'Clear Skies', icon: 'sun', wIcon: 'clear', flashAt: 0 },
  mapName: '', mapDifficulty: 1, mapXpMul: 1,
  perf: { fps: 60, frameMs: 16.7, drawCalls: 0, trisK: 0, kbps: 0, crowd: 0, rigs: 0, res: 1, gl: 'ok' as const, glMsg: '' },
  waypoint: null,
}

const defaultChat: ChatState = { log: [] }

const defaultBoss: BossHud = {
  active: false, phase: 0, phaseName: '', health: 100, maxHealth: 100,
  objectiveText: '', progress: 0, dizzy: false,
}

/** CANONICAL default keybinds — single source of truth shared by the store default,
 *  the input system fallback and the settings panel. HISTORY (v34): the settings
 *  panel shipped its own stale copy WITHOUT the heal/shout actions, and setSettings
 *  merged shallowly — so any persisted settings object from an older build replaced
 *  the default keybinds wholesale, leaving keybinds.heal/shout undefined → pressing
 *  ESC crashed the pause menu (prettyKey on undefined) AND silently killed the V/H
 *  hotkeys in-game. New actions MUST be added here (and to KEYBIND_LABELS). */
export const DEFAULT_KEYBINDS: Record<string, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', sprint: 'ShiftLeft', slide: 'KeyC', interact: 'KeyE',
  throw: 'KeyQ', emote: 'KeyG', map: 'KeyM', squad: 'Tab', pause: 'Escape',
  gift: 'KeyF', heal: 'KeyH', shout: 'KeyV',
}

const defaultSettings: Settings = {
  masterVolume: 0.8, musicVolume: 0.5, sfxVolume: 0.9,
  mouseSensitivity: 1, invertY: false, quality: 'auto',
  showFps: false, reducedEffects: false,
  minimapZoom: 150,
  timeMode: 'cycle',
  weatherMode: 'auto',
  perfHud: true,
  minimapRotate: true,
  reducedShake: false,
  /** DEFAULT ON (v83) — v33 shipped it OFF because the High-Fi GLB dropped every
   *  wardrobe slot (fixed generic mesh, palette tint only). That cause is GONE:
   *  the male path now loads the textured skinned hero asset and styling runs
   *  through resolveAvatarLook → applyAvatarLook (normalized tint + hair / hat /
   *  face / glasses / footwear / back gear / held items parented to the actual
   *  BONES, both for the local player and remotes). What you style in the
   *  wardrobe is what the High-Fi body wears. Opt-out stays in Options →
   *  Character Model for weak devices (procedural rig unchanged). */
  hiFiModel: true,
  /** v50 DEFAULT ON — the measured cost of leaving it OFF is ~4,100 draw calls /
   *  ~260k triangles every frame (2,975 static meshes, 61% of them beyond the fog
   *  wall where they are invisible anyway). That is the "game feels heavy" report.
   *  History: builds ≤ v30 defaulted it ON and ONE device rendered a blue world,
   *  so it went opt-in — but that culler predates its fail-safe. Today the sweep
   *  self-disables when a healthy near-field count is missing (WorldDistanceCuller
   *  anomaly fail-safe), the draw-call collapse + empty-world watchdogs auto-reload,
   *  and an explicit OFF choice from Options is still respected forever. */
  distanceCulling: true,
  /** v42 — the right-edge squad pane is ON by default (it was effectively always
   *  there); disabling it hides the HUD pane AND makes Tab a no-op so players who
   *  want a pure view lose nothing. Persisted settings from older builds lack this
   *  key — setSettings' shallow merge keeps the default, no migration needed. */
  squadPanel: true,
  keybinds: { ...DEFAULT_KEYBINDS },
}

let notifId = 1

export const useGameStore = create<GameState>((set) => ({
  uiMode: 'boot',
  menuScreen: 'main',
  profile: null,
  profileLoading: true,
  daily: null,
  weekly: null,
  hud: defaultHud,
  boss: defaultBoss,
  notifications: [],
  settings: defaultSettings,
  matchSummary: null,
  chat: defaultChat,
  /** v44 — solo district choice: null = AUTO (the player's level earns the map);
   *  a set id replays that district IF its minLevel ≤ profile level (validated at
   *  match boot AND server-side at result time — a stale id silently falls back). */
  selectedMapId: (typeof window !== 'undefined'
    ? (localStorage.getItem('votechor_map') || null)
    : null) as string | null,
  fps: 60,
  emoteWheelOpen: false,
  mapOpen: false,
  chatOpen: false,
  squadOpen: false,
  joining: false,
  joinError: null,
  roomCode: null,
  matchMode: null,
  photoMode: false,
  photoFilter: 0,
  squad: null,
  pendingInvite: null,
  postMatch: defaultPostMatch,
  roomRoster: [],
  season: null,
  fatalError: null,

  setUIMode: (m) => set({ uiMode: m }),
  setFatalError: (msg) => set({ fatalError: msg }),
  setMenuScreen: (s) => set({ menuScreen: s }),
  setProfile: (p) => set({ profile: p }),
  setProfileLoading: (v) => set({ profileLoading: v }),
  setDaily: (d) => set({ daily: d }),
  setWeekly: (w) => set({ weekly: w }),
  patchHud: (h) => set((st) => ({ hud: { ...st.hud, ...h } })),
  patchBoss: (b) => set((st) => ({ boss: { ...st.boss, ...b } })),
  notify: (text, kind = 'info') => set((st) => ({
    notifications: [...st.notifications.slice(-5), { id: notifId++, text, kind }],
  })),
  dismissNotification: (id) => set((st) => ({ notifications: st.notifications.filter((n) => n.id !== id) })),
  // DEEP keybinds merge (v34): persisted settings saved by older builds lack newer
  // actions (heal/shout) — a shallow spread let their stale keybinds object REPLACE
  // the defaults, producing undefined entries that crashed the settings panel and
  // silently disabled those hotkeys. Merging per-key keeps every new action
  // available with its default while preserving the user's rebinds.
  setSettings: (s) => set((st) => ({
    settings: { ...st.settings, ...s, keybinds: { ...st.settings.keybinds, ...(s.keybinds ?? {}) } },
  })),
  setMatchSummary: (s) => set({ matchSummary: s }),
  setSelectedMapId: (id) => {
    set({ selectedMapId: id })
    try {
      if (id) localStorage.setItem('votechor_map', id)
      else localStorage.removeItem('votechor_map')
    } catch { /* private mode */ }
  },
  pushChat: (e) => set((st) => ({ chat: { log: [...st.chat.log.slice(-29), e] } })),
  clearChat: () => set({ chat: defaultChat }),
  setFps: (f) => set({ fps: Math.round(f) }),
  toggleEmoteWheel: (v) => set((st) => ({ emoteWheelOpen: v ?? !st.emoteWheelOpen })),
  toggleMap: (v) => set((st) => ({ mapOpen: v ?? !st.mapOpen })),
  toggleChat: (v) => set((st) => ({ chatOpen: v ?? !st.chatOpen })),
  toggleSquad: (v) => set((st) => ({ squadOpen: v ?? !st.squadOpen })),
  setJoining: (v, err = null) => set({ joining: v, joinError: err }),
  setRoomCode: (c) => set({ roomCode: c }),
  setMatchMode: (m) => set({ matchMode: m }),
  setSquad: (s) => set({ squad: s }),
  setPendingInvite: (inv) => set({ pendingInvite: inv }),
  setPhotoMode: (v) => set({ photoMode: v }),
  setPhotoFilter: (i) => set({ photoFilter: ((i % 4) + 4) % 4 }),
  resetPostMatch: () => set({ postMatch: { ...defaultPostMatch } }),
  bumpKudosReceived: () => set((st) => ({ postMatch: { ...st.postMatch, kudosReceived: st.postMatch.kudosReceived + 1 } })),
  setMvpTally: (t) => set((st) => ({ postMatch: { ...st.postMatch, tally: t?.tally ?? null, voters: t?.voters ?? 0, roomPlayers: t?.roomPlayers ?? 0 } })),
  setMvpWinner: (m) => set((st) => ({ postMatch: { ...st.postMatch, mvp: m } })),
  setRoomRoster: (r) => set({ roomRoster: r }),
  setSeason: (s) => set({ season: s ? { ...s, lastEvent: null, lastEventAt: 0 } : null }),
  patchSeason: (p) => set((st) => ({ season: st.season ? { ...st.season, ...p } : null })),
}))

// ---- controller bridge: UI calls these, engine registers handlers ----
export interface UIActions {
  startSolo: () => void
  joinMultiplayer: (roomCode: string | null, roomName?: string) => void
  leaveMatch: (force?: boolean) => void
  selectArchetype: (id: string) => void
  updateCosmetics: (c: Partial<Profile['cosmetics']>) => void
  useItem: (uid: string) => void
  dropItem: (uid: string) => void
  sendEmote: (emote: string) => void
  sendQuickMessage: (id: number) => void
  /** v44 — free-text chat from the T comms panel (sanitized engine-side). */
  sendChatMessage: (text: string) => void
  respawnRequest: () => void
  photoToggle: () => void
  photoFilter: () => void
  photoSnapshot: () => void
  photoZoom: (dir: number) => void // -1 zoom out, +1 zoom in
  squadCreate: () => void
  squadJoin: (code: string) => void
  squadLeave: () => void
  squadInvite: (targetId: string) => void
  squadInviteAccept: (fromId: string) => void
  squadInviteDecline: (fromId: string) => void
  rallyToCell: () => void
  giftNearest: () => void
  giftTo: (targetId: string) => void
  kudosTo: (targetId: string) => void
  mvpVote: (targetId: string) => void
  /** Hand the visible HUD minimap canvas to the engine (it draws the zoomed window directly). */
  setHudMinimap: (c: HTMLCanvasElement | null) => void
}
const actionImpl: Partial<UIActions> = {}
export function registerUIActions(impl: UIActions) { Object.assign(actionImpl, impl) }
export function uiActions(): UIActions { return actionImpl as UIActions }
