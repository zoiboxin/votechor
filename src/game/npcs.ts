// VoteChor NPC system (client) — renders server NPC states with interpolation.
// Falls back to local simulation when offline (solo mode without server).
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
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
// 2-d visual overhaul: lowpoly poster-palette cars / city buses / auto-rickshaws / cows built from
// primitives, static sub-boxes merged per material (few draw calls), shared geometry+material caches,
// spinning (and steering, front axle) cylinder wheels, plus heading-agnostic solid AABBs for movement.

export interface VehicleWheel { pivot: THREE.Object3D; spin: THREE.Object3D; radius: number; steers: boolean }

export interface VehicleVisual {
  id: string
  kind: string
  group: THREE.Group
  path: { x: number; z: number }[]
  speed: number
  wheels: VehicleWheel[]   // empty for the cow
  prevHeading: number      // drive state for the steer-angle approximation
  steer: number
}

/** (2-d contract) Solid half-extents + roof height per kind — heading-agnostic AABBs for getSolidAABBs(). */
export const VEHICLE_SOLID_EXTENTS: Record<string, { hx: number; hz: number; maxY: number }> = {
  car: { hx: 0.95, hz: 1.6, maxY: 1.45 },
  bus: { hx: 1.3, hz: 4.3, maxY: 2.7 },
  auto: { hx: 0.85, hz: 1.1, maxY: 1.75 }, // auto-rickshaw
  cow: { hx: 0.7, hz: 1.25, maxY: 1.6 },
}

// ---- module-level shared materials / geometry caches (no per-instance or per-frame allocation) ----
const matCache = new Map<string, THREE.MeshStandardMaterial>()
function flatMat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const key = color + '|' + JSON.stringify(opts)
  let m = matCache.get(key)
  if (!m) { m = new THREE.MeshStandardMaterial({ color, flatShading: true, ...opts }); matCache.set(key, m) }
  return m
}
const tireMat = flatMat('#181614', { roughness: 0.95 })
const rimMat = flatMat('#4a453d', { metalness: 0.35, roughness: 0.5 })
const glassMat = flatMat('#1d2429', { metalness: 0.4, roughness: 0.15, transparent: true, opacity: 0.62 })
const trimMat = flatMat('#24201b', { roughness: 0.8 })
const plateMat = flatMat('#f2ecd9', { roughness: 0.6 })
const headlightMat = flatMat('#fff1c4', { emissive: '#ffcf6e', emissiveIntensity: 0.9, roughness: 0.4 })
const taillightMat = flatMat('#7a1611', { emissive: '#ff2f1f', emissiveIntensity: 0.75, roughness: 0.4 })

const wheelGeoms = new Map<string, THREE.CylinderGeometry>()
function cachedCyl(key: string, make: () => THREE.CylinderGeometry) {
  let g = wheelGeoms.get(key)
  if (!g) { g = make(); wheelGeoms.set(key, g) }
  return g
}
function wheelGeo(r: number, w: number) { return cachedCyl(`t${r}:${w}`, () => new THREE.CylinderGeometry(r, r, w, 10)) }
function rimGeo(r: number, w: number) { return cachedCyl(`r${r}:${w}`, () => new THREE.CylinderGeometry(r * 0.52, r * 0.52, w + 0.03, 8)) }

/** buildWheels — cylinder wheels rolled around X (rotation.z=π/2, spin = rotation.x), grouped per axle. */
function buildWheels(
  count: number,
  positions: Array<[number, number]>, // [x, z]; front axle = largest z (steers when opts.steer)
  radius: number,
  opts: { width?: number; steer?: boolean; rims?: boolean | 'front' } = {},
): { group: THREE.Group; wheels: VehicleWheel[] } {
  const width = opts.width ?? radius * 0.68
  const frontZ = Math.max(...positions.map(p => p[1]))
  const group = new THREE.Group()
  const axles = new Map<number, THREE.Group>()
  const wheels: VehicleWheel[] = []
  for (let i = 0; i < count; i++) {
    const [wx, wz] = positions[i % positions.length]
    let axle = axles.get(wz)
    if (!axle) { axle = new THREE.Group(); axle.position.z = wz; group.add(axle); axles.set(wz, axle) }
    const isFront = opts.steer === true && wz === frontZ
    const pivot = new THREE.Group()
    pivot.position.x = wx
    axle.add(pivot)
    const tire = new THREE.Mesh(wheelGeo(radius, width), tireMat)
    tire.rotation.z = Math.PI / 2
    tire.castShadow = false // perf: bodies only
    pivot.add(tire)
    if (opts.rims === true || (opts.rims === 'front' && isFront)) {
      const rim = new THREE.Mesh(rimGeo(radius, width), rimMat)
      rim.rotation.z = Math.PI / 2
      rim.castShadow = false
      tire.add(rim) // child of the tire → inherits spin + steer
    }
    wheels.push({ pivot, spin: tire, radius, steers: isFront })
  }
  return { group, wheels }
}

