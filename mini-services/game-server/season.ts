// VoteChor Seasons — persistent 100-protester worlds for the solo queue.
//
// Design (user request):
//  • A solo player joins ONE season. Every season holds up to 100 occupants.
//  • Every free slot is filled by a server-simulated bot protester, so a fresh
//    season immediately feels like a living city (you + 99 bots).
//  • When a NEW human joins a season, one bot steps aside (removed + announced)
//    so the human takes its place — population stays at 100.
//  • When ANY occupant leaves, a fresh bot walks in from the plaza to backfill.
//  • When a season is "full" of humans (SEASON_MAX_HUMANS), matchmaking creates
//    the next season instead.
//  • Bots are realistic: they wander the streets on a nav graph, idle, chat
//    (quick messages), emote, socialize with each other AND with humans, flee
//    police, join protest marches to checkpoints, and pick up supplies.
//    Police will still chase them (they are real NPC targets), the boss ignores
//    them, and they get detained / released like everyone else.
//
// Network: bots are regular PlayerState entries inside the Room, so snapshots,
// NPC brains, vehicles, checkpoints, detention and the client renderer all work
// on them with zero special-casing. A per-recipient graded-AOI broadcaster keeps
// the 12 Hz player snapshot cheap: NEAR (≤150 m) every tick at full fidelity,
// MID (150–300 m) at 1/3 rate with 1-decimal payloads, FAR (>300 m) on the
// rotating far-window sweep. Bot wire payloads are cached once per tick.
import type { Server as SocketIOServer } from 'socket.io'
import { Room, WORLD, playerNet, type PlayerState } from './room'
import { ARCHETYPES } from '../../src/game/shared/constants'
import { randomFreeCosmetics } from '../../src/lib/cosmetics'
import type { AnimName, PlayerNetState } from '../../src/game/shared/types'

// ---------- tuning ----------
export const SEASON_CAP = 100 // total occupants (you + 99 others)
export const SEASON_MAX_HUMANS = 12 // season is "full" for matchmaking at this many real players
export const SEASON_RETIRE_MS = 90_000 // empty season lingers 90s for quick rejoins, then dissolves
const BOT_AOI = 150 // NEAR band radius: bots within this range stream every tick at full rate
const BOT_MID_AOI = 300 // MID band outer radius: 150–300 m streams at 1/3 rate (10 cm precision)
const BOT_FAR_WINDOW = 14 // far bots refreshed per broadcast tick (rotating sweep ≈ every 0.7s)
const TICK_MS = 100
const CHURN_MIN_MS = 16_000 // bot churn: one occupant leaves & is replaced
const CHURN_MAX_MS = 38_000
const MARCH_MIN_MS = 70_000 // occasional protest march to the next checkpoint
const MARCH_MAX_MS = 140_000

const BOT_EMOTES = ['wave', 'dance', 'chant', 'chai', 'flex', 'salute'] as const
const EMOTE_ANIM: Record<string, AnimName> = {
  wave: 'celebrate', dance: 'celebrate', chant: 'celebrate',
  chai: 'heal', flex: 'celebrate', salute: 'idle',
}

// Realistic protester names — mix of plain names and satirical handles.
const BOT_NAMES = [
  'Arjun', 'Meera', 'Rohan', 'Priya', 'Kabir', 'Aisha', 'Vikram', 'Sneha', 'Irfan', 'Rahul',
  'Ananya', 'Farhan', 'Divya', 'Aditya', 'Zoya', 'Karan', 'Neha', 'Sameer', 'Pooja', 'Arnav',
  'Tara', 'Nikhil', 'Ishita', 'Varun', 'Riya', 'Dhruv', 'Mira', 'Aman', 'Sana', 'Kunal',
  'Ritu', 'Omkar', 'Fatima', 'Gaurav', 'Lakshmi', 'Imran', 'Shalini', 'Yusuf', 'Kavya', 'Manav',
  'ChaiFirstVoteLater', 'UncleJiSpeaks', 'Form12BVictim', 'AntiCommittee', 'SamosaSocialist',
  'MeriChappalMeriMarzi', 'StreetwiseStrategist', 'DebateChamp89', 'CricketOverCommittee',
  'WiFiProtester', 'AuntyApproves', 'JaiHindJaiChai', 'PaperworkPhantom', 'TheQuietMarcher',
  'FlyoverPhilosopher', 'StampDodgePro', 'BarricadeBob', 'MegaphoneMike', 'PosterPaintPro',
  'ChowkChampion', 'MonsoonMarcher', 'AutoRickshawAce', 'SamosaSquadron', 'FilterKoffee',
  'ThelaKing', 'GullyGamer', 'NukkadNeta', 'SadakSideHero', 'ChappalChampion', 'JalebiJedi',
  'BandraBandit', 'DabbaDelivery', 'KurtaKicker', 'LassiLover', 'PakoraPilot', 'RickshawRaja',
]

