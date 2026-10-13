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

export const ROOM_CAP = 20
export const PLAYER_CAP = 200
const BOUNDS_X = 47 // ±
const BOUNDS_Z_MIN = -570
const BOUNDS_Z_MAX = 9
const MAX_STATE_DIST = 25 // max meters between accepted state updates (else snap)
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

  addPlayer(socketId: string, name: string, archetype: string): PlayerState {
    const arch = archetypeById(archetype)
    const now = Date.now()
    const maxHealth = 100 + arch.stats.healthBonus
    const p: PlayerState = {
      id: socketId,
      name,
      archetype: arch.id,
      x: WORLD.spawn.x,
      y: 0,
      z: WORLD.spawn.z,
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
      lastX: WORLD.spawn.x,
      lastZ: WORLD.spawn.z,
      noiseTimes: [],
      emoteTimes: [],
      giftTimes: [],
      inviteTimes: [],
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
    const y = num(s.y, p.y)
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
  rateLimit(p: PlayerState, channel: 'noiseTimes' | 'emoteTimes' | 'giftTimes' | 'inviteTimes'): boolean {
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

  /** Release to the furthest activated checkpoint's detention point. */
  private releasePlayer(p: PlayerState) {
    let cpId = 0
    for (const c of this.checkpoints) cpId = Math.max(cpId, c)
    const cp = WORLD.checkpoints.find(c => c.id === cpId)
    const dest = cp?.detention ?? WORLD.spawn
    p.detained = false
    p.detainUntil = 0
    p.x = dest.x
    p.z = dest.z
    p.y = 0
    p.lastX = dest.x
    p.lastZ = dest.z
    p.lastStateTime = Date.now()
    p.anim = 'idle'
    this.emitRoom('game:release', p.id, p.x, p.z)
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
    for (const p of this.players.values()) {
      if (!p.detained && !p.dazed) {
        const grace = now - p.joinedAt < 10000 && dist2d(p.x, p.z, WORLD.spawn.x, WORLD.spawn.z) < 16
        views.push({ id: p.id, x: p.x, z: p.z, detained: p.detained, dazed: p.dazed, hidden: grace })
      }
    }

    // 1. NPC brains
    for (const n of this.npcs) {
      const res = tickNpc(n, views, WORLD.colliders, dt, now)
      for (const ev of res.events) {
        if (ev.kind === 'capture') this.capturePlayer(ev.playerId, now)
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

    // 5. Detention timers → release at furthest activated checkpoint
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

    // 7. Boss brain
    const bossEv = tickBoss(this.boss, views, dt, now)
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
    for (const p of this.players.values()) {
      out.push({
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
      } as PlayerNetState)
    }
    return out
  }

  npcsArray(): NpcNetState[] {
    const out: NpcNetState[] = []
    for (const n of this.npcs) {
      out.push({ id: n.id, x: round2(n.x), z: round2(n.z), ry: round2(n.ry), state: n.state, alert: round2(n.alert) })
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
    this.emitRoom('game:players', this.playersArray())
  }
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
