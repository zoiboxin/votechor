// VoteChor v68 — the Vanodyan Dead: shambling undead that haunt the deep jungle.
// v87 — SHARED WILD: online matches RENDER the server's authoritative horde
// (src/game/shared/zombie-sim.ts ticks one room-wide simulation, so every player
// sees the same undead at the same places). Truly-offline matches keep running
// this local state machine exactly as before. All visuals/animation/audio stay
// here either way.
import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { AudioManager } from './audio'
import { mountainHeightAt } from './mountain-field'
import type { FxSystem } from './fx'
import {
  ZOMBIE_SPOTS,
  citySafe,
  ZOMBIE_DETECT_R as DETECT_R,
  ZOMBIE_LOSE_R as LOSE_R,
  ZOMBIE_STRIKE_R as STRIKE_R,
  ZOMBIE_STRIKE_DMG as STRIKE_DMG,
} from './shared/zombie-sim'
import type { ZombieNetState } from './shared/types'

type ZombieState = 'lurch' | 'chase'

interface Zombie {
  group: THREE.Group
  bodyRoot: THREE.Group
  armL: THREE.Group
  armR: THREE.Group
  legL: THREE.Object3D
  legR: THREE.Object3D
  head: THREE.Group
  home: { x: number; z: number }
  target: { x: number; z: number }
  state: ZombieState
  ry: number
  speed: number // chase speed 4.9..5.6 — walking (6.0) escapes, sprinting laughs
  phase: number
  moveAmt: number
  stateT: number
  strikeT: number
  moanT: number
  loseT: number // >0 while the player is out of sight but not yet forgotten
  lunge: number // arm-swing driver on strike
  // v87 — net rendering: smooth-follow target + last known chase/moving flags
  nx: number; nz: number; nry: number // rendered (smoothed) position
  tx: number; tz: number; try_: number // latest server target
  nchase: boolean
  nmoving: boolean
}

// ---- shared material cache (module level — no per-instance allocation) ----
const matCache = new Map<string, THREE.MeshStandardMaterial>()
function mat(color: string, emissive?: string, ei = 1): THREE.MeshStandardMaterial {
  const key = color + (emissive ?? '') + ei
  let m = matCache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 })
    if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = ei }
    matCache.set(key, m)
  }
  return m
}

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