// ---------- helpers ----------
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1))
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]
const chance = (p: number) => Math.random() < p
const dist2d = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz)

function angleLerp(from: number, to: number, t: number): number {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return from + d * Math.min(1, t)
}

// ---------- nav graph (built once from the shared deterministic world) ----------
interface NavNode { x: number; z: number; links: number[] }

const NAV_GRID = 10
const NAV_PAD = 1.7 // keep this far from building walls
const NAV_Z_MAX = -474 // bots never wander into the Government District / boss arena

function pointBlocked(x: number, z: number, pad: number): boolean {
  for (const c of WORLD.colliders) {
    if (c.walkable) continue // low walkable platforms (stage) are fine
    if (x >= c.minX - pad && x <= c.maxX + pad && z >= c.minZ - pad && z <= c.maxZ + pad) return true
  }
  return false
}

function clearPath(ax: number, az: number, bx: number, bz: number): boolean {
  const d = dist2d(ax, az, bx, bz)
  const steps = Math.max(1, Math.ceil(d / 2))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    if (pointBlocked(ax + (bx - ax) * t, az + (bz - az) * t, 0.8)) return false
  }
  return true
}

function buildNavGraph(): NavNode[] {
  const nodes: NavNode[] = []
  const index = new Map<string, number>()
  // round 19: the city widened to x ±120 — bots now roam the cross streets and
  // side mohalla blocks too (alley cells stay blocked; streets are all linked)
  for (let x = -115; x <= 115; x += NAV_GRID) {
    for (let z = NAV_Z_MAX; z <= 6; z += NAV_GRID) {
      if (pointBlocked(x, z, NAV_PAD)) continue
      index.set(`${x}|${z}`, nodes.length)
      nodes.push({ x, z, links: [] })
    }
  }
  // 8-neighborhood edges with line-of-sight (no cutting through buildings)
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    for (const [dx, dz] of [[NAV_GRID, 0], [0, NAV_GRID], [NAV_GRID, NAV_GRID], [NAV_GRID, -NAV_GRID]] as const) {
      const j = index.get(`${n.x + dx}|${n.z + dz}`)
      if (j === undefined) continue
      const m = nodes[j]
      if (clearPath(n.x, n.z, m.x, m.z)) { n.links.push(j); m.links.push(i) }
    }
  }
  return nodes
}

const NAV: NavNode[] = buildNavGraph()

