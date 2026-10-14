// VoteChor NPC AI brain — pure deterministic FSM logic (no three.js/DOM).
// Ticked server-side at NPC_TICK_HZ; clients interpolate rendered transforms.
import { DETECT } from './constants'
import type { AABB, NpcStateName, NpcType } from './types'

export interface NpcBrainState {
  id: string
  type: NpcType
  x: number
  z: number
  ry: number
  state: NpcStateName
  alert: number // 0..1
  waypoint: number
  patrol: { x: number; z: number }[]
  targetId: string | null
  targetTimer: number      // time spent chasing current target
  cooldownUntil: number    // ignore this target until t
  cooldownTarget: string | null
  investigate: { x: number; z: number } | null
  investigateTimer: number
  captureProgress: number
  speedMul: number
}

export interface NpcPlayerView {
  id: string
  x: number
  z: number
  detained: boolean
  dazed: boolean
  hidden?: boolean // inside a hide spot
  bot?: boolean // season bots — police deprioritize them so humans stay the main quarry
}

export interface NpcEvent {
  kind: 'capture'
  npcId: string
  playerId: string
}

export function createNpcStates(spawns: { id: string; type: NpcType; x: number; z: number; patrol: Array<[number, number]> | { x: number; z: number }[] }[]): NpcBrainState[] {
  return spawns.map(s => ({
    id: s.id, type: s.type, x: s.x, z: s.z, ry: 0, state: 'patrol' as NpcStateName,
    alert: 0, waypoint: 0, patrol: s.patrol.map((p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : { ...p })), targetId: null, targetTimer: 0,
    cooldownUntil: 0, cooldownTarget: null, investigate: null, investigateTimer: 0,
    captureProgress: 0, speedMul: 1,
  }))
}

// Segment vs AABB (2D XZ + height check ignored: colliders below eye don't block) — slab method
export function segmentBlocked(x1: number, z1: number, x2: number, z2: number, colliders: AABB[]): boolean {
  const dx = x2 - x1, dz = z2 - z1
  for (const c of colliders) {
    if (c.walkable && c.minY > 1.4) continue // high platforms don't block vision at ground level
    if (c.maxY < 1.6) continue // low barriers don't block sight
    let tmin = 0, tmax = 1
    let hit = true
    for (let axis = 0; axis < 2; axis++) {
      const a = axis === 0 ? x1 : z1
      const b = axis === 0 ? x2 : z2
      const lo = axis === 0 ? c.minX : c.minZ
      const hi = axis === 0 ? c.maxX : c.maxZ
      const d = axis === 0 ? dx : dz
      if (Math.abs(d) < 1e-8) {
        if (a < lo || a > hi) { hit = false; break }
      } else {
        let t1 = (lo - a) / d, t2 = (hi - a) / d
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2)
        if (tmin > tmax) { hit = false; break }
      }
    }
    if (hit) return true
  }
  return false
}

const dist2 = (ax: number, az: number, bx: number, bz: number) => (ax - bx) ** 2 + (az - bz) ** 2

export interface NpcTickResult {
  npc: NpcBrainState
  events: NpcEvent[]
  moved: boolean
}

