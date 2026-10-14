// VoteChor NPC system (client) — renders server NPC states with interpolation.
// Falls back to local simulation when offline (solo mode without server).
import * as THREE from 'three'
import { CharacterRig } from './character'
import { createNpcStates, tickNpc, applyNoise, type NpcBrainState, type NpcPlayerView } from './shared/npc-brain'
import type { NpcNetState, NpcStateName, WorldDef, AABB } from './shared/types'
import type { PhysicsWorld } from './physics'
import { SpeechBubbleSystem, NPC_LINES } from './bubbles'

interface NpcVisual {
  brain: NpcBrainState
  rig: CharacterRig
  // interpolation
  prev: { x: number; z: number; ry: number }
  target: { x: number; z: number; ry: number }
  alertShown: boolean
}

const NPC_COLORS: Record<string, { shirt: string; pants: string; skin: string; hair: string; accent: string }> = {
  police: { shirt: '#8a6f4e', pants: '#5c4a34', skin: '#c68a5c', hair: '#191512', accent: '#2c3947' },
  security: { shirt: '#37474f', pants: '#263238', skin: '#b97a4e', hair: '#191512', accent: '#ffb84e' },
  guard: { shirt: '#2c3947', pants: '#1c2630', skin: '#c68a5c', hair: '#191512', accent: '#c9a86a' },
}

export class NpcSystem {
  group = new THREE.Group()
  bubbles = new SpeechBubbleSystem()
  visuals: NpcVisual[] = []
  private brainById = new Map<string, NpcBrainState>()
  private localSim = false
  private simAccum = 0
  private lastNetTime = 0
  private speechCooldown = 2.5

  constructor(
    world: WorldDef,
    private physics: PhysicsWorld,
    quality: 'low' | 'medium' | 'high',
  ) {
    const npcs = quality === 'low' ? world.npcs : world.npcs
    const brains = createNpcStates(npcs.map(n => ({ id: n.id, type: n.type, x: n.x, z: n.z, patrol: n.patrol.map(p => ({ ...p })) })))
    for (const b of brains) {
      if (b.type === 'searchlight') continue
      const rig = new CharacterRig({ colors: NPC_COLORS[b.type] ?? NPC_COLORS.police, npcType: b.type as 'police', scale: b.type === 'security' ? 1.04 : 1 })
      rig.group.position.set(b.x, 0, b.z)
      rig.setNameVisible(false)
      this.group.add(rig.group)
      const v: NpcVisual = {
        brain: b, rig,
        prev: { x: b.x, z: b.z, ry: b.ry },
        target: { x: b.x, z: b.z, ry: b.ry },
        alertShown: false,
      }
      this.visuals.push(v)
      this.brainById.set(b.id, b)
    }
    this.group.add(this.bubbles.group)
  }

  /** Local offline simulation (solo, server unreachable) */
  simulateLocal(dt: number, player: NpcPlayerView, colliders: AABB[], now: number) {
    this.localSim = true
    this.simAccum += dt
    const step = 1 / 10
    while (this.simAccum >= step) {
      this.simAccum -= step
      const events: { kind: string; npcId: string; playerId: string }[] = []
      for (const v of this.visuals) {
        const r = tickNpc(v.brain, [player], colliders, step, now)
        events.push(...r.events)
        v.prev = { ...v.target }
        v.target = { x: v.brain.x, z: v.brain.z, ry: v.brain.ry }
      }
      if (events.length && this.onLocalCapture) this.onLocalCapture(events[0].npcId)
    }
  }

  onLocalCapture: ((npcId: string) => void) | null = null
  onNoise: ((x: number, z: number) => void) | null = null

  distraction(x: number, z: number, duration: number) {
    applyNoise(this.visuals.map(v => v.brain), x, z, duration)
    this.onNoise?.(x, z)
  }