function nearestNode(x: number, z: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < NAV.length; i++) {
    const d = (NAV[i].x - x) ** 2 + (NAV[i].z - z) ** 2
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

const MARCH_GOALS = [
  ...WORLD.checkpoints.map(c => ({ x: c.x, z: c.z })),
  { x: 0, z: -34 }, // fountain
  { x: -16, z: -18 }, // stage
  { x: 0, z: -140 }, // market heart
  { x: 0, z: -350 }, // grand avenue
  { x: 0, z: -468 }, // boss gate crowd
]

function randomGoal(): { x: number; z: number } {
  if (chance(0.2) || NAV.length === 0) return { x: rand(-40, 40), z: rand(-460, -4) }
  return pick(MARCH_GOALS)
}

// ---------- bot AI ----------
type BotStateName = 'arrive' | 'wander' | 'idle' | 'social' | 'flee' | 'march'

interface Bot {
  p: PlayerState
  node: number // current nearest nav node
  wp: { x: number; z: number } | null
  goal: { x: number; z: number } | null
  state: BotStateName
  stateUntil: number
  speed: number
  partner: string | null // social target (bot or human id)
  marchCp: number | null
  fleeFrom: { x: number; z: number } | null
  emoteUntil: number
  emoteAnim: AnimName
  nextEmoteAt: number
  nextQuipAt: number
  nextPickupAt: number
}

export interface SeasonInfo {
  id: string
  name: string
  humans: number
  bots: number
  cap: number
  humansMax: number
}

// ---------- graded AOI bands (pure helpers — unit-testable without sockets) ----------

/** NEAR band: dist² ≤ 150² → included EVERY tick with the round2 payload. */
export const AOI_NEAR_SQ = BOT_AOI * BOT_AOI
/** MID band: 150² < dist² ≤ 300² → included at 1/3 rate, 1-decimal payload. */
export const AOI_MID = BOT_MID_AOI
export const AOI_MID_SQ = BOT_MID_AOI * BOT_MID_AOI

/** 1-decimal quantization (10 cm) for MID/FAR payloads — plenty at that range. */
export function round1(v: number): number {
  return Math.round(v * 10) / 10
}

/** Minimal shape the AOI selection needs — plain literals work in unit tests. */
export interface AoiEntity { id: string; x: number; z: number }

/** Per-tick context for selectAoiPayload (payload caches are built once per tick). */
export interface AoiCtx {
  tick: number // broadcast tick counter — drives the 3-slot MID rotation
  farCursor: number // informational: far-window cursor (the window is already resolved)
  windowIds: ReadonlySet<string> // bot ids refreshed by the FAR sweep this tick
  near: readonly PlayerNetState[] // per-bot round2 payloads (index-aligned with `bots`)
  mid: readonly PlayerNetState[] // per-bot round1 payloads (index-aligned with `bots`)
  humans: readonly PlayerNetState[] // full-detail human entries, prepended to every payload
}

/**
 * Per-recipient AOI selection (pure):
 *  • NEAR (≤150 m): every tick, round2 payload.
 *  • MID (150–300 m): 1/3 rate via `botIndex % 3 === tick % 3`, round1 payload (~4 Hz each).
 *  • FAR (>300 m): ONLY via the rotating BOT_FAR_WINDOW sweep, round1 payload.
 *  • Humans: always full detail (and never duplicated).
 * Client prunes rigs unseen for 6 s — every band stays far inside that window.
 */
export function selectAoiPayload(bots: readonly AoiEntity[], human: AoiEntity, ctx: AoiCtx): PlayerNetState[] {
  const out: PlayerNetState[] = ctx.humans.slice()
  const midSlot = ctx.tick % 3
  for (let i = 0; i < bots.length; i++) {
    const b = bots[i]
    const dx = b.x - human.x
    const dz = b.z - human.z
    const d2 = dx * dx + dz * dz
    if (d2 <= AOI_NEAR_SQ) {
      out.push(ctx.near[i])
    } else if (d2 <= AOI_MID_SQ) {
      if (i % 3 === midSlot) out.push(ctx.mid[i])
    } else if (ctx.windowIds.has(b.id)) {
      out.push(ctx.mid[i])
    }
  }
  return out
}

/**
 * Rotating far-window sweep (semantics unchanged): the ids of the BOT_FAR_WINDOW
 * bots starting at `cursor`, plus the next cursor. Pure so tests can verify the
 * ≈ every (bots / BOT_FAR_WINDOW)-tick refresh cadence without sockets.
 */
export function computeFarWindow(bots: readonly AoiEntity[], cursor: number): { ids: Set<string>; nextCursor: number } {
  const ids = new Set<string>()
  const n = bots.length
  if (n === 0) return { ids, nextCursor: 0 }
  for (let i = 0; i < Math.min(BOT_FAR_WINDOW, n); i++) ids.add(bots[(cursor + i) % n].id)
  return { ids, nextCursor: (cursor + BOT_FAR_WINDOW) % n }
}

/** 1-decimal wire variant of playerNet for MID/FAR bots — identical fields, 10 cm precision. */
export function botNet1(p: PlayerState): PlayerNetState {
  return {
    id: p.id,
    name: p.name,
    archetype: p.archetype,
    x: round1(p.x),
    y: round1(p.y),
    z: round1(p.z),
    ry: round1(p.ry),
    anim: p.anim,
    health: p.health,
    detained: p.detained,
    dazed: p.dazed,
    tokens: p.tokens,
    carrying: p.carrying,
  } as PlayerNetState
}

// ---------- broadcast observability (module-level, folded across all seasons) ----------

const EST_BYTES_PER_ENTRY = 90 // rough wire estimate per player entry — an ESTIMATE, not measured bytes
export interface BroadcastStats {
  ticksPerSec: number // broadcast passes / sec across all seasons (1 s sampler)
  avgEntriesPerTick: number // EMA of payload entries summed over recipients
  avgTickMs: number // EMA of full broadcast duration
  estBytesPerSec: number // ESTIMATE: avgEntriesPerTick × ticksPerSec × 90
}
export const broadcastStats: BroadcastStats = {
  ticksPerSec: 0,
  avgEntriesPerTick: 0,
  avgTickMs: 0,
  estBytesPerSec: 0,
}
const tickWindow = { count: 0, at: Date.now() }

/** Fold one completed broadcast pass (one season, all recipients) into the stats. */
function recordBroadcastTick(entriesSent: number, durationMs: number): void {
  const k = 0.15
  broadcastStats.avgEntriesPerTick += (entriesSent - broadcastStats.avgEntriesPerTick) * k
  broadcastStats.avgTickMs += (durationMs - broadcastStats.avgTickMs) * k
  tickWindow.count++
}

// 1 Hz sampler: real ticks/sec + wire estimate (decays to 0 when idle). unref'd:
// never keeps the process (or a test run) alive on its own.
setInterval(() => {
  const now = Date.now()
  const dt = (now - tickWindow.at) / 1000
  if (dt <= 0) return
  broadcastStats.ticksPerSec = tickWindow.count / dt
  broadcastStats.estBytesPerSec = Math.round(broadcastStats.avgEntriesPerTick * broadcastStats.ticksPerSec * EST_BYTES_PER_ENTRY)
  tickWindow.count = 0
  tickWindow.at = now
}, 1000).unref?.()

export class Season {
  readonly room: Room
  readonly id: string
  readonly name: string
  readonly createdAt = Date.now()
  private io: SocketIOServer
  private bots = new Map<string, Bot>()
  private usedNames = new Set<string>()
  private farCursor = 0
  private tickCount = 0 // broadcast tick counter (drives the MID 3-slot rotation)
  private lastBroadcastAt = 0 // performance.now() of the previous broadcast pass
  private statRate = 0 // EMA: this season's broadcast ticks/sec
  private statEntries = 0 // EMA: payload entries summed over recipients per tick
  private statMs = 0 // EMA: full broadcast duration ms
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private churnAt = Date.now() + rand(18_000, 36_000)
  private marchAt = Date.now() + rand(MARCH_MIN_MS, MARCH_MAX_MS)
  private retireTimer: ReturnType<typeof setTimeout> | null = null
  private churnTimers: ReturnType<typeof setTimeout>[] = []
  private disposed = false
  private onEmpty: (id: string) => void

  constructor(io: SocketIOServer, id: string, name: string, onEmpty: (id: string) => void, decorateRoom?: (room: Room) => void) {
    this.io = io
    this.id = id
    this.name = name
    this.onEmpty = onEmpty
    this.room = new Room(io, id, '', true)
    this.room.playersBroadcaster = () => this.broadcastPlayers()
    decorateRoom?.(this.room) // injects the squadmate-position hook for Phase 6 release points
    this.tickTimer = setInterval(() => this.tick(), TICK_MS)
    this.tickTimer.unref?.()
    console.log(`[season] ${name} (${id}) created`)
  }

  info(): SeasonInfo {
    return {
      id: this.id,
      name: this.name,
      humans: this.room.humansCount(),
      bots: this.bots.size,
      cap: SEASON_CAP,
      humansMax: SEASON_MAX_HUMANS,
    }
  }

  /** Per-season broadcast EMAs (cheap observability; also folded into module broadcastStats). */
  broadcastEma(): { ticksPerSec: number; entriesPerTick: number; tickMs: number } {
    return { ticksPerSec: this.statRate, entriesPerTick: this.statEntries, tickMs: this.statMs }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.tickTimer) clearInterval(this.tickTimer)
    if (this.retireTimer) clearTimeout(this.retireTimer)
    for (const t of this.churnTimers) clearTimeout(t)
    this.room.dispose()
    console.log(`[season] ${this.name} (${this.id}) dissolved`)
  }

  // ---------- population ----------

  /** Called right after a human was added to the room: swap a bot out if needed, top up bots. */
  onHumanJoined() {
    if (this.retireTimer) { clearTimeout(this.retireTimer); this.retireTimer = null }
    // "if new user join the game remove bot and let player join" — one bot steps aside
    while (this.room.humansCount() + this.bots.size >= SEASON_CAP) {
      const victim = this.pickRemovableBot()
      if (!victim) break
      this.removeBot(victim, true)
    }
    // fill every remaining slot with a fresh bot
    let guard = 0
    while (this.room.humansCount() + this.bots.size < SEASON_CAP && guard++ < SEASON_CAP + 20) {
      this.createBot('seed', false)
    }
    this.emitSeason()
    console.log(`[season] ${this.name}: human joined → ${this.room.humansCount()} humans / ${this.bots.size} bots`)
  }

  /** Called after a human was removed from the room: backfill + retirement check. */
  onHumanLeft() {
    this.emitSeason()
    // "when any player left the game new user will join the same season" — backfill bot walks in
    const t = setTimeout(() => {
      if (this.disposed) return
      if (this.room.humansCount() + this.bots.size < SEASON_CAP) this.createBot('arrive', true)
      this.emitSeason()
    }, rand(2500, 7000))
    t.unref?.()
    this.churnTimers.push(t)
    this.checkRetire()
    console.log(`[season] ${this.name}: human left → ${this.room.humansCount()} humans / ${this.bots.size} bots`)
  }

  private checkRetire() {
    if (this.room.humansCount() > 0 || this.disposed) return
    if (this.retireTimer) return
    this.retireTimer = setTimeout(() => this.onEmpty(this.id), SEASON_RETIRE_MS)
    this.retireTimer.unref?.()
  }

  private emitSeason() {
    this.io.to(this.room.id).emit('game:season', this.info())
  }

  // ---------- bots ----------

  private takeName(): string {
    for (let i = 0; i < 40; i++) {
      const base = pick(BOT_NAMES)
      if (!this.usedNames.has(base)) { this.usedNames.add(base); return base }
    }
    let n = randInt(2, 99)
    const base = pick(BOT_NAMES)
    while (this.usedNames.has(`${base}${n}`)) n = randInt(2, 9999)
    const name = `${base}${n}`
    this.usedNames.add(name)
    return name
  }

  private spawnPoint(mode: 'seed' | 'arrive'): { x: number; z: number } {
    if (mode === 'arrive') return { x: rand(-7, 7), z: rand(-10, -4) } // walk in from the plaza gate
    // seed: distribute across the public zones (plaza heavy, gov-district gate light)
    const bands: [number, number, number][] = [
      [-78, -6, 30], [-198, -80, 25], [-278, -200, 15], [-418, -280, 20], [-472, -420, 10],
    ]
    const total = bands.reduce((s, b) => s + b[2], 0)
    let roll = Math.random() * total
    let band = bands[0]
    for (const b of bands) { roll -= b[2]; if (roll <= 0) { band = b; break } }
    for (let i = 0; i < 12; i++) {
      const n = NAV[randInt(0, NAV.length - 1)]
      if (n.z <= band[0] && n.z >= band[1]) return { x: n.x, z: n.z }
    }
    const n = NAV[randInt(0, NAV.length - 1)]
    return { x: n.x, z: n.z }
  }

  private createBot(mode: 'seed' | 'arrive', announce: boolean): Bot | null {
    if (this.disposed || NAV.length === 0) return null
    const id = `bot_${Math.random().toString(36).slice(2, 9)}`
    const name = this.takeName()
    const archetype = pick(ARCHETYPES).id
    const pos = this.spawnPoint(mode)
    const p = this.room.addPlayer(id, name, archetype, { bot: true, x: pos.x, z: pos.z, cosmetics: randomFreeCosmetics() })
    const bot: Bot = {
      p,
      node: nearestNode(pos.x, pos.z),
      wp: null,
      goal: mode === 'arrive' ? { x: rand(-30, 30), z: rand(-60, -10) } : randomGoal(),
      state: mode === 'arrive' ? 'arrive' : (chance(0.3) ? 'idle' : 'wander'),
      stateUntil: Date.now() + (mode === 'arrive' ? 0 : rand(1000, 5000)),
      speed: rand(2.3, 3.4),
      partner: null,
      marchCp: null,
      fleeFrom: null,
      emoteUntil: 0,
      emoteAnim: 'idle',
      nextEmoteAt: Date.now() + rand(8000, 50_000),
      nextQuipAt: Date.now() + rand(20_000, 120_000),
      nextPickupAt: Date.now() + rand(6000, 40_000),
    }
    this.bots.set(id, bot)
    if (announce) this.io.to(this.room.id).emit('game:playerjoined', id, name)
    return bot
  }

  /** Remove a bot (announced to the room so clients drop the rig + feed the event). */
  private removeBot(bot: Bot, announce: boolean) {
    this.bots.delete(bot.p.id)
    this.usedNames.delete(bot.p.name)
    this.room.removePlayer(bot.p.id)
    if (announce) this.io.to(this.room.id).emit('game:playerleft', bot.p.id, bot.p.name)
  }

  /** A bot to sacrifice for an incoming human — prefer one NOT standing next to a human. */
  private pickRemovableBot(): Bot | null {
    const all = [...this.bots.values()]
    if (all.length === 0) return null
    const humans = this.room.humans()
    const away = all.filter((b) => !humans.some((h) => dist2d(h.x, h.z, b.p.x, b.p.z) < 9))
    return pick(away.length > 0 ? away : all)
  }

  // ---------- simulation ----------

  private tick() {
    if (this.disposed) return
    const now = Date.now()
    const dt = TICK_MS / 1000

    for (const bot of this.bots.values()) this.stepBot(bot, dt, now)

    // churn — the world breathes: someone leaves, someone new arrives
    if (now >= this.churnAt && this.room.humansCount() > 0) {
      const victim = this.pickRemovableBot()
      if (victim) {
        this.removeBot(victim, true)
        const t = setTimeout(() => {
          if (this.disposed) return
          if (this.room.humansCount() + this.bots.size < SEASON_CAP) this.createBot('arrive', true)
          this.emitSeason()
        }, rand(2500, 7000))
        t.unref?.()
        this.churnTimers.push(t)
      }
      this.churnAt = now + rand(CHURN_MIN_MS, CHURN_MAX_MS)
    }

    // protest marches to the next checkpoint
    if (now >= this.marchAt && this.room.humansCount() > 0) {
      this.startMarch()
      this.marchAt = now + rand(MARCH_MIN_MS, MARCH_MAX_MS)
    }
  }

  private startMarch() {
    const inactive = WORLD.checkpoints.filter((c) => !this.room.checkpoints.has(c.id))
    if (inactive.length === 0) return
    const cp = pick(inactive)
    const crowd = [...this.bots.values()].filter((b) => b.state === 'wander' && !b.p.detained && !b.p.dazed)
    if (crowd.length < 3) return
    const n = Math.min(crowd.length, randInt(3, 8))
    for (let i = 0; i < n; i++) {
      const b = crowd.splice(randInt(0, crowd.length - 1), 1)[0]
      b.state = 'march'
      b.marchCp = cp.id
      b.goal = { x: cp.x + rand(-5, 5), z: cp.z + rand(-5, 5) }
      b.wp = null
      b.speed = rand(3.8, 4.4)
    }
    // a march leader shouts the plan
    const leader = this.bots.get(crowd[0]?.p.id ?? '')
    if (leader) this.io.to(this.room.id).emit('game:quickmsg', leader.p.id, randInt(5, 8)) // "To the flyover!" / "Form a squad!" / "The gate needs votes!"
  }

  private stepBot(bot: Bot, dt: number, now: number) {
    const p = bot.p
    if (p.detained || p.dazed) return // capture/daze systems own the bot

    // --- threat scan: police chasing me, or an officer breathing down my neck ---
    if (bot.state !== 'flee') {
      for (const n of this.room.npcs) {
        if (n.type === 'searchlight') continue
        const d = dist2d(n.x, n.z, p.x, p.z)
        if ((n.state === 'chase' && n.targetId === p.id && d < 20) || d < 5.5) {
          bot.state = 'flee'
          bot.fleeFrom = { x: n.x, z: n.z }
          bot.stateUntil = now + rand(2200, 3600)
          bot.partner = null
          bot.marchCp = null
          break
        }
      }
    }

    // --- emote chatter (bots stand still and perform) ---
    if (now < bot.emoteUntil) {
      p.anim = bot.emoteAnim
      p.lastStateTime = now
      return
    }
    if (now >= bot.nextEmoteAt && bot.state !== 'flee' && bot.state !== 'arrive') {
      const emote = pick(BOT_EMOTES)
      bot.emoteUntil = now + rand(1500, 2200)
      bot.emoteAnim = EMOTE_ANIM[emote] ?? 'celebrate'
      p.anim = bot.emoteAnim
      bot.nextEmoteAt = now + rand(26_000, 80_000)
      this.io.to(this.room.id).emit('game:emote', p.id, emote)
      return
    }

    // --- one-liners ---
    if (now >= bot.nextQuipAt && bot.state !== 'flee') {
      bot.nextQuipAt = now + rand(50_000, 170_000)
      this.io.to(this.room.id).emit('game:quickmsg', p.id, randInt(0, 9))
    }

    // --- supply runs: grab a nearby non-token item ---
    if (now >= bot.nextPickupAt && bot.state !== 'flee') {
      bot.nextPickupAt = now + rand(30_000, 80_000)
      for (const def of WORLD.items) {
        if (def.type === 'token') continue
        if (dist2d(def.x, def.z, p.x, p.z) > 2.5) continue
        const st = this.room.itemStates.get(def.id)
        if (st && !st.taken && this.room.pickup(p.id, def.id)) break
      }
    }

    // --- state machine ---
    switch (bot.state) {
      case 'arrive': {
        // walk from the spawn gate into the plaza, then blend into the crowd
        if (this.moveToward(bot, bot.goal!.x, bot.goal!.z, dt) || dist2d(p.x, p.z, bot.goal!.x, bot.goal!.z) < 4) {
          bot.state = 'wander'
          bot.goal = randomGoal()
          bot.wp = null
        }
        break
      }
      case 'wander': {
        if (!bot.wp) { this.pickWaypoint(bot); break }
        if (this.moveToward(bot, bot.wp.x, bot.wp.z, dt)) {
          bot.wp = null
          // arrived at the wider goal?
          if (bot.goal && dist2d(p.x, p.z, bot.goal.x, bot.goal.z) < 7) {
            bot.goal = randomGoal()
            if (chance(0.5)) { this.enterIdle(bot, now); break }
            if (chance(0.45)) { this.trySocialize(bot, now); break }
          }
        }
        break
      }
      case 'idle': {
        p.anim = 'idle'
        p.ry += Math.sin(now / 900 + p.x) * dt * 0.6 // look around
        if (now >= bot.stateUntil) {
          if (chance(0.35)) this.trySocialize(bot, now)
          else { bot.state = 'wander'; bot.goal = randomGoal(); bot.wp = null }
        }
        break
      }
      case 'social': {
        const partner = partnerPos(this, bot)
        if (!partner) { bot.state = 'wander'; bot.wp = null; bot.goal = randomGoal(); break }
        const d = dist2d(p.x, p.z, partner.x, partner.z)
        if (d > 4.5) {
          this.moveToward(bot, partner.x, partner.z, dt)
        } else {
          p.anim = 'idle'
          p.ry = angleLerp(p.ry, Math.atan2(partner.x - p.x, partner.z - p.z), dt * 6)
        }
        if (now >= bot.stateUntil) { bot.state = 'wander'; bot.partner = null; bot.wp = null; bot.goal = randomGoal() }
        break
      }
      case 'flee': {
        if (bot.fleeFrom) this.moveAway(bot, bot.fleeFrom.x, bot.fleeFrom.z, dt)
        if (now >= bot.stateUntil) {
          bot.state = 'wander'
          bot.fleeFrom = null
          bot.node = nearestNode(p.x, p.z)
          bot.goal = randomGoal()
          bot.wp = null
          bot.speed = rand(2.3, 3.4)
        }
        break
      }
      case 'march': {
        const cp = WORLD.checkpoints.find((c) => c.id === bot.marchCp)
        if (!cp || this.room.checkpoints.has(cp.id)) {
          // checkpoint reached (by anyone) — celebrate then disperse
          if (chance(0.6)) { bot.emoteUntil = now + 2200; bot.emoteAnim = 'celebrate' }
          bot.state = 'wander'
          bot.marchCp = null
          bot.goal = randomGoal()
          bot.wp = null
          break
        }
        if (this.moveToward(bot, bot.goal!.x, bot.goal!.z, dt)) {
          if (chance(0.5)) { bot.emoteUntil = now + 2000; bot.emoteAnim = 'celebrate' }
          bot.state = 'wander'
          bot.marchCp = null
          bot.goal = randomGoal()
          bot.wp = null
        }
        break
      }
    }

    p.lastX = p.x
    p.lastZ = p.z
    p.lastStateTime = now
  }

  private enterIdle(bot: Bot, now: number) {
    bot.state = 'idle'
    bot.stateUntil = now + rand(2000, 6000)
    bot.wp = null
  }

  private trySocialize(bot: Bot, now: number) {
    const p = bot.p
    // prefer a nearby human (bots gravitate toward real protesters), else another bot
    let target: { id: string; x: number; z: number } | null = null
    for (const h of this.room.humans()) {
      if (h.detained || h.id === p.id) continue
      const d = dist2d(h.x, h.z, p.x, p.z)
      if (d < 10 && d > 1 && chance(0.5)) { target = { id: h.id, x: h.x, z: h.z }; break }
    }
    if (!target) {
      for (const b of this.bots.values()) {
        if (b.p.id === p.id || b.p.detained || b.p.dazed || b.state === 'march' || b.state === 'flee') continue
        const d = dist2d(b.p.x, b.p.z, p.x, p.z)
        if (d < 9 && d > 1.2) { target = { id: b.p.id, x: b.p.x, z: b.p.z }; break }
      }
    }
    if (!target) { this.enterIdle(bot, now); return }
    bot.state = 'social'
    bot.partner = target.id
    bot.stateUntil = now + rand(4500, 10_000)
    bot.wp = null
    if (chance(0.5)) this.io.to(this.room.id).emit('game:quickmsg', p.id, randInt(0, 9))
    // mutual: if the partner is a bot, it turns to face us too
    const other = this.bots.get(target.id)
    if (other && other.state !== 'flee' && other.state !== 'march') {
      other.state = 'social'
      other.partner = p.id
      other.stateUntil = bot.stateUntil
      if (chance(0.5)) this.io.to(this.room.id).emit('game:quickmsg', other.p.id, randInt(0, 9))
    }
  }

  /** Pick the next nav-graph waypoint, biased toward the current goal. */
  private pickWaypoint(bot: Bot) {
    const node = NAV[bot.node]
    if (!node || node.links.length === 0) { bot.node = nearestNode(bot.p.x, bot.p.z); return }
    let next: number
    if (bot.goal && chance(0.68)) {
      let best = node.links[0]
      let bestD = Infinity
      for (const l of node.links) {
        const d = (NAV[l].x - bot.goal.x) ** 2 + (NAV[l].z - bot.goal.z) ** 2
        if (d < bestD) { bestD = d; best = l }
      }
      next = best
    } else {
      next = pick(node.links)
    }
    bot.node = next
    const n = NAV[next]
    // small lateral jitter so bots don't walk in perfect single file
    const jx = n.x + rand(-2.2, 2.2)
    const jz = n.z + rand(-2.2, 2.2)
    bot.wp = pointBlocked(jx, jz, 1.0) ? { x: n.x, z: n.z } : { x: jx, z: jz }
  }

  /** Move toward a point; returns true on arrival. Handles anim + facing. */
  private moveToward(bot: Bot, tx: number, tz: number, dt: number): boolean {
    const p = bot.p
    const dx = tx - p.x
    const dz = tz - p.z
    const d = Math.hypot(dx, dz)
    if (d < 0.6) { p.anim = 'idle'; return true }
    const step = bot.speed * dt
    if (d <= step) { p.x = tx; p.z = tz; p.anim = 'idle'; return true }
    p.x += (dx / d) * step
    p.z += (dz / d) * step
    p.ry = angleLerp(p.ry, Math.atan2(dx, dz), dt * 8)
    p.anim = bot.speed > 4.6 ? 'run' : 'walk'
    return false
  }

  /** Run away from a threat, steering around walls. */
  private moveAway(bot: Bot, fx: number, fz: number, dt: number) {
    const p = bot.p
    const speed = 6.6
    let dx = p.x - fx
    let dz = p.z - fz
    const d = Math.hypot(dx, dz) || 1
    dx /= d; dz /= d
    const step = speed * dt
    // try the direct route, then swing up to ±100° if a wall is in the way
    for (const ang of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
      const ca = Math.cos(ang), sa = Math.sin(ang)
      const nx = p.x + (dx * ca - dz * sa) * step
      const nz = p.z + (dx * sa + dz * ca) * step
      if (nx < -45 || nx > 45 || nz > 7 || nz < NAV_Z_MAX + 2) continue
      if (!pointBlocked(nx, nz, 1.1)) {
        p.x = nx
        p.z = nz
        p.ry = angleLerp(p.ry, Math.atan2(dx * ca - dz * sa, dx * sa + dz * ca), dt * 10)
        p.anim = 'run'
        return
      }
    }
    p.anim = 'run' // cornered — keep running on the spot
  }

  // ---------- AOI broadcast (replaces Room's flat game:players blast) ----------

  private broadcastPlayers() {
    if (this.disposed) return
    const started = performance.now()
    const humans: PlayerState[] = this.room.humans()
    if (humans.length === 0) return
    const bots: PlayerState[] = []
    for (const b of this.bots.values()) bots.push(b.p)
    const n = bots.length
    // Per-tick payload cache: each bot's wire state is built exactly ONCE per tick
    // (was O(humans × bots) recomputation + allocation at 12 Hz). Near cache keeps
    // the full round2 fidelity; mid cache quantizes to 1 decimal (10 cm) for the
    // MID band and the FAR sweep.
    const nearCache: PlayerNetState[] = new Array(n)
    const midCache: PlayerNetState[] = new Array(n)
    for (let i = 0; i < n; i++) {
      nearCache[i] = playerNet(bots[i])
      midCache[i] = botNet1(bots[i])
    }
    // rotating far-window sweep — cadence unchanged (≈ every n / BOT_FAR_WINDOW ticks)
    const { ids: windowIds, nextCursor } = computeFarWindow(bots, this.farCursor)
    this.farCursor = nextCursor
    this.tickCount++
    const ctx: AoiCtx = {
      tick: this.tickCount,
      farCursor: this.farCursor,
      windowIds,
      near: nearCache,
      mid: midCache,
      humans: humans.map((p) => playerNet(p)), // humans: always full detail in every payload
    }
    let entriesSent = 0
    for (const h of humans) {
      const payload = selectAoiPayload(bots, h, ctx)
      entriesSent += payload.length
      this.io.to(h.id).emit('game:players', payload)
    }
    // cheap EMAs on this season + fold into the module-level aggregate for /health
    const dur = performance.now() - started
    const gap = this.lastBroadcastAt > 0 ? started - this.lastBroadcastAt : TICK_MS
    this.lastBroadcastAt = started
    const k = 0.15
    this.statRate += (1000 / Math.max(1, gap) - this.statRate) * k
    this.statEntries += (entriesSent - this.statEntries) * k
    this.statMs += (dur - this.statMs) * k
    recordBroadcastTick(entriesSent, dur)
  }
}

