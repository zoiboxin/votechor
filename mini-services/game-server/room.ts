// VoteChor game server — Room: authoritative simulation state for one match instance.
// Holds players, NPC brains, item states, boss brain, checkpoints, gate, searchlights
// and runs the 100ms tick (NPCs, searchlights, vehicles, boss, detention, broadcasts).
import type { Server as SocketIOServer } from 'socket.io'
import { buildWorldDef } from '../../src/game/shared/world-def'
import {
  createNpcStates,
  tickNpc,
  applyNoise,
  type NpcBrainState,
  type NpcPlayerView,
} from '../../src/game/shared/npc-brain'
import {
  createBossBrain,
  tickBoss,
  grabBallot,
  depositBallot,
  registerBossHit,
  type BossBrain,
} from '../../src/game/shared/boss-brain'
import {
  TOKENS_NEEDED,
  DETENTION_SECONDS,
  DAMAGE,
  MATCH_TIME_LIMIT,
  CAPTURE_MESSAGES,
  archetypeById,
  GIFT_TYPES,
  POLICE_ATTACK,
} from '../../src/game/shared/constants'
import type {
  AnimName,
  BossNetState,
  ItemNetState,
  MatchEndPayload,
  NpcNetState,
  PlayerNetState,
} from '../../src/game/shared/types'

// One shared immutable world (defs are pure data; brains are per-room).
export const WORLD = buildWorldDef()

// ---------- Phase 6: random detention release points ----------

export interface ReleasePoint { id: string; x: number; z: number; label: string }

const RELEASE_PAD = 1.2 // clearance required from every (non-walkable) collider

/**
 * Candidates derived from WORLD data: the four checkpoint detention spots, the plaza
 * gate area, the market heart and the government-district garden corners. All sit at
 * z < -60 (out of the spawn/tutorial strip), off-road-ish, and far from the boss arena
 * gate at the world's far end. Colliding candidates are nudged (or rejected) at module
 * init — RELEASE_POINTS below is the validated list.
 */
const RELEASE_CANDIDATES: ReleasePoint[] = [
  { id: 'rel_plaza_gate', x: 6, z: -74, label: 'Plaza Gate Post' },        // checkpoint 1 detention, nudged off the tutorial platform
  { id: 'rel_plaza_west', x: -24, z: -76, label: 'Plaza West Corner' },    // plaza gate / west side
  { id: 'rel_market_heart', x: 0, z: -140, label: 'Chowk Market' },        // market center (Zone B)
  { id: 'rel_cp2_market_exit', x: 12, z: -190, label: 'Market Exit Post' },// checkpoint 2 detention
  { id: 'rel_cp3_security', x: 10, z: -268, label: 'Security Gate Post' }, // checkpoint 3 detention
  { id: 'rel_cp4_avenue', x: 14, z: -408, label: 'Avenue Junction Post' }, // checkpoint 4 detention
  { id: 'rel_gov_garden_w', x: -18, z: -470, label: 'Ministry Garden West' },
  { id: 'rel_gov_garden_e', x: 18, z: -470, label: 'Ministry Garden East' },
]

/** True when (x,z) sits inside any non-walkable collider inflated by `pad` (walkable platforms are step-ups, fine). */
function releasePointBlocked(x: number, z: number, pad: number): boolean {
  for (const c of WORLD.colliders) {
    if (c.walkable) continue
    if (x >= c.minX - pad && x <= c.maxX + pad && z >= c.minZ - pad && z <= c.maxZ + pad) return true
  }
  return false
}

/** Validated release points (colliding candidates nudged on a small deterministic spiral, then rejected). */
export const RELEASE_POINTS: ReleasePoint[] = (() => {
  const out: ReleasePoint[] = []
  for (const c of RELEASE_CANDIDATES) {
    if (!releasePointBlocked(c.x, c.z, RELEASE_PAD)) { out.push(c); continue }
    let placed = false
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [3, 0], [-3, 0], [0, 3], [0, -3], [4, 0], [-4, 0], [0, 4], [0, -4]]) {
      const nx = c.x + dx, nz = c.z + dz
      if (nx < -46 || nx > 46 || nz < -568 || nz > 7) continue
      if (!releasePointBlocked(nx, nz, RELEASE_PAD)) { out.push({ ...c, x: nx, z: nz }); placed = true; break }
    }
    if (!placed) console.log(`[room] release point REJECTED (collides with world): ${c.id}`)
  }
  return out
})()