  /** Apply server snapshot (10Hz) */
  applyServerState(states: NpcNetState[]) {
    this.localSim = false
    const now = performance.now()
    this.lastNetTime = now
    for (const s of states) {
      const v = this.visuals.find(v => v.brain.id === s.id)
      if (!v) continue
      v.prev = { ...v.target }
      v.target = { x: s.x, z: s.z, ry: s.ry }
      v.brain.state = s.state
      v.brain.alert = s.alert
    }
  }

  update(dt: number, alpha: number, t: number, px?: number, pz?: number) {
    for (const v of this.visuals) {
      // interpolate
      const x = v.prev.x + (v.target.x - v.prev.x) * alpha
      const z = v.prev.z + (v.target.z - v.prev.z) * alpha
      let dry = v.target.ry - v.prev.ry
      while (dry > Math.PI) dry -= Math.PI * 2
      while (dry < -Math.PI) dry += Math.PI * 2
      const ry = v.prev.ry + dry * alpha
      const dx = v.target.x - v.prev.x, dz = v.target.z - v.prev.z
      const speed = Math.hypot(dx, dz) * 10 // per second
      const st: NpcStateName = v.brain.state
      const anim = st === 'chase' ? 'run' : st === 'investigate' || st === 'return' ? 'walk' : st === 'capture' ? 'throw' : speed > 0.3 ? 'walk' : 'idle'
      v.rig.update(dt, anim as 'idle', Math.min(9, speed))
      v.rig.group.position.set(x, v.rig.group.position.y * 0 + 0, z)
      v.rig.group.rotation.y = ry
      // alert indicator
      const showAlert = st === 'chase' || (st !== 'patrol' && v.brain.alert > 0.25)
      if (showAlert !== v.alertShown) { v.rig.setAlert(showAlert); v.alertShown = showAlert }
    }
    // ambient satire speech bubbles (chasing officers get their own lines)
    this.bubbles.update(dt)
    if (px !== undefined && pz !== undefined) {
      this.speechCooldown -= dt
      if (this.speechCooldown <= 0) {
        this.speechCooldown = 3.6 + Math.random() * 3.4
        const nearby = this.visuals.filter(v => Math.hypot(v.brain.x - px, v.brain.z - pz) < 34)
        if (nearby.length) {
          const pick = nearby[Math.floor(Math.random() * nearby.length)]
          const chasing = pick.brain.state === 'chase'
          const lines = chasing ? NPC_LINES.chase : NPC_LINES[pick.brain.type] ?? NPC_LINES.police
          const text = lines[Math.floor(Math.random() * lines.length)]
          const id = pick.brain.id
          this.bubbles.say(`npc-${id}`, text, () => {
            const vv = this.visuals.find(v2 => v2.brain.id === id)
            return vv ? vv.rig.group.position : null
          }, chasing ? 2.6 : 4.2)
        }
      }
    }
  }

  /** Info for minimap: positions + chase states */
  minimapData() {
    return this.visuals.map(v => ({ id: v.brain.id, x: v.brain.x, z: v.brain.z, chasing: v.brain.state === 'chase', state: v.brain.state }))
  }

  nearestChaserDistance(px: number, pz: number): number {
    let best = 1e9
    for (const v of this.visuals) {
      if (v.brain.state === 'chase') {
        const d = Math.hypot(v.brain.x - px, v.brain.z - pz)
        if (d < best) best = d
      }
    }
    return best
  }
}

// ---- vehicles (deterministic ping-pong; identical on server & client from shared world time) ----
export interface VehicleVisual { id: string; kind: string; group: THREE.Group; path: { x: number; z: number }[]; speed: number }

export class VehicleSystem {
  group = new THREE.Group()
  vehicles: VehicleVisual[] = []
  onPlayerHit: ((kind: string, x: number, z: number, dmg: number) => void) | null = null
  private hitCooldown = 0