/** Partner position for a socializing bot (human or bot). */
function partnerPos(season: Season, bot: Bot): { x: number; z: number } | null {
  if (!bot.partner) return null
  const other = season.room.getPlayer(bot.partner)
  if (!other || other.detained || other.dazed) return null
  return { x: other.x, z: other.z }
}

// ---------- matchmaking ----------

export class SeasonManager {
  private seasons = new Map<string, Season>()
  private counter = 0

  constructor(private io: SocketIOServer, private rooms: Map<string, Room>, private decorateRoom?: (room: Room) => void) {}

  /**
   * Find the liveliest season with room for one more human, or create the next one.
   * "Full" = SEASON_MAX_HUMANS real players — bots always backfill the rest.
   */
  assign(): Season {
    let best: Season | null = null
    for (const s of this.seasons.values()) {
      if (s.room.humansCount() >= SEASON_MAX_HUMANS) continue
      if (!best) { best = s; continue }
      const bh = best.room.humansCount()
      const sh = s.room.humansCount()
      if (sh > bh || (sh === bh && s.createdAt > best.createdAt)) best = s
    }
    if (best) return best
    this.counter++
    const season = new Season(this.io, `sea_${this.counter}`, `SEASON #${this.counter}`, (id) => {
      const s = this.seasons.get(id)
      if (s) { s.dispose(); this.seasons.delete(id); this.rooms.delete(id) }
    }, this.decorateRoom)
    this.seasons.set(season.id, season)
    this.rooms.set(season.id, season.room)
    return season
  }

  get(roomId: string): Season | undefined {
    return this.seasons.get(roomId)
  }

  /** Cheap live snapshot of every season — consumed by the /health endpoint. */
  list(): SeasonInfo[] {
    const out: SeasonInfo[] = []
    for (const s of this.seasons.values()) out.push(s.info())
    return out
  }

  /** Real (socket-backed) players across every season — for the global join cap. */
  totalHumans(): number {
    let n = 0
    for (const s of this.seasons.values()) n += s.room.humansCount()
    return n
  }
}