/**
 * Pick a random release destination (Phase 6).
 * Filters: (a) never the player's lastReleaseId, (b) ≥30 m from any non-detained
 * squadmate — but only while ≥2 alternatives remain, (c) outside the boss arena zone,
 * (d) still clear of world colliders. Fallbacks: relax the squad filter → any point →
 * the spawn plaza (legacy detention behavior).
 */
export function pickReleasePoint(
  lastReleaseId: string | null,
  squadPositions: ReadonlyArray<{ x: number; z: number }>,
): ReleasePoint {
  const arena = WORLD.bossArena
  const inArena = (x: number, z: number) => Math.hypot(x - arena.x, z - arena.z) < arena.radius + 4
  const base = RELEASE_POINTS.filter((pt) =>
    pt.id !== lastReleaseId && !inArena(pt.x, pt.z) && !releasePointBlocked(pt.x, pt.z, RELEASE_PAD))
  let pool = base.filter((pt) => !squadPositions.some((s) => Math.hypot(s.x - pt.x, s.z - pt.z) < 30))
  if (pool.length < 2) pool = base // keep ≥2 alternatives: drop the squadmate filter first
  if (pool.length === 0) pool = RELEASE_POINTS.filter((pt) => !inArena(pt.x, pt.z))
  if (pool.length === 0) pool = RELEASE_POINTS.slice()
  if (pool.length === 0) return { id: 'spawn', x: WORLD.spawn.x, z: WORLD.spawn.z, label: 'Protest Plaza' }
  return randomOf(pool)
}

export const ROOM_CAP = 20
export const PLAYER_CAP = 200
const BOUNDS_X = 47 // ±
const BOUNDS_Z_MIN = -570
const BOUNDS_Z_MAX = 9
// Max horizontal movement accepted between two client state updates (>18 m/tick is a
// teleport — snap back to the last accepted position). Phase 3/10 tightened from 25:
// legit sprint tops out ~1 m per 83 ms update, so 18 m is a huge grace margin while
// still catching warp-cheats; the mechanism (snap to last accepted pos) is unchanged.
const MAX_STATE_DIST = 18
const MAX_STATE_Y = 14 // impossible altitude reject (world walls are 14 m tall)
const PICKUP_RADIUS = 3
const REVIVE_RADIUS = 3
const GIFT_RADIUS = 4.5
const ITEM_RESPAWN_MS = 30000
const VEHICLE_HIT_COOLDOWN_MS = 1200
const VEHICLE_RADIUS: Record<string, number> = { auto: 1.7, bus: 2.6, cow: 1.4 }
const VEHICLE_DAMAGE: Record<string, number> = { auto: 35, bus: 40, cow: 8 }
const TICK_MS = 100
const PLAYERS_BROADCAST_MS = 83 // ~12 Hz
const RATE_LIMIT_WINDOW_MS = 1000
const RATE_LIMIT_MAX = 5

const ANIMS: AnimName[] = ['idle', 'walk', 'run', 'jump', 'slide', 'dazed', 'detained', 'celebrate', 'throw', 'heal', 'down']

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const dist2d = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz)
const randomOf = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

export interface PlayerState {
  id: string
  name: string
  archetype: string
  bot: boolean // season bot (server-simulated protester, no socket behind it)
  x: number
  y: number
  z: number
  ry: number
  anim: AnimName
  health: number
  maxHealth: number
  detained: boolean
  detainUntil: number
  dazed: boolean
  dazedUntil: number
  tokens: number
  carrying: boolean
  joinedAt: number
  lastStateTime: number
  lastX: number
  lastZ: number
  noiseTimes: number[]
  emoteTimes: number[]
  giftTimes: number[]
  inviteTimes: number[]
  kudosTimes: number[]
  lastReleaseId: string | null // anti-repeat: avoid releasing to the same point twice in a row
}

export interface ItemState {
  taken: boolean
  takenBy?: string
  respawnAt?: number
}

