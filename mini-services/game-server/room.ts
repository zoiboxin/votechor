// VoteChor game server — Room: authoritative simulation state for one match instance.
// Holds players, NPC brains, item states, boss brain, checkpoints, gate, searchlights
// and runs the 100ms tick (NPCs, searchlights, vehicles, boss, detention, broadcasts).
import type { Server as SocketIOServer } from 'socket.io'
import { buildWorldDef } from '../../src/game/shared/world-def'
import {
  createNpcStates,
  tickNpc,
  applyNoise,
  propagateChase,
  type NpcBrainState,
  type NpcPlayerView,
} from '../../src/game/shared/npc-brain'
import {
  createBossBrain,
  tickBoss,
  grabBallot,
  depositBallot,
  registerBossHit,
  dropBallotsOf,
  type BossBrain,
} from '../../src/game/shared/boss-brain'
// v87 — SHARED WILD: server-authoritative zombies + street animals (was client-local)
import {
  createZombieSimStates,
  tickZombies,
  type ZombieSimState,
} from '../../src/game/shared/zombie-sim'
import {
  createAnimalSimStates,
  tickAnimals,
  feedAnimalById,
  type AnimalSimState,
  type AnimalSimEvent,
} from '../../src/game/shared/animal-sim'
import {
  TOKENS_NEEDED,
  DETENTION_SECONDS,
  DAMAGE,
  DETECT,
  MATCH_TIME_LIMIT,
  CAPTURE_MESSAGES,
  archetypeById,
  GIFT_TYPES,
  POLICE_ATTACK,
  POLICE_STRIKE,
  PLAYER_ROLE,
  POLICE_HIGH_GROUND_Y,
  INVENTORY_MAX,
  ITEM_CONFIG,
} from '../../src/game/shared/constants'
import type {
  AnimName,
  BossNetState,
  DroppedItemNetState,
  ItemNetState,
  ItemType,
  MatchEndPayload,
  NpcNetState,
  PlayerNetState,
  WildNetState,
  ZombieNetState,
  AnimalNetState,
  WildEventNet,
} from '../../src/game/shared/types'

// One shared immutable world (defs are pure data; brains are per-room).
export const WORLD = buildWorldDef()

// ---------- Phase 6: random detention release points ----------

export interface ReleasePoint { id: string; x: number; z: number; label: string }

const RELEASE_PAD = 1.2 // clearance required from every (non-walkable) collider
/** v49 — post-release police grace: a just-released protester is `hidden` to NPC
 *  brains (invisible beyond 3 m) and immune to human-officer arrest/baton for this
 *  long, so nobody gets re-caught the instant they respawn. */
const RELEASE_GRACE_MS = 6000
/** v86 — anti-ambush window granted when a pursuit ends WITHOUT a capture (the
 *  npc-brain soft-escape drop): the quarry just outran the officer, so nearby
 *  fresh acquisitions can't instantly windup/strike/cuff/grab them. */
const ESCAPE_GRACE_MS = 3000

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

/** v68 — wild-death pool: the city release posts plus jungle-edge and deep-jungle
 *  clearings (each validated against the world colliders like the city list).
 *  v69 — ring-jungle points for the round wild. */