/** Tick one NPC. Returns events (captures) for the server to act on. */
export function tickNpc(
  n: NpcBrainState,
  players: NpcPlayerView[],
  colliders: AABB[],
  dt: number,
  now: number,
  searchlightRy?: number, // for searchlight type
  distractionMul = 1,
): NpcTickResult {
  const events: NpcEvent[] = []
  let moved = false
  const speed = (n.type === 'security' ? 5.8 : n.type === 'guard' ? 6.4 : 6.6) * n.speedMul

  if (n.type === 'searchlight') {
    // Immobile rotating sensor handled by ry update on caller; detection adds alert on players
    return { npc: n, events, moved: false }
  }

  // Find best visible player
  let best: NpcPlayerView | null = null
  let bestScore = -1
  for (const p of players) {
    if (p.detained || p.dazed) continue
    if (n.cooldownTarget === p.id && now < n.cooldownUntil) continue
    const d = Math.sqrt(dist2(n.x, n.z, p.x, p.z))
    const viewDist = DETECT.viewDist
    if (d > viewDist) continue
    // FOV cone check
    if (d > 2.2) {
      const ang = Math.atan2(p.x - n.x, p.z - n.z)
      let diff = Math.abs(((ang - n.ry + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
      if (diff > (DETECT.fovDeg * Math.PI) / 360) continue
    }
    if (segmentBlocked(n.x, n.z, p.x, p.z, colliders)) continue
    if (p.hidden && d > 3) continue
    // Bots are scored as if ~2.2× farther away: police prefer real protesters,
    // but a lone bot right under their nose still gets chased (season worlds stay alive).
    const score = 1 / Math.max(1, d * (p.bot ? 2.2 : 1))
    if (score > bestScore) { bestScore = score; best = p }
  }

  switch (n.state) {
    case 'patrol': {
      if (best) {
        n.alert += dt * DETECT.alertRise
        n.state = n.alert >= 1 ? 'chase' : 'suspicious'
        if (n.alert >= 1) { n.targetId = best.id; n.state = 'chase' }
      } else {
        n.alert = Math.max(0, n.alert - dt * DETECT.alertDecay)
      }
      // waypoint patrol
      const wp = n.patrol[n.waypoint]
      const dx = wp.x - n.x, dz = wp.z - n.z
      const d = Math.hypot(dx, dz)
      if (d < 0.8) { n.waypoint = (n.waypoint + 1) % n.patrol.length }
      else {
        const step = Math.min(d, 3.1 * dt)
        n.x += (dx / d) * step; n.z += (dz / d) * step
        n.ry = Math.atan2(dx, dz)
        moved = true
      }
      break
    }
    case 'suspicious': {
      if (best) {
        n.alert += dt * DETECT.alertRise
        if (n.alert >= 1) { n.targetId = best.id; n.state = 'chase' }
      } else {
        n.alert = Math.max(0, n.alert - dt * DETECT.alertDecay * 1.4)
        if (n.alert <= 0) n.state = 'patrol'
      }
      // look around
      n.ry += dt * 1.6
      break
    }
    case 'investigate': {
      if (n.investigate) {
        const dx = n.investigate.x - n.x, dz = n.investigate.z - n.z
        const d = Math.hypot(dx, dz)
        if (d < 1.2) {
          n.investigateTimer -= dt
          n.ry += dt * 2.4
          if (n.investigateTimer <= 0) { n.investigate = null; n.state = 'patrol' }
        } else {
          const step = Math.min(d, 4.6 * dt)
          n.x += (dx / d) * step; n.z += (dz / d) * step
          n.ry = Math.atan2(dx, dz)
          moved = true
        }
      } else n.state = 'patrol'
      if (best) { n.alert += dt * DETECT.alertRise * 1.3; if (n.alert >= 1) { n.targetId = best.id; n.state = 'chase' } }
      break
    }
    case 'chase': {
      const target = players.find(p => p.id === n.targetId)
      if (!target || target.detained) { n.state = 'return'; n.targetId = null; break }
      n.targetTimer += dt
      const dx = target.x - n.x, dz = target.z - n.z
      const d = Math.hypot(dx, dz)
      n.ry = Math.atan2(dx, dz)
      if (d > 0.4) {
        const step = Math.min(d, speed * dt)
        n.x += (dx / d) * step; n.z += (dz / d) * step
        moved = true
      }
      if (d < DETECT.captureRadius) {
        n.captureProgress += dt
        if (n.captureProgress >= DETECT.captureTime) {
          events.push({ kind: 'capture', npcId: n.id, playerId: target.id })
          n.captureProgress = 0
          n.cooldownTarget = target.id
          n.cooldownUntil = now + DETECT.sameTargetCooldown * 1000
          n.state = 'return'
          n.targetId = null
          n.alert = 0
        }
      } else {
        n.captureProgress = Math.max(0, n.captureProgress - dt * 2)
      }
      if (n.targetTimer > DETECT.forgetAfter * 3 && d > DETECT.viewDist * 1.4) {
        n.state = 'return'; n.targetId = null; n.targetTimer = 0
      }
      break
    }
    case 'return': {
      const wp = n.patrol[n.waypoint]
      const dx = wp.x - n.x, dz = wp.z - n.z
      const d = Math.hypot(dx, dz)
      if (d < 1) { n.state = 'patrol'; n.alert = 0 }
      else {
        const step = Math.min(d, 3.8 * dt)
        n.x += (dx / d) * step; n.z += (dz / d) * step
        n.ry = Math.atan2(dx, dz)
        moved = true
      }
      if (best && n.alert > 0.9) { n.targetId = best.id; n.state = 'chase'; n.targetTimer = 0 }
      else if (best) n.alert = Math.min(1, n.alert + dt * DETECT.alertRise * 0.5)
      break
    }
  }
  // clamp to world bounds
  n.x = Math.max(-47, Math.min(47, n.x))
  n.z = Math.max(-570, Math.min(9, n.z))
  return { npc: n, events, moved }
}

/** Apply a noise/distraction event (bottle impact). */
export function applyNoise(npcs: NpcBrainState[], x: number, z: number, duration: number) {
  for (const n of npcs) {
    if (n.type === 'searchlight') continue
    if (n.state === 'chase' || n.state === 'capture') continue
    const d = Math.hypot(n.x - x, n.z - z)
    if (d < DETECT.noiseRadius) {
      n.state = 'investigate'
      n.investigate = { x: x + (Math.random() - 0.5) * 3, z: z + (Math.random() - 0.5) * 3 }
      n.investigateTimer = duration
      n.alert = Math.max(n.alert, 0.5)
    }
  }
}