export interface SearchlightAngle {
  id: string
  ry: number
  speed: number
}

export class Room {
  readonly id: string
  readonly code: string
  readonly isPublic: boolean
  readonly players = new Map<string, PlayerState>()
  npcs: NpcBrainState[]
  itemStates = new Map<string, ItemState>()
  boss: BossBrain
  checkpoints = new Set<number>()
  tokens = 0
  gateOpen = false
  matchStartedAt = Date.now()
  searchlights: SearchlightAngle[] = WORLD.searchlights.map(s => ({ id: s.id, ry: s.ry, speed: s.speed }))
  private vehicleHitAt = new Map<string, number>()
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private playersTimer: ReturnType<typeof setInterval> | null = null
  private tickCount = 0
  private disposed = false
  private ended = false

  constructor(private io: SocketIOServer, id: string, code: string, isPublic: boolean) {
    this.id = id
    this.code = code
    this.isPublic = isPublic
    this.npcs = createNpcStates(WORLD.npcs)
    this.boss = createBossBrain(WORLD.bossArena)
    this.itemStates = new Map(WORLD.items.map(i => [i.id, { taken: false } as ItemState]))
  }

  get size(): number {
    return this.players.size
  }

  // ---------- lifecycle ----------

  /** Start ticking once the first player joins. */
  start() {
    if (this.tickTimer || this.disposed) return
    this.tickTimer = setInterval(() => this.tick(), TICK_MS)
    this.playersTimer = setInterval(() => this.emitPlayers(), PLAYERS_BROADCAST_MS)
    // immediate first snapshots so fresh joiners render instantly
    this.emitRoom('game:npcs', this.npcsArray())
    this.emitRoom('game:items', this.itemsArray())
  }

  /** Stop all timers when the room empties. */
  dispose() {
    this.disposed = true
    if (this.tickTimer) clearInterval(this.tickTimer)
    if (this.playersTimer) clearInterval(this.playersTimer)
    this.tickTimer = null
    this.playersTimer = null
  }

  // ---------- players ----------

  addPlayer(socketId: string, name: string, archetype: string, opts?: { bot?: boolean; x?: number; z?: number }): PlayerState {
    const arch = archetypeById(archetype)
    const now = Date.now()
    const maxHealth = 100 + arch.stats.healthBonus
    const x = opts?.x ?? WORLD.spawn.x
    const z = opts?.z ?? WORLD.spawn.z
    const p: PlayerState = {
      id: socketId,
      name,
      archetype: arch.id,
      bot: opts?.bot ?? false,
      x,
      y: 0,
      z,
      ry: 0,
      anim: 'idle',
      health: maxHealth,
      maxHealth,
      detained: false,
      detainUntil: 0,
      dazed: false,
      dazedUntil: 0,
      tokens: 0,
      carrying: false,
      joinedAt: now,
      lastStateTime: now,
      lastX: x,
      lastZ: z,
      noiseTimes: [],
      emoteTimes: [],
      giftTimes: [],
      inviteTimes: [],
      kudosTimes: [],
      lastReleaseId: null,
    }
    this.players.set(socketId, p)
    this.start()
    return p
  }

  removePlayer(socketId: string): PlayerState | null {
    const p = this.players.get(socketId) ?? null
    if (p) {
      this.players.delete(socketId)
      this.vehicleHitAt.delete(socketId)
    }
    return p
  }

  getPlayer(socketId: string): PlayerState | undefined {
    return this.players.get(socketId)
  }

  /** Real (socket-backed) players — bots excluded. */
  humans(): PlayerState[] {
    const out: PlayerState[] = []
    for (const p of this.players.values()) if (!p.bot) out.push(p)
    return out
  }

  humansCount(): number {
    let n = 0
    for (const p of this.players.values()) if (!p.bot) n++
    return n
  }

  /**
   * Optional replacement for the legacy room-wide game:players broadcast.
   * Seasons set this to per-recipient AOI-filtered emission (99 bots make a
   * full roster blast at 12 Hz wasteful). When unset the legacy path runs.
   */
  playersBroadcaster: (() => void) | null = null

