// VoteChor suspects — offline "training day" opposition for the POLICE role.
// Season/multiplayer has 99 server-simulated protester bots to arrest; offline has
// none (world.npcs are all officers). This module spawns a handful of wandering
// troublemakers near the spine so an offline officer still has someone to cuff.
// Deliberately simple: XZ wander + flee, collider-aware waypoints, no nav grid.
import * as THREE from 'three'
import { CharacterRig } from './character'
import { PLAYER_ROLE, POLICE_STRIKE, archetypeById } from './shared/constants'
import type { AABB, WorldDef } from './shared/types'

interface Suspect {
  id: string
  name: string
  rig: CharacterRig
  x: number
  z: number
  ry: number
  state: 'wander' | 'flee' | 'detained'
  wpX: number
  wpZ: number
  detainUntil: number
  respawnAt: number
  staggerUntil: number // baton-hit stumble window (dazed pose) — police-role F strike
  anchor: Anchor
}

const WANDER_SPEED = 2.1
const FLEE_SPEED = 5.4 // below sprint 7.8 — a sprinting officer always catches up
const FLEE_RADIUS = 8 // start sweating when the officer gets this close
const COLLIDER_PAD = 0.6

// Open-road anchors: main spine, plaza belly, market heart, avenue, colony cross.
// All sit on tarmac the world guarantees is collider-free.
interface Anchor { x: number; z: number; r: number }
const ANCHORS: Anchor[] = [
  { x: 0, z: -18, r: 8 },
  { x: 3, z: -52, r: 7 },
  { x: -2, z: -96, r: 8 },
  { x: 0, z: -140, r: 9 },
  { x: 4, z: -224, r: 8 },
  { x: -3, z: -300, r: 8 },
  { x: 0, z: -352, r: 8 },
  { x: 2, z: -452, r: 9 },
]

const SUSPECT_NAMES = [
  'Rowdy Ramesh', 'Placard Priya', 'Shouty Singh', 'MegaMouth Meena',
  'Banner Bhaskar', 'Chanting Chacha', 'Slogan Suraj', 'Marching Mala',
]

const SUSPECT_COLORS = [
  { shirt: '#b54a32', pants: '#3d3a30', skin: '#c68a5c', hair: '#191512', accent: '#f2c14e' },
  { shirt: '#2e6e4e', pants: '#2c3947', skin: '#a06a42', hair: '#241c14', accent: '#f5efdc' },
  { shirt: '#c9a86a', pants: '#4a453d', skin: '#8a5a3a', hair: '#191512', accent: '#8c1f28' },
]

function blocked(x: number, z: number, colliders: AABB[]): boolean {
  for (const c of colliders) {
    if (c.walkable) continue
    if (x > c.minX - COLLIDER_PAD && x < c.maxX + COLLIDER_PAD && z > c.minZ - COLLIDER_PAD && z < c.maxZ + COLLIDER_PAD) return true
  }
  return false
}

export class SuspectSystem {
  group = new THREE.Group()
  private suspects: Suspect[] = []
  private world: WorldDef
  private colliders: AABB[]
  private ids = 0

  constructor(world: WorldDef, colliders: AABB[]) {
    this.world = world
    this.colliders = colliders
    for (let i = 0; i < 6; i++) this.spawn()
  }

  private spawn(): void {
    const anchor = ANCHORS[this.ids % ANCHORS.length]
    const arch = archetypeById(['student', 'journalist', 'uncle', 'artist', 'worker', 'lawyer'][this.ids % 6] ?? 'student')
    const colors = { ...SUSPECT_COLORS[this.ids % SUSPECT_COLORS.length] }
    // training-day variety: mixed genders + hair styles (round 23 rig slots)
    const female = this.ids % 2 === 1
    const hair = female
      ? (['bun', 'ponytail', 'braid', 'long'] as const)[this.ids % 4]
      : (['default', 'buzz', 'curly', 'mullet', 'spiky', 'default'] as const)[this.ids % 6]
    const rig = new CharacterRig({ archetype: arch.id, name: '', colors, gender: female ? 'female' : 'male', hair })
    rig.setNameVisible(false)
    const id = `suspect_${this.ids++}`
    const name = SUSPECT_NAMES[(this.ids - 1) % SUSPECT_NAMES.length]
    const x = anchor.x + (Math.random() - 0.5) * anchor.r
    const z = anchor.z + (Math.random() - 0.5) * anchor.r
    rig.group.position.set(x, 0, z)
    this.group.add(rig.group)
    const s: Suspect = { id, name, rig, x, z, ry: Math.random() * Math.PI * 2, state: 'wander', wpX: x, wpZ: z, detainUntil: 0, respawnAt: 0, staggerUntil: 0, anchor }
    this.pickWaypoint(s)
    this.suspects.push(s)
  }

  private pickWaypoint(s: Suspect): void {
    for (let i = 0; i < 8; i++) {
      const wx = s.anchor.x + (Math.random() - 0.5) * s.anchor.r * 2
      const wz = s.anchor.z + (Math.random() - 0.5) * s.anchor.r * 2
      if (!blocked(wx, wz, this.colliders) && wx > this.world.bounds.minX && wx < this.world.bounds.maxX) {
        s.wpX = wx; s.wpZ = wz
        return
      }
    }
    s.wpX = s.anchor.x; s.wpZ = s.anchor.z
  }