// ---- primitive-baking helpers (build-time only; everything merges into few meshes per vehicle) ----
function box(w: number, h: number, d: number, x = 0, y = 0, z = 0, rx = 0): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  if (rx) g.rotateX(rx)
  g.translate(x, y, z)
  return g
}
function taperTop(g: THREE.BoxGeometry, sx: number, sz: number) {
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) { pos.setX(i, pos.getX(i) * sx); pos.setZ(i, pos.getZ(i) * sz) }
  pos.needsUpdate = true
  g.computeVertexNormals()
  return g
}
function merged(parts: THREE.BufferGeometry[], mat: THREE.Material, castShadow = true): THREE.Mesh {
  const geo = mergeGeometries(parts, false)
  const mesh = new THREE.Mesh(geo ?? parts[0], mat)
  if (geo) for (const p of parts) p.dispose()
  mesh.castShadow = castShadow
  return mesh
}

const CAR_PALETTES = ['#d9a441', '#b5543a', '#93a67e'] // taxi-gold, dusty red, sage green (poster palette)

function buildCar(variant: number): { group: THREE.Group; wheels: VehicleWheel[] } {
  const L = 3.7 + (variant % 3) * 0.25 // per-instance length variance
  const H = 0.55 + (variant % 2) * 0.05
  const cabinY = 0.325 + H + 0.25
  const bodyMat = flatMat(CAR_PALETTES[variant % 3], { roughness: 0.5, metalness: 0.12 })
  const body = merged([
    taperTop(new THREE.BoxGeometry(1.42, 0.5, L * 0.5), 0.84, 0.86).translate(0, cabinY, -L * 0.06), // tapered cabin
    box(1.55, H, L, 0, 0.325 + H / 2, 0),   // chassis
    box(1.48, 0.24, L * 0.3, 0, cabinY - 0.13, L * 0.3),  // hood
    box(1.48, 0.22, L * 0.22, 0, cabinY - 0.14, -L * 0.33), // boot
  ], bodyMat)
  const glass = merged([
    box(1.46, 0.3, L * 0.4, 0, cabinY - 0.03, -L * 0.06),      // side window band (pokes past cabin)
    box(1.3, 0.42, 0.07, 0, cabinY - 0.02, L * 0.2, -0.42),    // windshield
    box(1.28, 0.36, 0.07, 0, cabinY - 0.02, -L * 0.31, 0.46),  // rear glass
  ], glassMat, false)
  const dark = merged([
    box(1.62, 0.2, 0.22, 0, 0.42, L / 2 + 0.02), box(1.62, 0.2, 0.22, 0, 0.42, -L / 2 - 0.02), // bumpers
    box(0.9, 0.12, 0.05, 0, 0.72, L / 2 + 0.02),                                               // grill
    box(0.26, 0.32, 0.6, 0.7, 0.62, L * 0.32), box(0.26, 0.32, 0.6, -0.7, 0.62, L * 0.32),     // wheel arches
    box(0.26, 0.32, 0.6, 0.7, 0.62, -L * 0.32), box(0.26, 0.32, 0.6, -0.7, 0.62, -L * 0.32),
    box(0.05, 0.04, 0.06, 0.8, cabinY - 0.12, L * 0.16), box(0.05, 0.04, 0.06, -0.8, cabinY - 0.12, L * 0.16),   // mirror stalks
    box(0.17, 0.11, 0.08, 0.9, cabinY - 0.1, L * 0.16), box(0.17, 0.11, 0.08, -0.9, cabinY - 0.1, L * 0.16),     // mirrors
  ], trimMat)
  const headlights = merged([box(0.3, 0.14, 0.07, 0.48, 0.74, L / 2 + 0.03), box(0.3, 0.14, 0.07, -0.48, 0.74, L / 2 + 0.03)], headlightMat, false)
  const taillights = merged([box(0.34, 0.13, 0.07, 0.5, 0.78, -L / 2 - 0.03), box(0.34, 0.13, 0.07, -0.5, 0.78, -L / 2 - 0.03)], taillightMat, false)
  const plates = [box(0.36, 0.13, 0.04, 0, 0.55, L / 2 + 0.14), box(0.36, 0.13, 0.04, 0, 0.55, -L / 2 - 0.14)]
  if (variant % 3 === 0) plates.push(box(0.46, 0.13, 0.22, 0, cabinY + 0.315, -L * 0.06)) // taxi roof sign (gold flavor)
  const plateMesh = merged(plates, plateMat, false)
  const w = buildWheels(4, [[-0.68, L * 0.32], [0.68, L * 0.32], [-0.68, -L * 0.32], [0.68, -L * 0.32]], 0.33, { width: 0.22, steer: true, rims: true })
  const group = new THREE.Group()
  group.add(body, dark, glass, headlights, taillights, plateMesh, w.group)
  return { group, wheels: w.wheels }
}