  /**
   * Optional: returns the positions of a player's non-detained squadmates (used by
   * release-point selection to avoid dropping detainees on their cell). index.ts owns
   * the squad maps and injects this for every room it creates (incl. seasons).
   * When unset, releasePlayer falls back to "all other non-detained humans".
   */
  squadmatePositions: ((playerId: string) => Array<{ x: number; z: number }>) | null = null

  private emitRoom(event: string, ...args: unknown[]) {
    this.io.to(this.id).emit(event, ...args)
  }

  // ---------- client-driven actions (validated server-side) ----------

  /** Store a validated player state update. Detained players are ignored. */
  handleState(socketId: string, s: { x?: unknown; y?: unknown; z?: unknown; ry?: unknown; anim?: unknown; carrying?: unknown }) {
    const p = this.players.get(socketId)
    if (!p || p.detained) return // detained → freeze, ignore updates
    const now = Date.now()

    let x = clamp(num(s.x, p.x), -BOUNDS_X, BOUNDS_X)
    let z = clamp(num(s.z, p.z), BOUNDS_Z_MIN, BOUNDS_Z_MAX)
    const y = Math.min(num(s.y, p.y), MAX_STATE_Y) // Phase 3/10: impossible altitude is clamped (walls are 14 m)
    const ry = num(s.ry, p.ry)

    // Boss gate: while closed, nobody slips through the barrier corridor
    if (!this.gateOpen && z < WORLD.bossArena.gateZ - 1 && Math.abs(x) < 11) {
      z = WORLD.bossArena.gateZ + 1 // snap back (-477)
    }

    // Speed check: teleport jumps snap back to last valid position
    if (dist2d(x, z, p.lastX, p.lastZ) > MAX_STATE_DIST) {
      x = p.lastX
      z = p.lastZ
    }

    p.x = x
    p.y = y
    p.z = z
    p.ry = ry
    const a = typeof s.anim === 'string' ? (s.anim as AnimName) : 'idle'
    p.anim = ANIMS.includes(a) ? a : 'idle'
    p.carrying = Boolean(s.carrying) // cosmetic flag; boss ballots are validated by proximity
    p.lastX = x
    p.lastZ = z
    p.lastStateTime = now
  }

  /** Validate + apply pickup. Returns true if the pickup happened. */
  pickup(socketId: string, itemId: unknown): boolean {
    const p = this.players.get(socketId)
    if (!p || p.detained) return false
    if (typeof itemId !== 'string') return false
    const def = WORLD.items.find(i => i.id === itemId)
    const st = this.itemStates.get(itemId)
    if (!def || !st || st.taken) return false
    if (dist2d(p.x, p.z, def.x, def.z) > PICKUP_RADIUS) return false

    st.taken = true
    st.takenBy = p.id
    if (def.type === 'token') {
      this.tokens++
      p.tokens++
      st.respawnAt = undefined // tokens are single-use
      this.emitRoom('game:tokens', this.tokens)
      this.checkGate()
    } else {
      st.respawnAt = Date.now() + ITEM_RESPAWN_MS
    }
    this.emitRoom('game:items', this.itemsArray())
    return true
  }

  /** Rate-limited noise distraction (5/s per player) applied to NPC brains. */
  noise(socketId: string, x: unknown, z: unknown): boolean {
    const p = this.players.get(socketId)
    if (!p) return false
    if (!this.rateLimit(p, 'noiseTimes')) return false
    applyNoise(this.npcs, num(x, p.x), num(z, p.z), 5.5)
    return true
  }

  /** Rate limiter: max 5 events/s per player per channel. */
  rateLimit(p: PlayerState, channel: 'noiseTimes' | 'emoteTimes' | 'giftTimes' | 'inviteTimes' | 'kudosTimes'): boolean {
    const now = Date.now()
    const arr = p[channel]
    while (arr.length && now - arr[0] > RATE_LIMIT_WINDOW_MS) arr.shift()
    if (arr.length >= RATE_LIMIT_MAX) return false
    arr.push(now)
    return true
  }