  /** Nearest arrestable suspect within `maxDist` of the officer. */
  nearest(px: number, pz: number, maxDist = PLAYER_ROLE.arrestRange + 1.4): { id: string; name: string; dist: number } | null {
    let best: Suspect | null = null
    let bestD = maxDist
    for (const s of this.suspects) {
      if (s.state === 'detained') continue
      const d = Math.hypot(s.x - px, s.z - pz)
      if (d < bestD) { bestD = d; best = s }
    }
    return best ? { id: best.id, name: best.name, dist: bestD } : null
  }

  /** Cuff a suspect: dazed pose, respawn elsewhere after a short stint in custody. */
  arrest(id: string, now: number): string | null {
    const s = this.suspects.find(v => v.id === id)
    if (!s || s.state === 'detained') return null
    s.state = 'detained'
    s.detainUntil = now + 5200
    s.respawnAt = now + 20000 + Math.random() * 9000
    return s.name
  }

  /**
   * Baton hit (police-role F strike, offline training day): shove the suspect away
   * from the officer (collider-checked), set a flee waypoint and a short stumble.
   * Returns name + post-shove position so the caller can pop FX right at the target.
   */
  hit(id: string, fromX: number, fromZ: number, now: number): { name: string; x: number; z: number } | null {
    const s = this.suspects.find(v => v.id === id)
    if (!s || s.state === 'detained' || now < s.staggerUntil) return null
    const dx = s.x - fromX, dz = s.z - fromZ
    const d = Math.hypot(dx, dz) || 1
    const kx = s.x + (dx / d) * POLICE_STRIKE.knockback
    const kz = s.z + (dz / d) * POLICE_STRIKE.knockback
    if (!blocked(kx, kz, this.colliders)) {
      s.x = kx
      s.z = kz
      s.rig.group.position.set(s.x, 0, s.z)
    }
    s.state = 'flee'
    s.wpX = s.x + (dx / d) * 9
    s.wpZ = s.z + (dz / d) * 9
    s.staggerUntil = now + POLICE_STRIKE.staggerMs
    return { name: s.name, x: s.x, z: s.z }
  }

  update(dt: number, px: number, pz: number, now: number): void {
    for (const s of this.suspects) {
      if (s.state === 'detained') {
        s.rig.update(dt, 'dazed', 0)
        if (now >= s.respawnAt) {
          // fresh troublemaker walks in at a (possibly different) anchor
          const anchor = ANCHORS[Math.floor(Math.random() * ANCHORS.length)]
          const x = anchor.x + (Math.random() - 0.5) * anchor.r
          const z = anchor.z + (Math.random() - 0.5) * anchor.r
          if (!blocked(x, z, this.colliders)) { s.x = x; s.z = z; s.anchor = anchor }
          s.state = 'wander'
          this.pickWaypoint(s)
          s.rig.group.position.set(s.x, 0, s.z)
          s.rig.group.visible = true
        }
        continue
      }
      // held pose right after being cuffed
      if (now < s.detainUntil) { s.rig.update(dt, 'dazed', 0); continue }
      // baton-strike stumble: brief dazed pose, then the flee waypoint takes over
      if (now < s.staggerUntil) { s.rig.update(dt, 'dazed', 0); continue }

      const dp = Math.hypot(s.x - px, s.z - pz)
      let speed = WANDER_SPEED
      let anim: 'walk' | 'run' | 'idle' = 'walk'
      if (dp < FLEE_RADIUS) {
        // flee directly away from the officer
        const ux = (s.x - px) / Math.max(0.001, dp)
        const uz = (s.z - pz) / Math.max(0.001, dp)
        s.wpX = s.x + ux * 6
        s.wpZ = s.z + uz * 6
        s.state = 'flee'
        speed = FLEE_SPEED
        anim = 'run'
      } else if (s.state === 'flee') {
        s.state = 'wander'
        this.pickWaypoint(s)
      }

      const dx = s.wpX - s.x, dz = s.wpZ - s.z
      const dw = Math.hypot(dx, dz)
      if (dw < 0.6) {
        if (s.state === 'wander') {
          if (Math.random() < dt * 0.5) this.pickWaypoint(s)
          s.rig.update(dt, 'idle', 0)
        }
      } else {
        const nx = s.x + (dx / dw) * speed * dt
        const nz = s.z + (dz / dw) * speed * dt
        if (!blocked(nx, nz, this.colliders)) { s.x = nx; s.z = nz }
        else this.pickWaypoint(s)
        const targetRy = Math.atan2(dx, dz)
        let d = targetRy - s.ry
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        s.ry += d * Math.min(1, dt * 8)
        s.rig.update(dt, anim, speed)
      }
      s.rig.group.position.set(s.x, 0, s.z)
      s.rig.group.rotation.y = s.ry
    }
  }

  /** Info for the minimap/compass — blue dots = potential arrests. */
  positions(): Array<{ id: string; x: number; z: number; detained: boolean }> {
    return this.suspects.map(s => ({ id: s.id, x: s.x, z: s.z, detained: s.state === 'detained' }))
  }

  /** Free every suspect rig when the training-day system is torn down. */
  dispose(): void {
    for (const s of this.suspects) s.rig.dispose()
    this.suspects.length = 0
  }
}