function buildBus(variant: number): { group: THREE.Group; wheels: VehicleWheel[] } {
  const L = 8.6
  const cream = flatMat('#e7ddc4', { roughness: 0.6 })
  const liveryMat = flatMat(variant % 2 ? '#7a3040' : '#3e6b4f', { roughness: 0.6 }) // maroon / green livery
  const creamParts: THREE.BufferGeometry[] = [
    box(2.36, 1.85, L, 0, 1.525, 0),            // main body
    box(2.3, 0.17, L - 0.1, 0, 2.535, 0),       // roof cap
    box(0.5, 0.07, 0.8, -0.5, 2.65, -1.6), box(0.5, 0.07, 0.8, 0.5, 2.65, -2.0), // roof hatches
    box(0.5, 0.2, 0.06, 0, 1.32, L / 2 + 0.03), box(0.5, 0.2, 0.06, 0, 1.32, -L / 2 - 0.03), // route + rear plates
  ]
  const glassParts: THREE.BufferGeometry[] = [
    box(2.15, 0.8, 0.1, 0, 1.9, L / 2 + 0.02, -0.06),   // front windshield
    box(2.0, 0.6, 0.1, 0, 1.9, -L / 2 - 0.02),          // rear window
  ]
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const zc = -2.7 + i * 1.35
      glassParts.push(box(0.07, 0.72, 1.1, side * 1.2, 1.85, zc))          // window panes
      if (i < 4) creamParts.push(box(0.06, 0.8, 0.25, side * 1.19, 1.85, zc + 0.675)) // pillars
    }
    creamParts.push(box(0.06, 0.8, 0.2, side * 1.19, 1.85, -3.32), box(0.06, 0.8, 0.2, side * 1.19, 1.85, 3.42))
  }
  const dark = merged([
    box(2.5, 0.32, 0.26, 0, 0.5, L / 2 + 0.06), box(2.5, 0.32, 0.26, 0, 0.5, -L / 2 - 0.06), // bumpers
    box(0.5, 0.4, 0.78, 1.19, 0.78, 2.9), box(0.5, 0.4, 0.78, -1.19, 0.78, 2.9),             // wheel wells
    box(0.5, 0.4, 0.78, 1.19, 0.78, -2.0), box(0.5, 0.4, 0.78, -1.19, 0.78, -2.0),
    box(0.5, 0.4, 0.78, 1.19, 0.78, -2.95), box(0.5, 0.4, 0.78, -1.19, 0.78, -2.95),
    box(0.06, 1.5, 0.95, 1.22, 1.4, 2.75), box(0.06, 1.5, 0.95, 1.22, 1.4, -0.5),            // door seams (front + mid)
    box(1.9, 0.3, 0.09, 0, 2.32, L / 2 + 0.02),                                              // destination board
    box(0.3, 0.05, 0.05, 1.28, 2.15, L / 2 - 0.05), box(0.3, 0.05, 0.05, -1.28, 2.15, L / 2 - 0.05), // mirror stalks
    box(0.1, 0.26, 0.14, 1.42, 2.15, L / 2 - 0.1), box(0.1, 0.26, 0.14, -1.42, 2.15, L / 2 - 0.1),   // mirrors
    box(0.44, 0.5, 0.44, 0.72, 1.5, 2.1),                                                    // driver silhouette
    box(0.4, 0.45, 0.42, -0.55, 1.5, -0.6), box(0.4, 0.45, 0.42, 0.55, 1.5, -0.6),           // passenger seats
    box(0.4, 0.45, 0.42, -0.55, 1.5, -1.8), box(0.4, 0.45, 0.42, 0.55, 1.5, -1.8),
    box(0.4, 0.45, 0.42, 0, 1.5, -3.0),
  ], trimMat)
  const w = buildWheels(6, [[-1.05, 2.9], [1.05, 2.9], [-1.05, -2.0], [1.05, -2.0], [-1.05, -2.95], [1.05, -2.95]], 0.5, { width: 0.32, steer: true })
  const group = new THREE.Group()
  group.add(
    merged(creamParts, cream),
    merged([box(2.42, 0.5, L + 0.04, 0, 0.85, 0), box(2.42, 0.5, 0.3, 0, 1.1, L / 2 - 0.1), box(2.42, 0.5, 0.3, 0, 1.1, -L / 2 + 0.1)], liveryMat),
    merged(glassParts, glassMat, false),
    dark,
    merged([box(0.36, 0.16, 0.07, 0.8, 0.78, L / 2 + 0.05), box(0.36, 0.16, 0.07, -0.8, 0.78, L / 2 + 0.05)], headlightMat, false),
    merged([box(0.36, 0.16, 0.07, 0.85, 0.95, -L / 2 - 0.05), box(0.36, 0.16, 0.07, -0.85, 0.95, -L / 2 - 0.05)], taillightMat, false),
    w.group,
  )
  return { group, wheels: w.wheels }
}