const WILD_EXTRA: ReleasePoint[] = [
  { id: 'wild_ring_e', x: 166, z: -360, label: 'East Ring Road' },
  { id: 'wild_aam', x: 140, z: -500, label: 'Aam Bagicha' },
  { id: 'wild_camp', x: 66, z: -706, label: 'The Lost Camp' },
  { id: 'wild_deep', x: -60, z: -620, label: 'Vanodyan Deep' },
  { id: 'wild_bank', x: -84, z: -670, label: 'River Bank' },
  { id: 'wild_east_wing', x: 240, z: -379, label: 'East Jungle' },
  { id: 'wild_west_wing', x: -240, z: -240, label: 'West Jungle' },
  { id: 'wild_graves_se', x: 300, z: -596, label: 'Forgotten Graves' },
]
export const WILD_RELEASE_POINTS: ReleasePoint[] = (() => {
  const out = [...RELEASE_POINTS]
  for (const c of WILD_EXTRA) {
    if (!releasePointBlocked(c.x, c.z, RELEASE_PAD)) out.push(c)
    else console.log(`[room] wild respawn point REJECTED (collides with world): ${c.id}`)
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
  points: readonly ReleasePoint[] = RELEASE_POINTS,
): ReleasePoint {
  const arena = WORLD.bossArena
  const inArena = (x: number, z: number) => Math.hypot(x - arena.x, z - arena.z) < arena.radius + 4
  const base = points.filter((pt) =>
    pt.id !== lastReleaseId && !inArena(pt.x, pt.z) && !releasePointBlocked(pt.x, pt.z, RELEASE_PAD))
  let cand = base.filter((pt) => !squadPositions.some((s) => Math.hypot(s.x - pt.x, s.z - pt.z) < 30))
  if (cand.length < 2) cand = base // keep ≥2 alternatives: drop the squadmate filter first
  if (cand.length === 0) cand = points.filter((pt) => !inArena(pt.x, pt.z))
  if (cand.length === 0) cand = points.slice()
  if (cand.length === 0) return { id: 'spawn', x: WORLD.spawn.x, z: WORLD.spawn.z, label: 'Protest Plaza' }
  return randomOf(cand)
}

export const ROOM_CAP = 20
export const PLAYER_CAP = 200
const BOUNDS_X = 658 // v72 — the grown ROUND world disc (bounding square; the client leash is the circle)
const BOUNDS_Z_MIN = -998
const BOUNDS_Z_MAX = 318
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
/** Confiscated loot piles vanish this long after being dropped (squad rescue window). */
const DROP_TTL_MS = 150000
/** Player-dropped / thrown-item landing spots persist this long (user request:
 *  thrown items must REMAIN on the ground to grab again — 15 min, not 2.5). */
const THROWN_DROP_TTL_MS = 900000
/** Ring layout for confiscated loot scattering around the capture spot. */
const DROP_RING_RADIUS = 1.5
const VEHICLE_HIT_COOLDOWN_MS = 1200
const VEHICLE_RADIUS: Record<string, number> = { auto: 1.7, bus: 2.6, cow: 1.4, car: 1.8, bike: 1.0 }
const VEHICLE_DAMAGE: Record<string, number> = { auto: 35, bus: 40, cow: 8, car: 35, bike: 22 }
const TICK_MS = 100
const PLAYERS_BROADCAST_MS = 83 // ~12 Hz
const RATE_LIMIT_WINDOW_MS = 1000
const RATE_LIMIT_MAX = 5

const ANIMS: AnimName[] = ['idle', 'walk', 'run', 'jump', 'fall', 'land', 'recover', 'slide', 'dazed', 'detained', 'celebrate', 'throw', 'heal', 'down', 'kick', 'punch', 'dead', 'ride'] // v115 — 'ride' = seated scooter (client relays; no server physics change)

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
  releaseGraceUntil: number // v49 — until this ms tick, brains cannot re-target and officers cannot cuff/strike this player
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
  wildDeathAt?: number // v68 — last wild-death respawn ms tick (rate-limit)
  giftTimes: number[]
  inviteTimes: number[]
  kudosTimes: number[]
  chatTimes: number[]
  lastReleaseId: string | null // anti-repeat: avoid releasing to the same point twice in a row
  confiscatedFor: number // detainUntil marker — one inventory confiscation per detention
  cosmetics?: Record<string, string | boolean> // wardrobe — sent on join ack + playerjoined only
  role: 'protector' | 'police' // chosen side — police players get arrest powers + officer immunity
  arrests: number // validated suspects detained by this officer
  lastArrestAt: number // arrest spam gate
  lastStrikeAt: number // baton-strike (F) spam gate — police-role only
}

export interface ItemState {
  taken: boolean
  takenBy?: string
  respawnAt?: number
}

/** Ground loot created when police confiscate a detainee's inventory cards. */
export interface DroppedItem {
  id: string
  type: ItemType
  x: number
  y: number
  z: number
  ownerId: string
  expiresAt: number
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
  droppedItems = new Map<string, DroppedItem>()
  boss: BossBrain
  // v87 — SHARED WILD: one authoritative horde + one set of street animals per room
  zombies: ZombieSimState[] = createZombieSimStates()
  animals: AnimalSimState[] = createAnimalSimStates()
  private zPackGate = { spotT: 0 }
  private lastTickPos = new Map<string, { x: number; z: number }>()
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
    // v87 — fresh horde + fresh animals every match (everyone sees the same wild)
    this.zombies = createZombieSimStates()
    this.animals = createAnimalSimStates()
    this.zPackGate.spotT = 0
    this.lastTickPos.clear()
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
    this.emitRoom('game:wild', this.wildPayload())
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

  addPlayer(socketId: string, name: string, archetype: string, opts?: { bot?: boolean; x?: number; z?: number; cosmetics?: Record<string, string | boolean>; role?: 'protector' | 'police' }): PlayerState {
    const arch = archetypeById(archetype)
    const now = Date.now()
    const maxHealth = 100 + arch.stats.healthBonus
    const x = opts?.x ?? WORLD.spawn.x
    const z = opts?.z ?? WORLD.spawn.z
    const p: PlayerState = {
      id: socketId,
      name,
      archetype: arch.id,
      cosmetics: opts?.cosmetics,
      role: opts?.role === 'police' ? 'police' : 'protector',
      arrests: 0,
      lastArrestAt: 0,
      lastStrikeAt: 0,
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
      releaseGraceUntil: 0,
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
      chatTimes: [],
      lastReleaseId: null,
      confiscatedFor: 0,
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

    // Confiscated loot piles (game:dropped) — dynamic ids, not in itemStates.
    const drop = this.droppedItems.get(itemId)
    if (drop) {
      if (dist2d(p.x, p.z, drop.x, drop.z) > PICKUP_RADIUS) return false
      this.droppedItems.delete(itemId)
      this.emitRoom('game:dropTaken', itemId, p.id, p.name)
      return true
    }

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
  rateLimit(p: PlayerState, channel: 'noiseTimes' | 'emoteTimes' | 'giftTimes' | 'inviteTimes' | 'kudosTimes' | 'chatTimes'): boolean {
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

    // ---- BUSTED penalty: police confiscate everything the detainee was carrying ----
    // 1. Vote tokens this player recovered go back into the world ("filed as
    //    evidence" — re-hidden at their original hiding spots so the match stays
    //    completable). Global + personal counters drop accordingly.
    const lostTokens = p.tokens
    p.tokens = 0
    p.confiscatedFor = p.detainUntil // allow exactly one inventory confiscation per detention
    if (lostTokens > 0) {
      this.tokens = Math.max(0, this.tokens - lostTokens)
      for (const [id, st] of this.itemStates) {
        if (!st.taken || st.takenBy !== p.id) continue
        const def = WORLD.items.find(i => i.id === id)
        if (!def || def.type !== 'token') continue
        st.taken = false
        st.takenBy = undefined
        st.respawnAt = undefined
      }
      this.emitRoom('game:tokens', this.tokens)
      this.emitRoom('game:items', this.itemsArray())
    }
    // 2. A carried boss ballot slips out of their hands back onto the arena floor.
    if (dropBallotsOf(this.boss, p.id)) this.emitBoss()

    // 3. Inventory cards are reported by the detainee's client (inventory lives
    //    client-side, same trust model as gifting) and dropped as a loot pile at
    //    the capture spot via game:confiscate → game:dropped.

    // lostTokens is additive — older clients ignore the extra arg.
    this.emitRoom('game:capture', p.id, p.detainUntil, randomOf(CAPTURE_MESSAGES), lostTokens)
  }

  /**
   * Police-role arrest (player officer): cuff a suspect on E.
   * Server validates: issuer is police, target exists + is a protester (never a
   * fellow officer / self), within PLAYER_ROLE.arrestRange (2.8 m), not already
   * detained/dazed, and the issuer's 1.4 s arrest cooldown. On success the target
   * goes through the SAME capturePlayer pipeline (token confiscation, loot drop,
   * release timer) and the officer gets a personal `game:arrested` confirmation.
   */
  arrest(issuerId: string, targetId: unknown, now: number): boolean {
    const officer = this.players.get(issuerId)
    if (!officer || officer.role !== 'police' || officer.detained || officer.dazed) return false
    if (typeof targetId !== 'string' || targetId === issuerId) return false
    if (now - officer.lastArrestAt < PLAYER_ROLE.arrestCooldownMs) return false
    const target = this.players.get(targetId)
    if (!target || target.role === 'police') return false
    if (target.detained || target.dazed) return false
    if (now < target.releaseGraceUntil) return false // v49 — post-release grace: no instant re-cuffs at the respawn
    // v47 — elevation-aware reach: officers can cuff UP onto objects (carts, the
    // stage, the fountain rim, containers) — horizontal range grows with the
    // target's height above the officer, mirroring the client's game.ts formula.
    // v88 — HIGH-GROUND IMMUNITY: EXCEPT when the target's feet sit ≥
    // POLICE_HIGH_GROUND_Y above the officer's — no detaining from the ground up
    // at a crate/cart/hay/stage top. An officer standing on the SAME surface
    // (dy ≈ 0) still cuffs normally.
    const dyUp = Math.max(0, (target.y ?? 0) - (officer.y ?? 0))
    if (dyUp >= POLICE_HIGH_GROUND_Y) return false
    const reach = PLAYER_ROLE.arrestRange + Math.min(dyUp * 0.75, 2.2)
    if (dist2d(officer.x, officer.z, target.x, target.z) > reach ** 2) return false
    officer.lastArrestAt = now
    officer.arrests++
    this.capturePlayer(targetId, now)
    // personal confirmation → the officer's client counts the arrest honestly
    this.io.to(issuerId).emit('game:arrested', targetId, target.name, officer.arrests)
    return true
  }

  /**
   * Police-role baton strike (F): lathi-hit a protester. Server validates: issuer
   * is a live officer (police, not detained/dazed), target is a protester (never a
   * fellow officer / self), within POLICE_STRIKE.range + 0.6 m latency grace, not
   * detained/dazed, and the issuer's 1.1 s swing cooldown. On success the target
   * takes POLICE_STRIKE.dmg through the SAME damagePlayer pipeline NPC officers use
   * (game:damage kind 'police' + game:health, 0 hp → dazed), and the whole room gets
   * a `game:strike` FX broadcast (swing anim on the officer rig + impact burst).
   */
  strike(issuerId: string, targetId: unknown, now: number): boolean {
    const officer = this.players.get(issuerId)
    if (!officer || officer.role !== 'police' || officer.detained || officer.dazed) return false
    if (typeof targetId !== 'string' || targetId === issuerId) return false
    if (now - officer.lastStrikeAt < POLICE_STRIKE.cooldownMs) return false
    const target = this.players.get(targetId)
    if (!target || target.role === 'police') return false // officers never strike fellow officers
    if (target.detained || target.dazed) return false
    if (now < target.releaseGraceUntil) return false // v49 — post-release grace: no instant lathi at the respawn
    // v47 — elevation-aware lathi (mirrors the client's game.ts formula): the
    // reach grows with the target's height above the officer, capped at +2.2 m
    // v88 — HIGH-GROUND IMMUNITY: no lathi from the ground up at a target ≥
    // POLICE_HIGH_GROUND_Y above the officer (crate/cart/hay/stage tops).
    const dyUp = Math.max(0, (target.y ?? 0) - (officer.y ?? 0))
    if (dyUp >= POLICE_HIGH_GROUND_Y) return false
    const reach = POLICE_STRIKE.range + Math.min(dyUp * 0.75, 2.2) + 0.6 // +0.6 latency grace (unchanged)
    if (dist2d(officer.x, officer.z, target.x, target.z) > reach ** 2) return false
    officer.lastStrikeAt = now
    // server-owned health — identical channel to the NPC melee (victim client plays
    // the full police hit feel: knockback, red vignette, stagger, thwack audio)
    this.damagePlayer(targetId, POLICE_STRIKE.dmg, 'police', now)
    // room-wide FX: swing anim + impact burst (cheap, event-driven, no polling)
    this.emitRoom('game:strike', issuerId, targetId, round2(target.x), round2(target.z))
    return true
  }

  /**
   * Detainee's client reports its inventory cards for confiscation (one shot per
   * detention). Server validates: player really is detained, not already
   * confiscated for this detention, type whitelist, cap at INVENTORY_MAX — then
   * scatters the cards as a ground-loot ring at the authoritative capture spot.
   */
  confiscateInventory(socketId: string, items: unknown): boolean {
    const p = this.players.get(socketId)
    if (!p || !p.detained) return false
    if (p.confiscatedFor !== p.detainUntil) return false // already done for this detention
    if (!Array.isArray(items)) return false
    const types: ItemType[] = []
    for (const t of items.slice(0, INVENTORY_MAX)) {
      const s = String(t)
      if (s === 'token' || !(s in ITEM_CONFIG)) continue
      if (!types.includes(s as ItemType)) types.push(s as ItemType)
    }
    if (types.length === 0) return false // nothing valid — do not burn the one-shot
    p.confiscatedFor = 0 // consumed — a second request for the same detention is rejected

    const drops: DroppedItemNetState[] = []
    const expiresAt = Date.now() + DROP_TTL_MS
    const step = (Math.PI * 2) / types.length
    for (let i = 0; i < types.length; i++) {
      const ang = i * step + Math.random() * 0.6
      const r = DROP_RING_RADIUS * (0.55 + Math.random() * 0.45)
      const pos = this.nudgeDrop(p.x + Math.cos(ang) * r, p.z + Math.sin(ang) * r, p.x, p.z)
      const id = `drop_${Date.now().toString(36)}_${Math.floor(Math.random() * 46656).toString(36)}${i}`
      const drop: DroppedItem = { id, type: types[i], x: pos.x, y: 0.1, z: pos.z, ownerId: p.id, expiresAt }
      this.droppedItems.set(id, drop)
      drops.push({ id, type: drop.type, x: drop.x, y: drop.y, z: drop.z, expiresAt })
    }
    this.emitRoom('game:dropped', drops)
    return true
  }

  /** Nudge a drop position out of world colliders; fall back to the capture spot. */
  private nudgeDrop(x: number, z: number, cx: number, cz: number): { x: number; z: number } {
    if (!releasePointBlocked(x, z, 0.25)) return { x, z }
    for (let attempt = 1; attempt <= 6; attempt++) {
      const ang = Math.random() * Math.PI * 2
      const nx = cx + Math.cos(ang) * (0.4 + attempt * 0.3)
      const nz = cz + Math.sin(ang) * (0.4 + attempt * 0.3)
      if (!releasePointBlocked(nx, nz, 0.25)) return { x: nx, z: nz }
    }
    return { x: cx, z: cz }
  }

  /** Per-player rate limit for player-initiated drops (game:dropItem). */
  private lastDropAt = new Map<string, number>()
  /** Max throw arc range — landed/dropped items beyond this are clamped to the ring edge. */
  private static DROP_MAX_DIST = 16

  /**
   * Player-initiated ground drop: a deliberately dropped inventory item (HUD
   * right-click) or a thrown item's landing spot. Same trust model as gifting —
   * client-reported coords — but validated here: known non-token type, dropper
   * not detained, per-player rate limit, and landing clamped to a ring around
   * the dropper. Registered in the SAME drop registry as confiscation loot, so
   * pickup (game:pickup), TTL expiry (game:dropGone) and match reset all work
   * with zero extra code. The game:dropped relay reaches the whole room
   * including the dropper — clients treat the relay as the single spawn source.
   */
  dropItem(socketId: string, type: unknown, x: unknown, z: unknown): boolean {
    const p = this.players.get(socketId)
    if (!p || p.detained) return false
    const t = String(type)
    if (t === 'token' || !(t in ITEM_CONFIG)) return false
    const now = Date.now()
    if (now - (this.lastDropAt.get(socketId) ?? 0) < 400) return false // drop/throw spam guard
    this.lastDropAt.set(socketId, now)
    let dx = Number(x)
    let dz = Number(z)
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) return false
    const ddx = dx - p.x
    const ddz = dz - p.z
    const dist = Math.hypot(ddx, ddz)
    if (dist > Room.DROP_MAX_DIST) {
      const s = Room.DROP_MAX_DIST / dist
      dx = p.x + ddx * s
      dz = p.z + ddz * s
    }
    const pos = this.nudgeDrop(dx, dz, p.x, p.z)
    const id = `drop_${now.toString(36)}_${Math.floor(Math.random() * 46656).toString(36)}d`
    const drop: DroppedItem = { id, type: t as ItemType, x: pos.x, y: 0.1, z: pos.z, ownerId: p.id, expiresAt: now + THROWN_DROP_TTL_MS }
    this.droppedItems.set(id, drop)
    this.emitRoom('game:dropped', [{ id: drop.id, type: drop.type, x: drop.x, y: drop.y, z: drop.z, expiresAt: drop.expiresAt }])
    return true
  }

  /**
   * Release to a random validated point (Phase 6): never the same point twice in a
   * row, ≥30 m from non-detained squadmates while alternatives remain, never inside
   * the boss arena. Detention duration semantics are unchanged.
   */
  private releasePlayer(p: PlayerState) {
    this.releasePlayerWith(p, (last, squad) => pickReleasePoint(last, squad))
  }

  /** v68 — killed by the deep-jungle undead: respawn at a random point from the
   *  wild pool (city posts + jungle-edge/deep clearings). Same contract as the
   *  detention release: anti-warp re-baseline, chase reset, 6 s grace window.
   *  Rate-limited to one respawn per 5 s per player. */
  handleWildDeath(playerId: string) {
    const p = this.players.get(playerId)
    if (!p) return
    const now = Date.now()
    if (now - (p.wildDeathAt ?? 0) < 5000) return
    p.wildDeathAt = now
    console.log(`[wild] ${p.name} was claimed by the Vanodyan Deep — respawning elsewhere`)
    this.releasePlayerWith(p, (last, squad) => pickReleasePoint(last, squad, WILD_RELEASE_POINTS))
  }

  /** Shared release tail: pick the destination, teleport (server-side too, so the
   *  anti-warp speed check accepts the next client state), drop every officer's
   *  stale chase, open the grace window, broadcast the shared game:release. */
  private releasePlayerWith(
    p: PlayerState,
    pick: (lastReleaseId: string | null, squad: ReadonlyArray<{ x: number; z: number }>) => ReleasePoint,
  ) {
    const squad = this.squadmatePositions
      ? this.squadmatePositions(p.id)
      : [...this.humans()].filter((h) => h.id !== p.id && !h.detained).map((h) => ({ x: h.x, z: h.z }))
    const dest = pick(p.lastReleaseId, squad)
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
    // v49 — fresh start: open the post-release grace window and drop EVERY officer's
    // stale chase on this player (the capturer already resets itself at capture time,
    // but other officers kept alert ≥ 1 through the whole detention and would
    // instantly re-acquire the respawn — the stale WANTED banner bug).
    p.releaseGraceUntil = Date.now() + RELEASE_GRACE_MS
    for (const n of this.npcs) {
      if (n.targetId === p.id) {
        n.state = 'return'; n.targetId = null; n.alert = 0; n.captureProgress = 0; n.attackTelegraphUntil = 0
      }
    }
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
        // v51 — y in the view: brains do elevation-aware strikes/captures (platform exploit fix)
        const view: NpcPlayerView = { id: p.id, x: p.x, y: p.y, z: p.z, detained: p.detained, dazed: p.dazed, hidden: grace || now < p.releaseGraceUntil, bot: p.bot, health: p.health, police: p.role === 'police' }
        views.push(view)
        if (!p.bot) bossViews.push(view)
      }
    }

    // 1. NPC brains
    for (const n of this.npcs) {
      const prevState = n.state
      const prevTarget = n.targetId
      const res = tickNpc(n, views, WORLD.colliders, dt, now)
      for (const ev of res.events) {
        if (ev.kind === 'capture') this.capturePlayer(ev.playerId, now)
        else if (ev.kind === 'hit') {
          // Phase 5 police melee — damagePlayer emits game:damage (kind 'police') + game:health,
          // and 0 hp → dazed. No extra event: clients react to game:damage.
          this.damagePlayer(ev.playerId, ev.amount ?? POLICE_ATTACK.fallbackDmg, 'police', now)
        }
      }
      // v86 — escape grace: a pursuit that ends WITHOUT a capture (soft-escape drop
      // in npc-brain, or the target went hidden) grants the quarry the same
      // anti-ambush window a released detainee gets. Capture/detention drops are
      // already covered by the detention flow (releasePlayerWith re-opens 6 s).
      if (prevState === 'chase' && prevTarget && res.npc.state === 'return' && !res.npc.targetId) {
        const tp = this.players.get(prevTarget)
        if (tp && !tp.detained && now >= tp.releaseGraceUntil) tp.releaseGraceUntil = now + ESCAPE_GRACE_MS
      }
    }
    // v51 — pack pursuit: an active chase is contagious to nearby officers
    // v86 — but never onto a graced (hidden) target: the pack-join used to bypass
    // the release/escape grace and ambush the player anyway.
    const hiddenIds = new Set<string>()
    for (const v of views) if (v.hidden) hiddenIds.add(v.id)
    propagateChase(this.npcs, DETECT.packChaseRadius, now, hiddenIds)

    // 1.5 v87 — SHARED WILD: authoritative zombies + street animals. One horde,
    // one set of animals per room — every client renders the same creatures at
    // the same places (the old client-local sims each rolled their own world).
    const speeds = new Map<string, number>()
    for (const v of views) {
      const last = this.lastTickPos.get(v.id)
      speeds.set(v.id, last ? Math.hypot(v.x - last.x, v.z - last.z) / dt : 0)
      this.lastTickPos.set(v.id, { x: v.x, z: v.z })
    }
    const zEvents: import('../../src/game/shared/zombie-sim').ZombieSimEvent[] = []
    const aEvents: AnimalSimEvent[] = []
    tickZombies(this.zombies, views, dt, now, zEvents, this.zPackGate)
    tickAnimals(this.animals, views, speeds, dt, now, aEvents)
    for (const ev of zEvents) {
      if (ev.kind === 'strike') {
        // server-owned health — identical channel to the NPC melee (victim client
        // plays the zombie hit feel from game:damage kind 'zombie')
        this.damagePlayer(ev.playerId, ev.amount, 'zombie', now)
        this.emitRoom('game:wildEvent', { t: 'zhit', pid: ev.playerId, i: ev.zombieId } satisfies WildEventNet)
      } else {
        this.emitRoom('game:wildEvent', { t: 'spot', pid: ev.playerId, i: ev.zombieId, x: Math.round(ev.x), z: Math.round(ev.z) } satisfies WildEventNet)
      }
    }
    for (const ev of aEvents) {
      if (ev.kind === 'fedStart') {
        this.emitRoom('game:wildEvent', { t: 'fedStart', pid: ev.playerId, i: ev.animalId, label: ev.label, animal: ev.animal } satisfies WildEventNet)
      } else if (ev.kind === 'fed') {
        this.emitRoom('game:wildEvent', { t: 'fed', pid: ev.playerId, i: ev.animalId, label: ev.label, animal: ev.animal, extended: ev.extended } satisfies WildEventNet)
      } else {
        this.emitRoom('game:wildEvent', { t: 'petOver', pid: ev.playerId, i: ev.animalId, label: ev.label } satisfies WildEventNet)
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

    // 9.5 Confiscated loot piles: expire after their TTL (game:dropGone)
    if (this.droppedItems.size > 0) {
      const gone: string[] = []
      for (const [id, drop] of this.droppedItems) {
        if (now >= drop.expiresAt) { this.droppedItems.delete(id); gone.push(id) }
      }
      if (gone.length) this.emitRoom('game:dropGone', gone)
    }

    // 10. NPC snapshots at 10 Hz (searchlights included) + the shared wild
    if (this.players.size > 0) {
      this.emitRoom('game:npcs', this.npcsArray())
      this.emitRoom('game:wild', this.wildPayload())
    }

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
    // v87 — a fresh match means a fresh wild: horde home, animals home, gate closed
    this.zombies = createZombieSimStates()
    this.animals = createAnimalSimStates()
    this.zPackGate.spotT = 0
    this.lastTickPos.clear()
    this.vehicleHitAt.clear()
    if (this.droppedItems.size > 0) {
      const gone = [...this.droppedItems.keys()]
      this.droppedItems.clear()
      this.emitRoom('game:dropGone', gone)
    }
    for (const p of this.players.values()) {
      if (p.detained) {
        p.detained = false
        p.detainUntil = 0
        p.releaseGraceUntil = Date.now() + RELEASE_GRACE_MS // v49 — reset path releases detainees too
      }
      p.confiscatedFor = 0
      p.tokens = 0
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
    this.emitRoom('game:wild', this.wildPayload()) // v87 — every client re-renders the fresh horde
    this.emitBoss()
  }

  // ---------- snapshots ----------

  playersArray(includeCosmetics = false): PlayerNetState[] {
    const out: PlayerNetState[] = []
    for (const p of this.players.values()) out.push(playerNet(p, includeCosmetics))
    return out
  }

  npcsArray(): NpcNetState[] {
    const out: NpcNetState[] = []
    const now = Date.now()
    for (const n of this.npcs) {
      const net: NpcNetState = { id: n.id, x: round2(n.x), z: round2(n.z), ry: round2(n.ry), state: n.state, alert: round2(n.alert) }
      // who this officer is chasing — clients need it so the WANTED alarm only fires
      // when YOU are the quarry (police players and bystanders no longer see it
      // because some officer across town is chasing a bot)
      if (n.state === 'chase' && n.targetId) net.target = n.targetId
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

  /** v87 — SHARED WILD snapshot: the horde + the street animals, quantized.
   *  Zombie/animal index IS the id (renderer builds the same visual per index). */
  wildPayload(): WildNetState {
    const z: ZombieNetState[] = []
    for (const zb of this.zombies) {
      z.push({
        i: zb.id,
        x: round2(zb.x), z: round2(zb.z), ry: round2(zb.ry),
        chase: zb.state === 'chase',
        moving: (zb as ZombieSimState & { moving?: boolean }).moving ?? false,
        lunge: zb.lunge > 0.35,
      })
    }
    const a: AnimalNetState[] = []
    for (const an of this.animals) {
      const net: AnimalNetState = {
        i: an.id,
        x: round2(an.x), z: round2(an.z), ry: round2(an.ry),
        st: an.state, sit: an.sit && an.state === 'idle',
      }
      if (an.crumb) net.crumb = { x: round2(an.crumb.x), z: round2(an.crumb.z) }
      if (an.followId) net.follow = an.followId
      a.push(net)
    }
    return { z, a }
  }

  /** v87 — validated feeding request from a client (game:animalFeed). The crumb,
   *  the eat timer and the follow are room truth; the feeder's client consumes
   *  its food only when the fedStart broadcast confirms. */
  feedAnimal(playerId: string, animalId: number): boolean {
    const p = this.players.get(playerId)
    if (!p || p.detained || p.dazed) return false
    const evs: AnimalSimEvent[] = []
    const ev = feedAnimalById(this.animals, animalId, playerId, p.x, p.z, Date.now(), evs)
    if (!ev || ev.kind !== 'fedStart') return false
    this.emitRoom('game:wildEvent', { t: 'fedStart', pid: ev.playerId, i: ev.animalId, label: ev.label, animal: ev.animal } satisfies WildEventNet)
    return true
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
export function playerNet(p: PlayerState, includeCosmetics = false): PlayerNetState {
  const net: PlayerNetState = {
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
  if (includeCosmetics) {
    if (p.cosmetics) net.cosmetics = p.cosmetics
    net.role = p.role
  }
  return net
}

// ---------- deterministic vehicles (mirrors client VehicleSystem polyline ping-pong) ----------

/** Polyline ping-pong — identical formula to client npcs.ts VehicleSystem.update (v37).
 *  Constant speed along the waypoint chain, bouncing at the ends; a 2-point path
 *  reduces exactly to the legacy shuttle math. */
function vehiclePosition(path: Array<[number, number]>, speed: number, worldTime: number): [number, number] {
  if (!path || path.length === 0) return [0, 0]
  if (path.length === 1) return [path[0][0], path[0][1]]
  const cum: number[] = [0]
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]))
  const total = cum[cum.length - 1]
  if (!(total > 0)) return [path[0][0], path[0][1]]
  const period = (total / speed) * 2
  const phase = ((worldTime % period) + period) % period
  const half = period / 2
  const s = (phase < half ? phase : period - phase) * speed // metres along the chain
  let i = 0
  while (i < path.length - 2 && s > cum[i + 1]) i++
  const segLen = cum[i + 1] - cum[i]
  const t = segLen > 0 ? Math.min(1, Math.max(0, (s - cum[i]) / segLen)) : 0
  return [path[i][0] + (path[i + 1][0] - path[i][0]) * t, path[i][1] + (path[i + 1][1] - path[i][1]) * t]
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