  /** Revive a dazed teammate within 3m. */
  revive(byId: string, targetId: unknown): boolean {
    const by = this.players.get(byId)
    const target = typeof targetId === 'string' ? this.players.get(targetId) : undefined
    if (!by || !target || !target.dazed || by.detained) return false
    if (dist2d(by.x, by.z, target.x, target.z) > REVIVE_RADIUS) return false
    target.dazed = false
    target.dazedUntil = 0
    target.health = DAMAGE.dazedRecoverHealth
    this.emitRoom('game:health', target.id, target.health, target.dazed)
    return true
  }

  /** Heal a teammate within 3m (+30 hp). */
  heal(byId: string, targetId: unknown): boolean {
    const by = this.players.get(byId)
    const target = typeof targetId === 'string' ? this.players.get(targetId) : undefined
    if (!by || !target || by.detained || target.detained) return false
    if (dist2d(by.x, by.z, target.x, target.z) > REVIVE_RADIUS) return false
    target.health = Math.min(target.maxHealth, target.health + 30)
    this.emitRoom('game:health', target.id, target.health, target.dazed)
    return true
  }

  /**
   * Gift an item to a nearby player (§11 eligible item sharing).
   * Server validates: type whitelist, rate limit, neither detained, distance ≤ GIFT_RADIUS.
   * Inventory lives client-side, so the receiver may bounce the gift back if full.
   */
  gift(byId: string, targetId: unknown, itemType: unknown): boolean {
    const by = this.players.get(byId)
    const target = typeof targetId === 'string' ? this.players.get(targetId) : undefined
    if (!by || !target || by.detained || target.detained) return false
    if (by.id === target.id) return false
    const type = String(itemType ?? '')
    if (!GIFT_TYPES.includes(type)) return false
    if (!this.rateLimit(by, 'giftTimes')) return false
    if (dist2d(by.x, by.z, target.x, target.z) > GIFT_RADIUS) return false
    // targeted emit — only the receiver sees the incoming gift
    this.io.to(target.id).emit('game:gift', { fromId: by.id, fromName: by.name, type })
    return true
  }

  /** Receiver's pockets were full — return the item card to the sender. */
  giftBounce(byId: string, targetId: unknown, itemType: unknown): boolean {
    const by = this.players.get(byId)
    const target = typeof targetId === 'string' ? this.players.get(targetId) : undefined
    if (!by || !target || by.id === target.id) return false
    const type = String(itemType ?? '')
    if (!GIFT_TYPES.includes(type)) return false
    if (!this.rateLimit(by, 'giftTimes')) return false
    this.io.to(target.id).emit('game:giftBounce', { toId: by.id, toName: by.name, type })
    return true
  }

  /** Boss hit during dizzy window (brain validates phase/rate). */
  bossHit(playerId: string): boolean {
    const p = this.players.get(playerId)
    if (!p || p.detained || p.dazed) return false
    return registerBossHit(this.boss, playerId, Date.now())
  }

  /** Grab a boss ballot — validated against the SERVER player position. */
  bossBallot(playerId: string): boolean {
    const p = this.players.get(playerId)
    if (!p || p.detained || p.dazed) return false
    const ok = grabBallot(this.boss, playerId, p.x, p.z)
    if (ok) {
      p.carrying = true
      this.emitBoss()
    }
    return ok
  }

  /** Deposit a carried ballot at the box — server player position. */
  bossDeposit(playerId: string): boolean {
    const p = this.players.get(playerId)
    if (!p || p.detained || p.dazed) return false
    const ok = depositBallot(this.boss, p.x, p.z)
    if (ok) {
      p.carrying = false
      this.emitBoss()
    }
    return ok
  }

  private checkGate() {
    if (!this.gateOpen && this.tokens >= TOKENS_NEEDED) {
      this.gateOpen = true
      this.emitRoom('game:gate', true)
    }
  }

  // ---------- damage / capture / detention ----------

  /** Server-owned health. Emits game:damage + game:health. 0 hp → dazed. */
  damagePlayer(playerId: string, amount: number, kind: string, now: number) {
    const p = this.players.get(playerId)
    if (!p || p.dazed || p.detained) return
    p.health = Math.max(0, p.health - amount)
    this.emitRoom('game:damage', p.id, amount, kind)
    if (p.health <= 0) {
      p.dazed = true
      p.dazedUntil = now + DAMAGE.dazedDuration * 1000
      p.carrying = false
    }
    this.emitRoom('game:health', p.id, p.health, p.dazed)
  }