function buildAuto(): { group: THREE.Group; wheels: VehicleWheel[] } {
  const green = flatMat('#2e6b4a', { roughness: 0.6, side: THREE.DoubleSide })
  const yellow = flatMat('#e3b23c', { roughness: 0.55, side: THREE.DoubleSide })
  const cowl = new THREE.CylinderGeometry(0.62, 0.62, 0.72, 8, 1, true, Math.PI * 1.5, Math.PI) // front-half shell
  cowl.translate(0, 0.95, 0.8)
  const canopy = new THREE.CylinderGeometry(0.7, 0.7, 1.7, 8, 1, true, Math.PI / 2, Math.PI) // top-half shell
  canopy.rotateX(Math.PI / 2)
  canopy.translate(0, 1.05, 0.7)
  const body = merged([
    cowl,
    box(1.3, 0.14, 2.5, 0, 0.45, 0),        // floor pan
    box(1.5, 0.8, 1.4, 0, 0.98, -0.85),     // rear body
  ], green)
  const canopyMesh = merged([canopy], yellow) // yellow roof over green body — classic auto livery
  const glass = merged([
    box(0.95, 0.42, 0.05, 0, 1.3, 1.48, -0.3),                    // windshield
    box(0.38, 0.28, 0.04, 0.42, 1.22, -1.57), box(0.38, 0.28, 0.04, -0.42, 1.22, -1.57), // rear panes
  ], glassMat, false)
  const dark = merged([
    box(1.1, 0.6, 1.4, 0, 0.9, 0.55),        // interior mass (open sides read dark inside)
    box(0.5, 0.45, 0.5, 0, 0.85, 0.3),       // driver seat silhouette
    box(1.15, 0.42, 0.5, 0, 0.9, -0.75),     // passenger bench
    box(0.04, 0.72, 0.04, 0.68, 1.1, 0.05), box(0.04, 0.72, 0.04, -0.68, 1.1, 0.05),   // canopy struts
    box(0.04, 0.72, 0.04, 0.68, 1.1, 1.4), box(0.04, 0.72, 0.04, -0.68, 1.1, 1.4),
    box(0.34, 0.2, 0.55, 0, 0.6, 1.05),      // front mudguard
  ], trimMat)
  const lampGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.07, 8)
  lampGeo.rotateX(Math.PI / 2)
  lampGeo.translate(0, 1.08, 1.44)
  const lamp = new THREE.Mesh(lampGeo, headlightMat)
  const w = buildWheels(3, [[0, 1.05], [-0.72, -0.95], [0.72, -0.95]], 0.32, { width: 0.2, steer: true, rims: 'front' })
  const group = new THREE.Group()
  group.add(body, canopyMesh, glass, dark, lamp, w.group)
  return { group, wheels: w.wheels }
}

