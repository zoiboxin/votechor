// VoteChor game state store — the contract between the 3D engine and React UI.
'use client'
import { create } from 'zustand'
import type { AnimName, MatchEndPayload } from '@/game/shared/types'

export type UIMode = 'boot' | 'menu' | 'loading' | 'playing' | 'paused' | 'ended'
export type MenuScreen = 'main' | 'customize' | 'play' | 'leaderboard' | 'achievements' | 'settings' | 'howto' | 'stats'

export interface Notification { id: number; text: string; kind: 'info' | 'capture' | 'achievement' | 'squad' | 'boss' | 'warning' }

export interface SquadMember { id: string; name: string; health: number; detained: boolean; dazed: boolean; archetype: string; distance: number; bot?: boolean }

export interface CompassMarker { kind: 'token' | 'checkpoint' | 'boss' | 'chai' | 'firstaid' | 'squad'; deg: number; dist: number }

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
  compass: { yawDeg: number; markers: CompassMarker[] }
  cinematic: boolean
  spectating: string | null // teammate name when camera follows them while detained
  hunted: boolean // police/security actively chasing the local player
  mapX: number // player world x (0.5m grid) — used by the big-map minimap-window overlay
  mapZ: number // player world z
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
}

// ---- minimap zoom window helpers (shared by the engine renderer + BigMap settings UI) ----
export const MINIMAP_ASPECT = 140 / 420 // HUD strip aspect (w/h)
export const MINIMAP_MIN_ZOOM = 80
export const MINIMAP_MAX_ZOOM = 582 // full world z-span
const WORLD_MIN_X = -48
const WORLD_MAX_X = 48
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
}

export interface Profile {
  id: string
  name: string
  archetype: string
  xp: number
  level: number
  dailyStreak?: number
  cosmetics: { hat?: string; glasses?: boolean; signText?: string; skinTone?: string }
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

  setUIMode: (m: UIMode) => void
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
  setFps: (f: number) => void
  toggleEmoteWheel: (v?: boolean) => void
  toggleMap: (v?: boolean) => void
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
  compass: { yawDeg: 0, markers: [] },
  cinematic: false,
  spectating: null,
  hunted: false,
  mapX: 0, mapZ: 0,
}

const defaultBoss: BossHud = {
  active: false, phase: 0, phaseName: '', health: 100, maxHealth: 100,
  objectiveText: '', progress: 0, dizzy: false,
}

const defaultSettings: Settings = {
  masterVolume: 0.8, musicVolume: 0.5, sfxVolume: 0.9,
  mouseSensitivity: 1, invertY: false, quality: 'auto',
  showFps: false, reducedEffects: false,
  minimapZoom: 150,
  keybinds: { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft', slide: 'KeyC', interact: 'KeyE', throw: 'KeyQ', emote: 'KeyG', map: 'KeyM', squad: 'Tab', pause: 'Escape', gift: 'KeyF' },
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
  fps: 60,
  emoteWheelOpen: false,
  mapOpen: false,
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

  setUIMode: (m) => set({ uiMode: m }),
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
  setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
  setMatchSummary: (s) => set({ matchSummary: s }),
  setFps: (f) => set({ fps: Math.round(f) }),
  toggleEmoteWheel: (v) => set((st) => ({ emoteWheelOpen: v ?? !st.emoteWheelOpen })),
  toggleMap: (v) => set((st) => ({ mapOpen: v ?? !st.mapOpen })),
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