function merged(parts: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh {
  const norm = parts.map(p => {
    const q = p.index ? p : mergeVertices(p, 1e-4) ?? p
    if (q.attributes.uv) q.deleteAttribute('uv')
    if (q.attributes.uv1) q.deleteAttribute('uv1')
    return q
  })
  const geo = mergeGeometries(norm, false)
  const mesh = new THREE.Mesh(geo ?? parts[0], material)
  if (geo) for (const p of norm) p.dispose()
  return mesh
}

const SKIN = ['#7d9459', '#6f8a52', '#87986a'] // sickly jungle-rot greens
const RAGS = ['#3c3a34', '#463f33', '#33392f'] // torn kurta rags

/** One undead: hunched rag figure, arms thrust forward, ember eyes. ~1.75m tall. */
function buildZombie(variant: number): {
  group: THREE.Group; bodyRoot: THREE.Group; armL: THREE.Group; armR: THREE.Group
  legL: THREE.Object3D; legR: THREE.Object3D; head: THREE.Group
} {
  const skin = mat(SKIN[variant % SKIN.length])
  const rag = mat(RAGS[variant % RAGS.length])
  const dark = mat('#1c2016')
  const eye = mat('#d6ff5e', '#a4f43c', 1.7)
  const group = new THREE.Group()
  const bodyRoot = new THREE.Group()
  bodyRoot.rotation.x = 0.24 // permanent hungry hunch
  group.add(bodyRoot)
  // torso + ragged shoulders
  bodyRoot.add(merged([
    box(0.4, 0.52, 0.24, 0, 1.02, 0),
    box(0.46, 0.14, 0.28, 0, 1.24, 0),
    box(0.3, 0.18, 0.2, 0, 0.78, 0.1), // gut
  ], rag))
  // spine wound / rot patch
  const wound = new THREE.Mesh(box(0.12, 0.14, 0.03, 0.06, 1.05, -0.13), dark)
  bodyRoot.add(wound)
  // head — tilted, hollow sockets, ember eyes (visible in the dark canopy)
  const head = new THREE.Group()
  head.position.set(0, 1.38, 0.06)
  head.rotation.x = -0.3 // craned up out of the hunch
  head.add(merged([
    box(0.24, 0.26, 0.24, 0, 0.1, 0.02),
    box(0.16, 0.1, 0.12, 0, 0.0, 0.15), // jaw
  ], skin))
  head.add(merged([
    box(0.05, 0.055, 0.02, 0.062, 0.13, 0.135),
    box(0.05, 0.055, 0.02, -0.062, 0.13, 0.135),
  ], eye))
  bodyRoot.add(head)
  // arms — thrust forward, claw hands; pivots at the shoulders
  const mkArm = (side: 1 | -1) => {
    const pivot = new THREE.Group()
    pivot.position.set(0.27 * side, 1.2, 0.04)
    pivot.rotation.x = -1.25 // reaching
    const arm = merged([
      box(0.09, 0.42, 0.09, 0, -0.21, 0),
      box(0.1, 0.16, 0.1, 0, -0.48, 0.02), // hand
    ], skin)
    pivot.add(arm)
    return pivot
  }
  const armL = mkArm(-1), armR = mkArm(1)
  bodyRoot.add(armL, armR)
  // legs — pivots at the hips
  const mkLeg = (side: 1 | -1) => {
    const pivot = new THREE.Group()
    pivot.position.set(0.11 * side, 0.78, 0)
    const leg = merged([box(0.12, 0.78, 0.13, 0, -0.39, 0)], rag)
    pivot.add(leg)
    return pivot
  }
  const legL = mkLeg(-1), legR = mkLeg(1)
  bodyRoot.add(legL, legR)
  return { group, bodyRoot, armL, armR, legL, legR, head }
}

/** v87 — the spawn pockets, sanctuary line and tuning constants now live in
 *  src/game/shared/zombie-sim.ts (one source of truth for the server sim AND
 *  this renderer/local-offline machine). */

export interface ZombieCallbacks {
  onStrike: (amount: number) => void
  onSpot: () => void
}

export class ZombieSystem {
  group = new THREE.Group()
  private zombies: Zombie[] = []
  private cb: ZombieCallbacks
  // v81 — pack gate: a pocket aggroing together fires ONE onSpot scare wave per
  // window instead of one per zombie (the spatial moan still plays per detector).
  private spotT = 0
  // v87 — SHARED WILD: when true, update() only renders server snapshots
  private netMode = false

  constructor(fx: FxSystem, cb: ZombieCallbacks) {
    this.cb = cb
    for (let i = 0; i < ZOMBIE_SPOTS.length; i++) {
      const [hx, hz] = ZOMBIE_SPOTS[i]
      const fig = buildZombie(i)
      fig.group.position.set(hx, mountainHeightAt(hx, hz), hz) // v77: ride the mountain terrain
      this.group.add(fig.group)
      this.zombies.push({
        group: fig.group, bodyRoot: fig.bodyRoot, armL: fig.armL, armR: fig.armR,
        legL: fig.legL, legR: fig.legR, head: fig.head,
        home: { x: hx, z: hz }, target: { x: hx, z: hz },
        state: 'lurch', ry: Math.random() * 6.28,
        speed: 4.9 + Math.random() * 0.7,
        phase: Math.random() * 6.28, moveAmt: 0, stateT: Math.random() * 4,
        strikeT: 0, moanT: 4 + Math.random() * 10, loseT: 0, lunge: 0,
        nx: hx, nz: hz, nry: 0, tx: hx, tz: hz, try_: 0, nchase: false, nmoving: false,
      })
    }
  }

  /** Distance from (x,z) to the nearest zombie — respawn-point filter + QA. */
  minDist(x: number, z: number): number {
    let best = Infinity
    for (const z0 of this.zombies) best = Math.min(best, Math.hypot(z0.group.position.x - x, z0.group.position.z - z))
    return best
  }

  get count(): number { return this.zombies.length }
  get chasing(): number { return this.zombies.reduce((n, z0) => n + (z0.state === 'chase' ? 1 : 0), 0) }

  /** After a wild death (or a fresh match) the whole horde forgets the player —
   *  states, targets, and the v81 pack-gate timer all reset together.
   *  v87 — no-op in net mode: the server owns the horde's state. */
  resetAggro() {
    if (this.netMode) return
    this.spotT = 0
    for (const z0 of this.zombies) {
      z0.state = 'lurch'
      z0.loseT = 0
      z0.strikeT = 0
      z0.target = { ...z0.home }
    }
  }

  // ---------- v87 — SHARED WILD: server snapshot rendering ----------

  /** Enter server-authoritative mode: snapshots drive every position/state. */
  enterNetMode() {
    if (this.netMode) return
    this.netMode = true
    for (const z0 of this.zombies) {
      z0.nx = z0.group.position.x
      z0.nz = z0.group.position.z
      z0.nry = z0.ry
      z0.tx = z0.nx
      z0.tz = z0.nz
      z0.try_ = z0.nry
      z0.nchase = false
      z0.nmoving = false
      z0.state = 'lurch'
    }
  }

  /** Back to the local sim (offline fallback / fresh solo-offline match). */
  exitNetMode() {
    this.netMode = false
  }

  /** Apply one `game:wild` snapshot (10 Hz). Smooth-follow targets per zombie. */
  applyServerState(list: ZombieNetState[]) {
    for (const s of list) {
      const z0 = this.zombies[s.i]
      if (!z0) continue
      z0.tx = s.x
      z0.tz = s.z
      z0.try_ = s.ry
      z0.nchase = s.chase
      z0.nmoving = s.moving
      z0.state = s.chase ? 'chase' : 'lurch'
      // a server wind-up/lunge lands — swing the arm even between snapshots
      if (s.lunge && z0.lunge < 0.2) z0.lunge = 1
    }
  }

  update(dt: number, worldTime: number, playerPos: { x: number; y: number; z: number }, listenerYaw: number) {
    if (this.netMode) {
      this.updateNet(dt, worldTime, playerPos, listenerYaw)
      return
    }
    this.updateLocal(dt, worldTime, playerPos, listenerYaw)
  }

  /** v87 — net rendering: smooth-follow the server targets, animate from the
   *  chase/moving flags, keep the spatial moans + head scan (all client-local). */
  private updateNet(dt: number, worldTime: number, playerPos: { x: number; y: number; z: number }, listenerYaw: number) {
    for (const zb of this.zombies) {
      const k = Math.min(1, dt * 11) // ~90 ms lag — smooths the 10 Hz steps fully
      let dr = zb.try_ - zb.nry
      while (dr > Math.PI) dr -= 6.2832
      while (dr < -Math.PI) dr += 6.2832
      zb.nry += dr * k
      const prevDx = zb.tx - zb.nx, prevDz = zb.tz - zb.nz
      zb.nx += prevDx * k
      zb.nz += prevDz * k
      zb.group.position.set(zb.nx, mountainHeightAt(zb.nx, zb.nz), zb.nz)
      zb.group.rotation.y = zb.nry
      zb.ry = zb.nry
      zb.state = zb.nchase ? 'chase' : 'lurch'
      // lunge decay (swing driver set by snapshots)
      zb.lunge = Math.max(0, zb.lunge - dt * 2.6)
      // animation driven by the server's moving/chase truth
      zb.moveAmt += ((zb.nmoving ? 1 : 0) - zb.moveAmt) * Math.min(1, dt * 5)
      zb.phase += dt * (2.4 + zb.moveAmt * 3.4)
      const swing = Math.sin(zb.phase) * 0.5 * zb.moveAmt
      zb.legL.rotation.x = swing
      zb.legR.rotation.x = -swing
      const lungeR = zb.lunge * 0.9
      zb.armR.rotation.x = -1.25 + Math.sin(zb.phase * 0.9) * 0.12 * zb.moveAmt - lungeR
      zb.armL.rotation.x = -1.25 + Math.sin(zb.phase * 0.9 + 1.2) * 0.12 * zb.moveAmt
      zb.bodyRoot.rotation.z = Math.sin(zb.phase * 0.5) * 0.09 * (0.4 + zb.moveAmt)
      zb.bodyRoot.position.y = Math.abs(Math.sin(zb.phase)) * 0.05 * zb.moveAmt
      zb.head.rotation.y = Math.sin(worldTime * 0.7 + zb.phase) * 0.3
      // voices stay client-local (distance-attenuated per listener)
      zb.moanT -= dt
      if (zb.moanT <= 0) {
        zb.moanT = zb.state === 'chase' ? 2.6 + Math.random() * 1.6 : 9 + Math.random() * 7
        AudioManager.playAt('zombieMoan', zb.nx, zb.nz, playerPos.x, playerPos.z, listenerYaw, zb.state === 'chase' ? 52 : 34, zb.state === 'chase' ? 1 : 0.7)
      }
    }
  }

  /** Pre-v87 local simulation — the OFFLINE fallback (also the exact machine the
   *  server now runs room-wide in shared/zombie-sim.ts). */
  private updateLocal(dt: number, worldTime: number, playerPos: { x: number; y: number; z: number }, listenerYaw: number) {
    this.spotT -= dt
    for (const zb of this.zombies) {
      const px = zb.group.position.x, pz = zb.group.position.z
      const dx = playerPos.x - px, dz = playerPos.z - pz
      const dist = Math.hypot(dx, dz)

      // ---- state machine ----
      if (zb.state === 'lurch') {
        if (dist < DETECT_R) {
          zb.state = 'chase'
          zb.loseT = 0
          zb.strikeT = 0.4 // first swipe comes fast — the scare is the point
          // v81 — pack gate: only the first detector of a wave raises the scare
          // (sting + shake + toast); stragglers in the same window stay silent.
          if (this.spotT <= 0) {
            this.spotT = 5
            this.cb.onSpot()
          }
          AudioManager.playAt('zombieMoan', px, pz, playerPos.x, playerPos.z, listenerYaw, 48, 1.1)
        }
      } else if (dist > LOSE_R) {
        zb.loseT += dt
        if (zb.loseT > 4) { zb.state = 'lurch'; zb.target = { ...zb.home } }
      } else {
        zb.loseT = 0
      }

      // ---- movement ----
      let moving = false
      if (zb.state === 'chase' && dist > 0.05) {
        const sp = dist < STRIKE_R + 0.4 ? zb.speed * 0.25 : zb.speed
        const inv = 1 / Math.max(dist, 0.001)
        // v70 — sanctuary block: step toward the player, slide along the city
        // line when the straight step would cross it, freeze if fully blocked.
        let mx = dx * inv * sp * dt, mz = dz * inv * sp * dt
        if (citySafe(px + mx, pz + mz)) {
          if (!citySafe(px + mx, pz)) { mz = 0 }
          else if (!citySafe(px, pz + mz)) { mx = 0 }
          else { mx = 0; mz = 0 }
        }
        if (mx !== 0 || mz !== 0) {
          zb.group.position.x += mx
          zb.group.position.z += mz
          zb.group.position.y = mountainHeightAt(zb.group.position.x, zb.group.position.z) // v77: ride terrain
          zb.ry = Math.atan2(dx, dz)
          moving = true
        }
        // the player reached safety — the hunt is over, walk home
        if (citySafe(playerPos.x, playerPos.z)) {
          zb.state = 'lurch'
          zb.target = { ...zb.home }
          zb.loseT = 0
          zb.strikeT = 0
        }
      } else if (zb.state === 'lurch') {
        zb.stateT -= dt
        const tdx = zb.target.x - px, tdz = zb.target.z - pz
        const tdist = Math.hypot(tdx, tdz)
        if (zb.stateT <= 0) {
          zb.stateT = 2.5 + Math.random() * 4
          if (tdist < 0.8) {
            // pick a new wander target around home (v70 — never across the city line)
            const ang = Math.random() * 6.28, r = 2 + Math.random() * 6
            const tx = zb.home.x + Math.cos(ang) * r, tz = zb.home.z + Math.sin(ang) * r
            zb.target = citySafe(tx, tz) ? { ...zb.home } : { x: tx, z: tz }
          }
        }
        if (tdist > 0.6) {
          const sp = 0.75
          const inv = 1 / tdist
          // v70 — sanctuary block for wanderers too
          let mx = tdx * inv * sp * dt, mz = tdz * inv * sp * dt
          if (citySafe(px + mx, pz + mz)) {
            if (!citySafe(px + mx, pz)) { mz = 0 }
            else if (!citySafe(px, pz + mz)) { mx = 0 }
            else { mx = 0; mz = 0 }
          }
          if (mx !== 0 || mz !== 0) {
            zb.group.position.x += mx
            zb.group.position.z += mz
            const want = Math.atan2(tdx, tdz)
            // turn toward the target smoothly
            let d = want - zb.ry
            while (d > Math.PI) d -= 6.2832
            while (d < -Math.PI) d += 6.2832
            zb.ry += d * Math.min(1, dt * 2.2)
            moving = true
          }
        }
      }
      zb.group.rotation.y = zb.ry

      // ---- strike (chase, in reach, cooldown elapsed) ----
      zb.strikeT -= dt
      if (zb.state === 'chase' && dist < STRIKE_R && zb.strikeT <= 0) {
        zb.strikeT = 1.15
        zb.lunge = 1
        this.cb.onStrike(STRIKE_DMG)
      }

      // ---- animation ----
      zb.moveAmt += ((moving ? 1 : 0) - zb.moveAmt) * Math.min(1, dt * 5)
      zb.phase += dt * (2.4 + zb.moveAmt * 3.4)
      const swing = Math.sin(zb.phase) * 0.5 * zb.moveAmt
      zb.legL.rotation.x = swing
      zb.legR.rotation.x = -swing
      // arms reach and sway; the lunge throws the near arm forward
      zb.lunge = Math.max(0, zb.lunge - dt * 2.6)
      const lungeR = zb.lunge * 0.9
      zb.armR.rotation.x = -1.25 + Math.sin(zb.phase * 0.9) * 0.12 * zb.moveAmt - lungeR
      zb.armL.rotation.x = -1.25 + Math.sin(zb.phase * 0.9 + 1.2) * 0.12 * zb.moveAmt
      zb.bodyRoot.rotation.z = Math.sin(zb.phase * 0.5) * 0.09 * (0.4 + zb.moveAmt) // drunk sway
      zb.bodyRoot.position.y = Math.abs(Math.sin(zb.phase)) * 0.05 * zb.moveAmt
      zb.head.rotation.y = Math.sin(worldTime * 0.7 + zb.phase) * 0.3 // scanning for flesh

      // ---- voices ----
      zb.moanT -= dt
      if (zb.moanT <= 0) {
        zb.moanT = zb.state === 'chase' ? 2.6 + Math.random() * 1.6 : 9 + Math.random() * 7
        AudioManager.playAt('zombieMoan', zb.group.position.x, zb.group.position.z, playerPos.x, playerPos.z, listenerYaw, zb.state === 'chase' ? 52 : 34, zb.state === 'chase' ? 1 : 0.7)
      }
    }
  }

  dispose() {
    for (const zb of this.zombies) {
      zb.group.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh) m.geometry.dispose()
      })
    }
    this.zombies = []
    this.group.clear()
  }
}
