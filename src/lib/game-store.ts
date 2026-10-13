// VoteChor game state store — the contract between the 3D engine and React UI.
'use client'
import { create } from 'zustand'
import type { AnimName, MatchEndPayload } from '@/game/shared/types'

export type UIMode = 'boot' | 'menu' | 'loading' | 'playing' | 'paused' | 'ended'
export type MenuScreen = 'main' | 'customize' | 'play' | 'leaderboard' | 'achievements' | 'settings' | 'howto' | 'stats'

export interface Notification { id: number; text: string; kind: 'info' | 'capture' | 'achievement' | 'squad' | 'boss' | 'warning' }

export interface SquadMember { id: string; name: string; health: number; detained: boolean; dazed: boolean; archetype: string; distance: number }

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
  interactPrompt: string | null
  matchTime: number
  distance: number
  revivedProgress: number | null // 0..1 while reviving
  carryingBallot: boolean
  score: number
  compass: { yawDeg: number; markers: CompassMarker[] }
  cinematic: boolean
  spectating: string | null // teammate name when camera follows them while detained
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
}

export interface Profile {
  id: string
  name: string
  archetype: string
  xp: number
  level: number
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

export interface GameState {
  uiMode: UIMode
  menuScreen: MenuScreen
  profile: Profile | null
  profileLoading: boolean
  daily: DailyState | null
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

  setUIMode: (m: UIMode) => void
  setMenuScreen: (s: MenuScreen) => void
  setProfile: (p: Profile | null) => void
  setProfileLoading: (v: boolean) => void
  setDaily: (d: DailyState | null) => void
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
  setPhotoMode: (v: boolean) => void
  setPhotoFilter: (i: number) => void
}

const defaultHud: HudState = {
  health: 100, maxHealth: 100, stamina: 100,
  zoneName: 'Protest Plaza', zoneHint: '', objective: 'Reach the market',
  checkpoint: 0, totalCheckpoints: 4, tokens: 0, tokensNeeded: 12,
  inventory: [], inventoryMax: 8,
  detained: false, detainRemain: 0, dazed: false,
  squad: [], playersOnline: 1, ping: 0, connection: 'connecting',
  speedBoostUntil: 0, interactPrompt: null, matchTime: 0, distance: 0,
  revivedProgress: null, carryingBallot: false, score: 0,
  compass: { yawDeg: 0, markers: [] },
  cinematic: false,
  spectating: null,
}

const defaultBoss: BossHud = {
  active: false, phase: 0, phaseName: '', health: 100, maxHealth: 100,
  objectiveText: '', progress: 0, dizzy: false,
}

const defaultSettings: Settings = {
  masterVolume: 0.8, musicVolume: 0.5, sfxVolume: 0.9,
  mouseSensitivity: 1, invertY: false, quality: 'auto',
  showFps: false, reducedEffects: false,
  keybinds: { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft', slide: 'KeyC', interact: 'KeyE', throw: 'KeyQ', emote: 'KeyG', map: 'KeyM', squad: 'Tab', pause: 'Escape' },
}

let notifId = 1

export const useGameStore = create<GameState>((set) => ({
  uiMode: 'boot',
  menuScreen: 'main',
  profile: null,
  profileLoading: true,
  daily: null,
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

  setUIMode: (m) => set({ uiMode: m }),
  setMenuScreen: (s) => set({ menuScreen: s }),
  setProfile: (p) => set({ profile: p }),
  setProfileLoading: (v) => set({ profileLoading: v }),
  setDaily: (d) => set({ daily: d }),
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
  setPhotoMode: (v) => set({ photoMode: v }),
  setPhotoFilter: (i) => set({ photoFilter: ((i % 4) + 4) % 4 }),
}))

// ---- controller bridge: UI calls these, engine registers handlers ----
export interface UIActions {
  startSolo: () => void
  joinMultiplayer: (roomCode: string | null, roomName?: string) => void
  leaveMatch: () => void
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
}
const actionImpl: Partial<UIActions> = {}
export function registerUIActions(impl: UIActions) { Object.assign(actionImpl, impl) }
export function uiActions(): UIActions { return actionImpl as UIActions }