  private capturePlayer(playerId: string, now: number) {
    const p = this.players.get(playerId)
    if (!p || p.detained || p.dazed) return
    p.detained = true
    p.detainUntil = now + DETENTION_SECONDS * 1000 * (p.archetype === 'accidental' ? 0.75 : 1)
    p.carrying = false
    p.anim = 'detained'
    this.emitRoom('game:capture', p.id, p.detainUntil, randomOf(CAPTURE_MESSAGES))
  }

  /**
   * Release to a random validated point (Phase 6): never the same point twice in a
   * row, ≥30 m from non-detained squadmates while alternatives remain, never inside
   * the boss arena. Detention duration semantics are unchanged.
   */
  private releasePlayer(p: PlayerState) {
    const squad = this.squadmatePositions
      ? this.squadmatePositions(p.id)
      : [...this.humans()].filter((h) => h.id !== p.id && !h.detained).map((h) => ({ x: h.x, z: h.z }))
    const dest = pickReleasePoint(p.lastReleaseId, squad)
    p.lastReleaseId = dest.id
    p.detained = false
    p.detainUntil = 0
    p.x = dest.x
    p.z = dest.z
    p.y = 0
    p.lastX = dest.x
    p.lastZ = dest.z
    p.lastStateTime = Date.now()
    p.anim = 'idle'
    // 4th arg `label` is additive — existing clients ignore extra args
    this.emitRoom('game:release', p.id, p.x, p.z, dest.label)
  }

  // ---------- tick ----------

  private tick() {
    if (this.disposed) return
    const now = Date.now()
    const dt = TICK_MS / 1000
    this.tickCount++

    // Eligible player views: NPCs and boss ignore detained/dazed players.
    // Fresh joiners get an 8s spawn grace so nobody is captured while loading in.
    const views: NpcPlayerView[] = []
    const bossViews: NpcPlayerView[] = [] // humans only — bots never start the boss fight
    for (const p of this.players.values()) {
      if (!p.detained && !p.dazed) {
        const grace = now - p.joinedAt < 10000 && dist2d(p.x, p.z, WORLD.spawn.x, WORLD.spawn.z) < 16
        const view: NpcPlayerView = { id: p.id, x: p.x, z: p.z, detained: p.detained, dazed: p.dazed, hidden: grace, bot: p.bot, health: p.health }
        views.push(view)
        if (!p.bot) bossViews.push(view)
      }
    }

    // 1. NPC brains
    for (const n of this.npcs) {
      const res = tickNpc(n, views, WORLD.colliders, dt, now)
      for (const ev of res.events) {
        if (ev.kind === 'capture') this.capturePlayer(ev.playerId, now)
        else if (ev.kind === 'hit') {
          // Phase 5 police melee — damagePlayer emits game:damage (kind 'police') + game:health,
          // and 0 hp → dazed. No extra event: clients react to game:damage.
          this.damagePlayer(ev.playerId, ev.amount ?? POLICE_ATTACK.fallbackDmg, 'police', now)
        }
      }
    }

    // 2. Searchlight rotation
    for (const sl of this.searchlights) sl.ry += sl.speed * dt

    // 3. Vehicle collisions (positions deterministic from matchStartedAt)
    this.vehicleDamage(now)

    // 4. Daze auto-recovery
    for (const p of this.players.values()) {
      if (p.dazed && now >= p.dazedUntil) {
        p.dazed = false
        p.dazedUntil = 0
        p.health = DAMAGE.dazedRecoverHealth
        this.emitRoom('game:health', p.id, p.health, p.dazed)
      }
    }

    // 5. Detention timers → release to a random validated point (Phase 6)
    for (const p of this.players.values()) {
      if (p.detained && now >= p.detainUntil) this.releasePlayer(p)
    }

    // 6. Checkpoint activation
    if (!this.ended) {
      for (const p of this.players.values()) {
        if (p.detained) continue
        for (const cp of WORLD.checkpoints) {
          if (this.checkpoints.has(cp.id)) continue
          if (dist2d(p.x, p.z, cp.x, cp.z) <= cp.radius) {
            this.checkpoints.add(cp.id)
            this.emitRoom('game:checkpoint', cp.id, p.name, this.checkpoints.size)
          }
        }
      }
    }

    // 7. Boss brain — only real protesters can wake the Vote Collector
    const bossEv = tickBoss(this.boss, bossViews, dt, now)
    for (const d of bossEv.damage) this.damagePlayer(d.playerId, d.amount, d.kind, now)

    // 8. Match end (victory or 900s cap) → emit once, then reset the room
    const elapsed = (now - this.matchStartedAt) / 1000
    if (!this.ended && (bossEv.defeated || elapsed >= MATCH_TIME_LIMIT)) {
      this.ended = true
      this.emitMatchEnd(bossEv.defeated, now)
      this.resetMatch()
      this.ended = false
    }

    // 9. Item respawns
    let itemsChanged = false
    for (const st of this.itemStates.values()) {
      if (st.taken && st.respawnAt !== undefined && now >= st.respawnAt) {
        st.taken = false
        st.takenBy = undefined
        st.respawnAt = undefined
        itemsChanged = true
      }
    }
    if (itemsChanged) this.emitRoom('game:items', this.itemsArray())

    // 10. NPC snapshots at 10 Hz (searchlights included)
    if (this.players.size > 0) this.emitRoom('game:npcs', this.npcsArray())

    // 11. Boss broadcasts: 10 Hz while active, 1 Hz idle
    if (this.boss.started) this.emitBoss()
    else if (this.tickCount % 10 === 0) this.emitBoss()
  }