function buildCow(): { group: THREE.Group; wheels: VehicleWheel[] } {
  const cowCream = flatMat('#e8e2d4')
  const spotMat = flatMat('#5c4a34')
  const hornMat = flatMat('#8a8574')
  const head = box(0.5, 0.5, 0.5, 0, 1.28, 1.02, 0.3) // grazing head angle
  const body = merged([
    box(0.9, 0.9, 1.8, 0, 0.95, 0),
    head,
    box(0.14, 0.1, 0.18, 0.28, 1.48, 0.95), box(0.14, 0.1, 0.18, -0.28, 1.48, 0.95), // ears
    box(0.3, 0.24, 0.16, 0, 1.14, 1.3),     // snout
  ], cowCream)
  const spots = merged([
    box(0.35, 0.35, 0.5, 0.2, 1.15, 0.3), box(0.3, 0.3, 0.4, -0.2, 1.2, -0.4),
    box(0.16, 0.12, 0.16, 0.3, 0.06, 0.65), box(0.16, 0.12, 0.16, -0.3, 0.06, 0.65),  // hooves
    box(0.16, 0.12, 0.16, 0.3, 0.06, -0.65), box(0.16, 0.12, 0.16, -0.3, 0.06, -0.65),
  ], spotMat)
  const hornGeo = new THREE.ConeGeometry(0.08, 0.25, 5)
  hornGeo.translate(0.18, 1.65, 1.05)
  const horn2 = new THREE.ConeGeometry(0.08, 0.25, 5)
  horn2.translate(-0.18, 1.65, 1.05)
  const legs = merged([
    new THREE.CylinderGeometry(0.09, 0.09, 0.7, 5).translate(0.3, 0.35, 0.65),
    new THREE.CylinderGeometry(0.09, 0.09, 0.7, 5).translate(-0.3, 0.35, 0.65),
    new THREE.CylinderGeometry(0.09, 0.09, 0.7, 5).translate(0.3, 0.35, -0.65),
    new THREE.CylinderGeometry(0.09, 0.09, 0.7, 5).translate(-0.3, 0.35, -0.65),
  ], cowCream)
  const group = new THREE.Group()
  group.add(body, spots, merged([hornGeo, horn2], hornMat, false), legs)
  return { group, wheels: [] }
}

export class VehicleSystem {
  group = new THREE.Group()
  vehicles: VehicleVisual[] = []
  onPlayerHit: ((kind: string, x: number, z: number, dmg: number) => void) | null = null
  private hitCooldown = 0

  constructor(world: WorldDef) {
    for (let i = 0; i < world.vehicles.length; i++) {
      const v = world.vehicles[i]
      const built = v.kind === 'bus' ? buildBus(i)
        : v.kind === 'cow' ? buildCow()
        : v.kind === 'auto' ? buildAuto()
        : buildCar(i) // 'car' kind (and safe fallback for any future kind)
      built.group.name = `vehicle-${v.kind}-${v.id}`
      this.group.add(built.group)
      this.vehicles.push({ id: v.id, kind: v.kind, group: built.group, path: v.path.map(([px, pz]) => ({ x: px, z: pz })), speed: v.speed, wheels: built.wheels, prevHeading: NaN, steer: 0 })
    }
  }

  /** Deterministic update from shared world time (seconds since match start) */
  update(worldTime: number, dt: number, playerPos: THREE.Vector3 | null, localAuth: boolean) {
    this.hitCooldown = Math.max(0, this.hitCooldown - dt)
    const step = Math.max(dt, 1e-4)
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
      const heading = Math.atan2(b.x - a.x, b.z - a.z) * dir
      // steer angle ≈ signed turn rate of heading, clamped ±0.5 rad (paths are straight → ~0, kicks at U-turns)
      if (Number.isFinite(v.prevHeading)) {
        let dh = heading - v.prevHeading
        while (dh > Math.PI) dh -= Math.PI * 2
        while (dh < -Math.PI) dh += Math.PI * 2
        const turn = Math.max(-0.5, Math.min(0.5, dh / step))
        v.steer += (turn - v.steer) * Math.min(1, step * 7)
      }
      v.prevHeading = heading
      v.group.rotation.y = heading
      // wheels spin by actual travel speed; front pivots take the steer angle
      for (const w of v.wheels) {
        w.spin.rotation.x += (v.speed * dt) / w.radius
        if (w.steers) w.pivot.rotation.y = v.steer
      }
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

  /** (2-d contract) One heading-agnostic solid AABB per vehicle — movement workstream consumes these. */
  getSolidAABBs(): AABB[] {
    const pad = 0.05
    const out: AABB[] = []
    for (const v of this.vehicles) {
      const e = VEHICLE_SOLID_EXTENTS[v.kind] ?? VEHICLE_SOLID_EXTENTS.car
      const x = v.group.position.x
      const z = v.group.position.z
      out.push({ minX: x - e.hx - pad, minY: 0, minZ: z - e.hz - pad, maxX: x + e.hx + pad, maxY: e.maxY, maxZ: z + e.hz + pad })
    }
    return out
  }
}