  constructor(world: WorldDef) {
    for (const v of world.vehicles) {
      const g = new THREE.Group()
      if (v.kind === 'auto') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 2.6), new THREE.MeshStandardMaterial({ color: '#f2c14e', flatShading: true }))
        body.position.y = 0.95
        const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.6), new THREE.MeshStandardMaterial({ color: '#1c1a17', flatShading: true }))
        canopy.position.set(0, 1.9, -0.2)
        const wheels: THREE.Mesh[] = []
        for (const [wx, wz] of [[-0.75, 0.9], [0.75, 0.9], [0, -0.9]] as const) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10), new THREE.MeshStandardMaterial({ color: '#1a1a1a' }))
          w.rotation.z = Math.PI / 2
          w.position.set(wx, 0.32, wz)
          wheels.push(w)
          g.add(w)
        }
        g.add(body, canopy)
      } else if (v.kind === 'bus') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 8), new THREE.MeshStandardMaterial({ color: '#2e6e8c', flatShading: true }))
        body.position.y = 1.7
        const win = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.8, 6.4), new THREE.MeshStandardMaterial({ color: '#a8cfe0', metalness: 0.3 }))
        win.position.set(0, 2.2, 0.3)
        for (const wz of [-3, 2.6]) {
          for (const wx of [-1.2, 1.2]) {
            const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.25, 10), new THREE.MeshStandardMaterial({ color: '#1a1a1a' }))
            w.rotation.z = Math.PI / 2
            w.position.set(wx, 0.5, wz)
            g.add(w)
          }
        }
        g.add(body, win)
      } else {
        // cow! (slow wandering hazard)
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 1.8), new THREE.MeshStandardMaterial({ color: '#e8e2d4', flatShading: true }))
        body.position.y = 0.95
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: '#e8e2d4', flatShading: true }))
        head.position.set(0, 1.35, 1.05)
        const horn1 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 5), new THREE.MeshStandardMaterial({ color: '#8a8574' }))
        horn1.position.set(0.18, 1.65, 1.05)
        const horn2 = horn1.clone(); horn2.position.x = -0.18
        const spot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: '#5c4a34' }))
        spot.position.set(0.2, 1.05, 0.3)
        for (const [lx, lz] of [[-0.3, 0.65], [0.3, 0.65], [-0.3, -0.65], [0.3, -0.65]] as const) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.7, 5), new THREE.MeshStandardMaterial({ color: '#d8d2c4' }))
          leg.position.set(lx, 0.35, lz)
          g.add(leg)
        }
        g.add(body, head, horn1, horn2, spot)
      }
      g.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = true })
      this.group.add(g)
      this.vehicles.push({ id: v.id, kind: v.kind, group: g, path: v.path.map(([px, pz]) => ({ x: px, z: pz })), speed: v.speed })
    }
  }

  /** Deterministic update from shared world time (seconds since match start) */
  update(worldTime: number, dt: number, playerPos: THREE.Vector3 | null, localAuth: boolean) {
    this.hitCooldown = Math.max(0, this.hitCooldown - dt)
    for (const v of this.vehicles) {
      const a = v.path[0], b = v.path[1]
      const len = Math.hypot(b.x - a.x, b.z - a.z)
      const period = (len / v.speed) * 2
      const phase = ((worldTime % period) + period) % period
      const half = period / 2
      const t = phase < half ? phase / half : 2 - phase / half // ping-pong 0..1..0
      const x = a.x + (b.x - a.x) * t
      const z = a.z + (b.z - a.z) * t
      const dir = phase < half ? 1 : -1
      v.group.position.set(x, 0, z)
      v.group.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) * dir
      // collision with local player
      if (playerPos && localAuth && this.hitCooldown <= 0) {
        const d = Math.hypot(playerPos.x - x, playerPos.z - z)
        if (d < (v.kind === 'bus' ? 2.6 : v.kind === 'cow' ? 1.4 : 1.7)) {
          this.hitCooldown = 1.2
          const dmg = v.kind === 'cow' ? 8 : v.kind === 'bus' ? 40 : 35
          this.onPlayerHit?.(v.kind, x, z, dmg)
        }
      }
    }
  }
}