  private vehicleDamage(now: number) {
    const elapsed = (now - this.matchStartedAt) / 1000
    for (const v of WORLD.vehicles) {
      const [vx, vz] = vehiclePosition(v.path, v.speed, elapsed)
      const radius = VEHICLE_RADIUS[v.kind] ?? 1.7
      const dmg = VEHICLE_DAMAGE[v.kind] ?? 35
      for (const p of this.players.values()) {
        if (p.detained || p.dazed) continue
        const last = this.vehicleHitAt.get(p.id) ?? 0
        if (now - last < VEHICLE_HIT_COOLDOWN_MS) continue
        if (dist2d(p.x, p.z, vx, vz) < radius) {
          this.vehicleHitAt.set(p.id, now)
          this.damagePlayer(p.id, dmg, v.kind, now)
        }
      }
    }
  }

  private emitMatchEnd(victory: boolean, now: number) {
    const playersOnline = Object.keys(this.io.sockets.sockets).length
    const payload: MatchEndPayload = {
      matchId: 'm_' + Math.random().toString(36).slice(2, 10),
      victory,
      duration: Math.round((now - this.matchStartedAt) / 1000),
      position: 1,
      tokens: this.tokens,
      checkpoints: this.checkpoints.size,
      distance: 0, // per-player distance is tracked client-side
      rescues: 0,
      revives: 0,
      itemsCollected: 0,
      bossContribution: 0,
      detentions: 0,
      playersOnline,
    }
    this.emitRoom('game:matchend', payload)
  }

  /** Fresh match state: new clock, reset items/npcs/boss/checkpoints/tokens/gate. */
  private resetMatch() {
    this.matchStartedAt = Date.now()
    this.checkpoints.clear()
    this.tokens = 0
    this.gateOpen = false
    this.npcs = createNpcStates(WORLD.npcs)
    this.boss = createBossBrain(WORLD.bossArena)
    this.itemStates = new Map(WORLD.items.map(i => [i.id, { taken: false } as ItemState]))
    this.vehicleHitAt.clear()
    for (const p of this.players.values()) {
      if (p.detained) {
        p.detained = false
        p.detainUntil = 0
      }
      if (p.dazed) {
        p.dazed = false
        p.dazedUntil = 0
      }
      p.health = p.maxHealth
      p.carrying = false
    }
    this.emitRoom('game:items', this.itemsArray())
    this.emitRoom('game:tokens', this.tokens)
    this.emitRoom('game:gate', false)
    this.emitBoss()
  }

  // ---------- snapshots ----------

  playersArray(): PlayerNetState[] {
    const out: PlayerNetState[] = []
    for (const p of this.players.values()) out.push(playerNet(p))
    return out
  }

  npcsArray(): NpcNetState[] {
    const out: NpcNetState[] = []
    const now = Date.now()
    for (const n of this.npcs) {
      const net: NpcNetState = { id: n.id, x: round2(n.x), z: round2(n.z), ry: round2(n.ry), state: n.state, alert: round2(n.alert) }
      // Phase 5 telegraph fields — only sent while meaningful (keeps the 10 Hz payload small):
      // 'windup' + attackAt (absolute server ms the strike lands → client times impact FX),
      // or 'stagger' for the 0.35 s window after a landed strike.
      if (n.attackTelegraphUntil > now) {
        net.anim = 'windup'
        net.attackAt = n.attackTelegraphUntil
      } else if (n.staggerUntil > now) {
        net.anim = 'stagger'
      }
      out.push(net)
    }
    for (const sl of this.searchlights) {
      out.push({ id: sl.id, x: WORLD.searchlights.find(s => s.id === sl.id)?.x ?? 0, z: WORLD.searchlights.find(s => s.id === sl.id)?.z ?? 0, ry: round2(sl.ry), state: 'idle', alert: 0 })
    }
    return out
  }

  itemsArray(): ItemNetState[] {
    const out: ItemNetState[] = []
    for (const [id, st] of this.itemStates) {
      out.push({ id, taken: st.taken, takenBy: st.takenBy, respawnAt: st.respawnAt })
    }
    return out
  }

  bossPayload(): { boss: BossNetState; ballots: { id: string; x: number; z: number; taken: boolean }[] } {
    const b = this.boss
    return {
      boss: {
        active: b.active,
        phase: b.phase,
        health: b.health,
        maxHealth: b.maxHealth,
        stateName: b.stateName,
        timer: round2(b.timer),
        speechProgress: round2(b.speech),
        interruptPoints: round2(b.interruptPoints),
        documents: round2(b.documents),
        hits: b.hits,
        dizzyTimer: round2(b.dizzyTimer),
        teamworkProgress: round2(b.teamworkProgress),
        votes: b.votes,
        votesNeeded: b.votesNeeded,
        x: b.x,
        z: b.z,
        ry: b.ry,
        telegraphs: b.telegraphs,
        stations: b.stations,
        paperwork: b.paperwork.map(h => ({ id: h.id, x: round2(h.x), z: round2(h.z), vx: round2(h.vx), vz: round2(h.vz) })),
      },
      ballots: b.ballots.map(bl => ({ id: bl.id, x: bl.x, z: bl.z, taken: bl.taken })),
    }
  }

  emitBoss() {
    const { boss, ballots } = this.bossPayload()
    this.emitRoom('game:boss', boss, ballots)
  }

  emitPlayers() {
    if (this.disposed || this.players.size === 0) return
    if (this.playersBroadcaster) { this.playersBroadcaster(); return }
    this.emitRoom('game:players', this.playersArray())
  }
}

/** Wire format for one player/bot — shared by the legacy and AOI broadcast paths. */
export function playerNet(p: PlayerState): PlayerNetState {
  return {
    id: p.id,
    name: p.name,
    archetype: p.archetype,
    x: round2(p.x),
    y: round2(p.y),
    z: round2(p.z),
    ry: round2(p.ry),
    anim: p.anim,
    health: p.health,
    detained: p.detained,
    dazed: p.dazed,
    tokens: p.tokens,
    carrying: p.carrying,
  } as PlayerNetState
}

// ---------- deterministic vehicles (mirrors client VehicleSystem ping-pong) ----------

/** 2-point linear ping-pong — identical formula to client npcs.ts VehicleSystem. */
function vehiclePosition(path: Array<[number, number]>, speed: number, worldTime: number): [number, number] {
  const a = path[0]
  const b = path[path.length - 1]
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const period = (len / speed) * 2
  const phase = ((worldTime % period) + period) % period
  const half = period / 2
  const t = phase < half ? phase / half : 2 - phase / half // ping-pong 0..1..0
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
