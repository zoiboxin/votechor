// VoteChor NPC system (client) — renders server NPC states with interpolation.
// Falls back to local simulation when offline (solo mode without server).
import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { CharacterRig } from './character'
import { createNpcStates, tickNpc, applyNoise, propagateChase, type NpcBrainState, type NpcPlayerView } from './shared/npc-brain'
import type { NpcNetState, NpcStateName, WorldDef, AABB } from './shared/types'
import type { PhysicsWorld } from './physics'
import { SpeechBubbleSystem, NPC_LINES } from './bubbles'
import { AudioManager, type SfxName } from './audio'

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
  /** OPT-IN far-LOD (game.ts keys it to the performance-visibility setting). Default
   *  false = every NPC rig always drawn — the proven v25 rendering path. */
  farLod = false
  group = new THREE.Group()
  bubbles = new SpeechBubbleSystem()
  visuals: NpcVisual[] = []
  private brainById = new Map<string, NpcBrainState>()
  private localSim = false
  private simAccum = 0
  private lastNetTime = 0
  private speechCooldown = 2.5
  /** v52 — spatial bot-voice scheduler: one nearby bot voices every few seconds
   *  (protesters chatter/chant/shout, officers bark orders + far whistles). */
  private voiceCooldown = 1.5
  /** v50 — reusable minimap rows: drawHudMinimap runs every frame and this used to
   *  allocate a fresh object PER NPC PER FRAME (~40 objs @60Hz = constant GC churn). */
  private minimapCache: { id: string; x: number; z: number; chasing: boolean; state: string }[] = []

  constructor(
    world: WorldDef,
    private physics: PhysicsWorld,
    quality: 'low' | 'medium' | 'high',
  ) {
    const npcs = quality === 'low' ? world.npcs : world.npcs
    // patrol passed RAW — createNpcStates handles [x,z] tuples properly; pre-spreading
    // ({...p}) exploded tuples into {0:x,1:z}, making wp.x undefined → NaN-frozen NPCs offline
    const brains = createNpcStates(npcs.map(n => ({ id: n.id, type: n.type, x: n.x, z: n.z, patrol: n.patrol })))
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
      this.brainsCache.push(b) // v51 — pack-pursuit input (order-stable, rebuilt only here)
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
      const events: import('./shared/npc-brain').NpcEvent[] = []
      for (const v of this.visuals) {
        const r = tickNpc(v.brain, [player], colliders, step, now)
        events.push(...r.events)
        // in-place shift (v50) — two object literals per NPC per tick added up
        v.prev.x = v.target.x; v.prev.z = v.target.z; v.prev.ry = v.target.ry
        v.target.x = v.brain.x; v.target.z = v.brain.z; v.target.ry = v.brain.ry
      }
      // v51 — pack pursuit: an active chase is contagious to nearby officers
      propagateChase(this.brainsCache, undefined, now)
      for (const ev of events) {
        if (ev.kind === 'capture') this.onLocalCapture?.(ev.npcId)
        else if (ev.kind === 'hit') this.onLocalHit?.(ev.amount ?? 12)
      }
    }
  }

  /** v51 — zero-alloc brains list for propagateChase (mirrors this.visuals order;
   *  rebuilt only when rigs are (re)created — never per tick). */
  private brainsCache: NpcBrainState[] = []

  onLocalCapture: ((npcId: string) => void) | null = null
  onLocalHit: ((amount: number) => void) | null = null
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
      // brain mirrors the latest server truth — minimapData(), nearestChaserDistance(),
      // speech-bubble proximity and hit-feel knockback all read brain.x/z, which were
      // silently stuck at world-def SPAWN positions in online mode (latent bug found
      // while fixing the WANTED banner: distance checks compared against stale spawns)
      v.brain.x = s.x
      v.brain.z = s.z
      v.brain.ry = s.ry
      v.brain.state = s.state
      v.brain.alert = s.alert
      // chase target — lets nearestChaserDistance() tell "I am the quarry" from
      // "some officer across town is chasing a bot" (WANTED banner correctness)
      v.brain.targetId = s.target ?? null
    }
  }

  update(dt: number, alpha: number, t: number, px?: number, pz?: number, listenerYaw = 0) {
    // ---- far LOD (OPT-IN via game.ts, keyed to the performance-visibility setting):
    // NPC rigs beyond 70m are sub-pixel silhouettes in fog — hide the body and skip
    // its pose update entirely (AI/minimaps/speech logic untouched: everything reads
    // brain.x/z, and speech targets are always <34m away). A hidden rig saves ~25
    // draw calls + a full procedural pose pass per NPC. Default OFF = the proven
    // v25 rendering path where every rig is always drawn.
    const LOD_DIST = 70
    const lod = this.farLod && px !== undefined && pz !== undefined
    for (const v of this.visuals) {
      if (lod) {
        const far = Math.hypot(v.target.x - px, v.target.z - pz) > LOD_DIST
        if (far) {
          if (v.rig.group.visible) v.rig.group.visible = false
          continue
        } else if (!v.rig.group.visible) {
          v.rig.group.visible = true
        }
      }
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

      // ---- v52 spatial bot VOICES (the audio layer over the speech bubbles):
      // every few seconds one bot within earshot actually makes a sound through
      // AudioManager.playAt — panned to its side, distance-attenuated, silent past
      // range. An active chase shortens the cadence and forces officer barks, so
      // the hunt is audible before it is visible.
      this.voiceCooldown -= dt
      if (this.voiceCooldown <= 0) {
        // pick the nearest audible bot; a chasing officer always wins the slot
        let best: NpcVisual | null = null
        let bestScore = Infinity
        for (const v of this.visuals) {
          const dx = v.brain.x - px
          const dz = v.brain.z - pz
          const d2 = dx * dx + dz * dz
          if (d2 > 34 * 34) continue
          // chasing bots outrank everything at 3× their distance (heard first)
          const score = v.brain.state === 'chase' || v.brain.state === 'capture' ? d2 / 3 : d2
          if (score < bestScore) { bestScore = score; best = v }
        }
        if (best) {
          const b = best.brain
          const police = b.type === 'police' || b.type === 'security' || b.type === 'guard'
          const hot = b.state === 'chase' || b.state === 'capture'
          let voice: SfxName
          if (hot && police) voice = Math.random() < 0.62 ? 'order' : (Math.random() < 0.5 ? 'whistleFar' : 'shout')
          else if (hot) voice = 'shout'
          else if (police) voice = Math.random() < 0.3 ? 'whistleFar' : 'chatter'
          else voice = Math.random() < 0.34 ? 'chant' : (Math.random() < 0.6 ? 'chatter' : 'shout')
          AudioManager.playAt(voice, b.x, b.z, px, pz, listenerYaw, 34, hot ? 1.15 : 0.95)
          // chase nearby → urgent chatter; calm streets → sparse ambience
          this.voiceCooldown = hot && bestScore < 400 ? 1.4 + Math.random() * 1.6 : 2.6 + Math.random() * 4.4
        } else {
          this.voiceCooldown = 2 + Math.random() * 2
        }
      }
    }
  }

  /** Info for minimap: positions + chase states. v50 — reuses a persistent row
   *  buffer (zero per-frame allocation; callers consume synchronously). */
  minimapData() {
    const arr = this.minimapCache
    while (arr.length < this.visuals.length) arr.push({ id: '', x: 0, z: 0, chasing: false, state: 'patrol' })
    arr.length = this.visuals.length
    for (let i = 0; i < this.visuals.length; i++) {
      const v = this.visuals[i]
      const o = arr[i]
      o.id = v.brain.id
      o.x = v.brain.x
      o.z = v.brain.z
      o.chasing = v.brain.state === 'chase'
      o.state = v.brain.state
    }
    return arr
  }

  /**
   * Distance to the nearest officer ACTIVELY CHASING `targetId` (omit for "any chaser").
   * Target-aware since round 25: a Season officer chasing a bot across town must not
   * flash the WANTED banner on an unrelated player's screen.
   */
  nearestChaserDistance(px: number, pz: number, targetId?: string): number {
    let best = 1e9
    for (const v of this.visuals) {
      if (v.brain.state !== 'chase') continue
      if (targetId !== undefined && v.brain.targetId !== targetId) continue
      const d = Math.hypot(v.brain.x - px, v.brain.z - pz)
      if (d < best) best = d
    }
    return best
  }
}

// ---- vehicles (deterministic polyline ping-pong; identical on server & client from shared world time) ----
// 2-d visual overhaul: poster-palette cars / city buses / auto-rickshaws / cows built from
// primitives + extrusions, static sub-parts merged per material (few draw calls), shared
// geometry+material caches, spinning (and steering, front axle) wheels, plus heading-agnostic
// solid AABBs for movement. v37 — paths may have any number of waypoints; traversal walks the
// polyline by arc length (turns at junctions, ping-pong at the ends).

export interface VehicleWheel { pivot: THREE.Object3D; spin: THREE.Object3D; radius: number; steers: boolean }

export interface VehicleVisual {
  id: string
  kind: string
  group: THREE.Group
  path: { x: number; z: number }[]
  cum: number[]            // cumulative arc length from path[0] (cum[0] = 0)
  speed: number
  wheels: VehicleWheel[]   // empty for the cow
  prevHeading: number      // drive state for the steer-angle approximation
  steer: number
  closed: boolean          // v66 — first point repeats → cyclic loop (no ping-pong)
  honkOff: number          // v66 — deterministic honk phase offset (id hash, seconds)
}

/** (2-d contract) Solid half-extents + roof height per kind — heading-agnostic AABBs for getSolidAABBs(). */
export const VEHICLE_SOLID_EXTENTS: Record<string, { hx: number; hz: number; maxY: number }> = {
  car: { hx: 0.95, hz: 1.6, maxY: 1.55 },
  bus: { hx: 1.3, hz: 4.3, maxY: 2.7 },
  auto: { hx: 0.85, hz: 1.1, maxY: 1.75 }, // auto-rickshaw
  bike: { hx: 0.4, hz: 1.05, maxY: 1.4 }, // motorcycle (v38 — mirrors now clear the roof line)
  cow: { hx: 0.7, hz: 1.25, maxY: 1.6 },
}

/** Per-kind player-collision ring + contact damage — client feel; the game-server
 *  mirrors these numbers in its VEHICLE_RADIUS / VEHICLE_DAMAGE tables. */
const VEHICLE_HIT: Record<string, { r: number; dmg: number }> = {
  car: { r: 1.8, dmg: 35 },
  bus: { r: 2.6, dmg: 40 },
  auto: { r: 1.7, dmg: 35 },
  bike: { r: 1.0, dmg: 22 },
  cow: { r: 1.4, dmg: 8 },
}

// ---- module-level shared materials / geometry caches (no per-instance or per-frame allocation) ----
const matCache = new Map<string, THREE.MeshStandardMaterial>()
function flatMat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const key = color + '|' + JSON.stringify(opts)
  let m = matCache.get(key)
  if (!m) { m = new THREE.MeshStandardMaterial({ color, flatShading: true, ...opts }); matCache.set(key, m) }
  return m
}
const tireMat = flatMat('#181614', { roughness: 0.92 })
const rimMat = flatMat('#4a453d', { metalness: 0.35, roughness: 0.5 })
const glassMat = flatMat('#141b21', { metalness: 0.3, roughness: 0.08, transparent: true, opacity: 0.7, flatShading: false })
// v66 — car cabin glass: lighter + more transparent than the shared window glass so
// the driver actually READS inside the greenhouse from gameplay distances.
const cabinGlassMat = flatMat('#3d5260', { metalness: 0.25, roughness: 0.12, transparent: true, opacity: 0.42, flatShading: false })
const trimMat = flatMat('#24201b', { roughness: 0.8 })
const plateMat = flatMat('#f2ecd9', { roughness: 0.6 })
const headlightMat = flatMat('#fff1c4', { emissive: '#ffcf6e', emissiveIntensity: 0.9, roughness: 0.4 })
const taillightMat = flatMat('#7a1611', { emissive: '#ff2f1f', emissiveIntensity: 0.75, roughness: 0.4 })

// v36 realism tech — per-material env-reflection strength (RoomEnvironment PMREM,
// applied ONLY to vehicle materials so the proven world look is untouched).
tireMat.userData.envInt = 0.12
rimMat.userData.envInt = 0.7
glassMat.userData.envInt = 1.15
cabinGlassMat.userData.envInt = 1.0
trimMat.userData.envInt = 0.25
plateMat.userData.envInt = 0.3
headlightMat.userData.envInt = 0.5
taillightMat.userData.envInt = 0.5

let vehicleEnvTex: THREE.Texture | null = null
let vehicleEnvRenderer: THREE.WebGLRenderer | null = null
/** Bake a small neutral-studio environment once per renderer; null on any failure. */
function ensureVehicleEnv(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  if (vehicleEnvRenderer === renderer) return vehicleEnvTex
  try {
    const pmrem = new THREE.PMREMGenerator(renderer)
    const rt = pmrem.fromScene(new RoomEnvironment(), 0.04)
    vehicleEnvTex = rt.texture
    pmrem.dispose()
    vehicleEnvRenderer = renderer
  } catch {
    vehicleEnvTex = null
  }
  return vehicleEnvTex
}
/** Assign the env map to every vehicle material (shared caches → guarded by envDone). */
function applyVehicleEnv(root: THREE.Object3D) {
  if (!vehicleEnvTex) return
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial & { userData: { envDone?: boolean; envInt?: number } }
      if (!mat || !mat.isMaterial || mat.userData.envDone) continue
      mat.envMap = vehicleEnvTex
      mat.envMapIntensity = typeof mat.userData.envInt === 'number' ? mat.userData.envInt : 0.45
      mat.userData.envDone = true
      mat.needsUpdate = true
    }
  })
}

// v36 car paint — clearcoat physical material (smooth-shaded, env-reflective)
const paintCache = new Map<string, THREE.MeshPhysicalMaterial>()
function carPaint(color: string): THREE.MeshPhysicalMaterial {
  let m = paintCache.get(color)
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color, metalness: 0.62, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.12 })
    m.userData.envInt = 0.65
    paintCache.set(color, m)
  }
  return m
}

const wheelGeoms = new Map<string, THREE.CylinderGeometry>()
function cachedCyl(key: string, make: () => THREE.CylinderGeometry) {
  let g = wheelGeoms.get(key)
  if (!g) { g = make(); wheelGeoms.set(key, g) }
  return g
}
function wheelGeo(r: number, w: number) { return cachedCyl(`t${r}:${w}`, () => new THREE.CylinderGeometry(r, r, w, 10)) }
function rimGeo(r: number, w: number) { return cachedCyl(`r${r}:${w}`, () => new THREE.CylinderGeometry(r * 0.52, r * 0.52, w + 0.03, 8)) }
// v36 torus tire — rounded cross-section reads far more real than a plain cylinder
const torusCache = new Map<string, THREE.TorusGeometry>()
function torusGeo(r: number, w: number) {
  let g = torusCache.get(`tt${r}:${w}`)
  if (!g) {
    const tube = w * 0.42
    g = new THREE.TorusGeometry(r - tube, tube, 8, 18)
    g.rotateY(Math.PI / 2) // axle → X (mesh rotation stays identity; spin = rotation.x)
    torusCache.set(`tt${r}:${w}`, g)
  }
  return g
}

/** buildWheels — cylinder wheels rolled around X (rotation.z=π/2, spin = rotation.x), grouped per axle. */
function buildWheels(
  count: number,
  positions: Array<[number, number]>, // [x, z]; front axle = largest z (steers when opts.steer)
  radius: number,
  opts: { width?: number; steer?: boolean; rims?: boolean | 'front'; torus?: boolean } = {},
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
    const useTorus = opts.torus === true
    const tire = new THREE.Mesh(useTorus ? torusGeo(radius, width) : wheelGeo(radius, width), tireMat)
    if (!useTorus) tire.rotation.z = Math.PI / 2
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
/** v38 helper — a cylinder spanning two points (frame tubes, forks, exhaust…).
 *  Build-time only: outputs are merged straight into the body groups. */
function tube(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, seg = 7): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(r, r, Math.max(1e-4, Math.hypot(bx - ax, by - ay, bz - az)), seg)
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az)
  if (dir.lengthSq() > 1e-10) {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q))
  }
  g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2)
  return g
}
function merged(parts: THREE.BufferGeometry[], mat: THREE.Material, castShadow = true): THREE.Mesh {
  // mergeGeometries requires uniform indexedness AND uniform attribute sets —
  // RoundedBoxGeometry (v36) is non-indexed, so weld any non-indexed part into an
  // indexed geometry first (mergeVertices hashes positions and builds an index; no
  // toIndexed in three), and v38: strip uv so smoothExtrude outputs (UVs dropped)
  // can merge with primitive geometries (which carry uv) — every vehicle material
  // is untextured, so the attribute is dead weight everywhere in this pipeline.
  // (Caught live: the bike's painted merge mixed extrusions + boxes → null merge →
  // the tail/fenders/panels silently vanished, only parts[0] rendered.)
  const norm = parts.map(p => {
    const q = p.index ? p : mergeVertices(p, 1e-4) ?? p
    if (q.attributes.uv) q.deleteAttribute('uv')
    if (q.attributes.uv1) q.deleteAttribute('uv1')
    return q
  })
  const geo = mergeGeometries(norm, false)
  const mesh = new THREE.Mesh(geo ?? parts[0], mat)
  if (geo) for (const p of norm) p.dispose()
  mesh.castShadow = castShadow
  return mesh
}

const CAR_PALETTES = ['#d9a441', '#b5543a', '#93a67e', '#e8e2d4', '#6b4a3a'] // taxi-gold, dusty red, sage, cream, walnut (poster palette)
const chromeMat = flatMat('#b8b2a6', { metalness: 0.75, roughness: 0.22 })

// v66 — NPC DRIVERS & RIDERS: one merged geometry per pose, built ONCE and shared
// by every vehicle of that kind (geometry cache; only the kit material rotates
// through a small kurta palette per instance → 2 draw calls per occupied vehicle).
// Poses are authored around the seat origin facing +z (vehicle forward).
const driverKitCache = new Map<string, THREE.BufferGeometry>()
const driverSkinCache = new Map<string, THREE.BufferGeometry>()
const KURTA = ['#e8e2d4', '#8a6b45', '#4e7d6b', '#b5543a'] // poster-palette kurta set
function driverKitMat(variant: number) { return flatMat(KURTA[variant % KURTA.length], { roughness: 0.85 }) }
const driverSkinMat = flatMat('#c98d5f', { roughness: 0.8 })

function cachedFigure(kind: string, make: () => { kit: THREE.BufferGeometry; skin: THREE.BufferGeometry }) {
  let kit = driverKitCache.get(kind)
  if (!kit) {
    const g = make()
    driverKitCache.set(kind, g.kit)
    driverSkinCache.set(kind, g.skin)
    kit = g.kit
  }
  return { kit, skin: driverSkinCache.get(kind)! }
}

function mergeRaw(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const norm = parts.map(p => {
    const q = p.index ? p : mergeVertices(p, 1e-4) ?? p
    if (q.attributes.uv) q.deleteAttribute('uv')
    if (q.attributes.uv1) q.deleteAttribute('uv1')
    return q
  })
  return mergeGeometries(norm, false) ?? parts[0]
}

/** Seated driver (car): upright torso, arms reaching the wheel, cap. RHD seat origin. */
function seatedDriverFigure() {
  return cachedFigure('car', () => {
    const torso = new RoundedBoxGeometry(0.34, 0.5, 0.24, 2, 0.06).translate(0, 0.25, 0)
    const armL = tube(-0.15, 0.42, 0.06, -0.11, 0.36, 0.34, 0.045, 6)
    const armR = tube(0.15, 0.42, 0.06, 0.11, 0.36, 0.34, 0.045, 6)
    const cap = new THREE.CylinderGeometry(0.145, 0.155, 0.09, 8).translate(0, 0.575, 0.01)
    const kit = mergeRaw([torso, armL, armR, cap])
    const head = new THREE.SphereGeometry(0.125, 8, 6).translate(0, 0.49, 0.02)
    return { kit, skin: mergeRaw([head]) }
  })
}

/** Motorcycle rider: leaned-forward torso, arms to the grips, knees bent. */
function bikeRiderFigure() {
  return cachedFigure('bike', () => {
    const torso = new RoundedBoxGeometry(0.3, 0.46, 0.22, 2, 0.06)
    torso.rotateX(-0.32)
    torso.translate(0, 0.3, 0.05)
    const armL = tube(-0.14, 0.44, 0.16, -0.26, 0.32, 0.4, 0.04, 6)
    const armR = tube(0.14, 0.44, 0.16, 0.26, 0.32, 0.4, 0.04, 6)
    const thighL = box(0.1, 0.16, 0.3, -0.16, 0.08, 0.06)
    const thighR = box(0.1, 0.16, 0.3, 0.16, 0.08, 0.06)
    const shinL = box(0.08, 0.3, 0.1, -0.17, -0.16, 0.0)
    const shinR = box(0.08, 0.3, 0.1, 0.17, -0.16, 0.0)
    const cap = new THREE.SphereGeometry(0.135, 8, 6).translate(0, 0.585, 0.17)
    const kit = mergeRaw([torso, armL, armR, thighL, thighR, shinL, shinR, cap])
    const face = new THREE.SphereGeometry(0.105, 8, 6).translate(0, 0.56, 0.2)
    return { kit, skin: mergeRaw([face]) }
  })
}

/** Pillion passenger: upright torso behind the rider. */
function pillionFigure() {
  return cachedFigure('pillion', () => {
    const torso = new RoundedBoxGeometry(0.3, 0.44, 0.2, 2, 0.06).translate(0, 0.26, 0)
    const arms = tube(-0.13, 0.4, 0.08, -0.17, 0.34, 0.3, 0.038, 6)
    const arms2 = tube(0.13, 0.4, 0.08, 0.17, 0.34, 0.3, 0.038, 6)
    const legs = box(0.24, 0.34, 0.14, 0, -0.12, 0.02)
    const cap = new THREE.SphereGeometry(0.13, 8, 6).translate(0, 0.55, 0)
    const kit = mergeRaw([torso, arms, arms2, legs, cap])
    const face = new THREE.SphereGeometry(0.1, 8, 6).translate(0, 0.53, 0.03)
    return { kit, skin: mergeRaw([face]) }
  })
}

/** Auto-rickshaw driver: center seat, hands up to the handlebar. */
function autoDriverFigure() {
  return cachedFigure('auto', () => {
    const torso = new RoundedBoxGeometry(0.32, 0.46, 0.22, 2, 0.06).translate(0, 0.25, 0)
    const armL = tube(-0.14, 0.4, 0.05, -0.12, 0.34, 0.3, 0.042, 6)
    const armR = tube(0.14, 0.4, 0.05, 0.12, 0.34, 0.3, 0.042, 6)
    const cap = new THREE.CylinderGeometry(0.14, 0.15, 0.08, 8).translate(0, 0.55, 0.01)
    const kit = mergeRaw([torso, armL, armR, cap])
    const head = new THREE.SphereGeometry(0.12, 8, 6).translate(0, 0.47, 0.02)
    return { kit, skin: mergeRaw([head]) }
  })
}

/** Mount a cached figure: kit mesh (variant-tinted kurta) + skin mesh. */
function mountFigure(kind: string, variant: number): THREE.Group {
  const fig = kind === 'bike' ? bikeRiderFigure() : kind === 'pillion' ? pillionFigure() : kind === 'auto' ? autoDriverFigure() : seatedDriverFigure()
  const g = new THREE.Group()
  const kit = new THREE.Mesh(fig.kit, driverKitMat(variant))
  const skin = new THREE.Mesh(fig.skin, driverSkinMat)
  kit.castShadow = false
  skin.castShadow = false
  g.add(kit, skin)
  return g
}

/** buildCar v3 (v36) — real automotive construction via ExtrudeGeometry:
 *  the three-box side profile (bumper faces, curved nose, bonnet, cowl dip,
 *  rear deck, tail drop) is drawn as a Shape with WHEEL ARCHES cut into the
 *  outline, then extruded across the body width with a bevel and welded
 *  vertices → smooth rounded panel edges. Greenhouse is a separate blacked-out
 *  glass extrusion (modern stylized A/B/C pillars) with a painted roof panel on
 *  top. Clearcoat paint + env reflections finish it. Details kit kept from v35. */
function buildCar(variant: number): { group: THREE.Group; wheels: VehicleWheel[] } {
  const L = 3.9 + (variant % 3) * 0.25 // per-instance length variance
  const paint = carPaint(CAR_PALETTES[variant % CAR_PALETTES.length])
  const W = 1.58
  const belt = 0.96 // bonnet / boot top line — the cabin sits clearly above it
  // --- lower body: side-profile silhouette with real wheel arches ---
  const archZ = L * 0.315
  const archR = 0.42 // tire r=0.34 → tight 0.08 arch gap (real-car stance)
  const archY = 0.32
  const s = new THREE.Shape()
  s.moveTo(-L / 2 + 0.10, archY)
  s.lineTo(-archZ - archR, archY)
  s.absarc(-archZ, archY, archR, Math.PI, 0, true)      // rear wheel arch (over the top)
  s.lineTo(archZ - archR, archY)
  s.absarc(archZ, archY, archR, Math.PI, 0, true)       // front wheel arch
  s.lineTo(L / 2 - 0.10, archY)
  s.lineTo(L / 2 + 0.02, 0.52)                          // front bumper face
  s.quadraticCurveTo(L / 2 + 0.10, 0.72, L / 2 - 0.06, 0.88)   // nose curve
  s.quadraticCurveTo(L * 0.20, 0.99, L * 0.14, 0.97)    // bonnet slope
  s.quadraticCurveTo(0.0, 0.93, -L * 0.16, 0.96)        // cowl dip → beltline
  s.quadraticCurveTo(-L * 0.38, 1.01, -L / 2 + 0.06, 0.95) // rear deck
  s.quadraticCurveTo(-L / 2 - 0.06, 0.78, -L / 2 + 0.02, 0.60) // tail drop
  s.lineTo(-L / 2 + 0.10, archY)
  const bodyGeo = smoothExtrude(s, W, 0.05)
  const body = new THREE.Mesh(bodyGeo, paint)
  body.castShadow = true
  // --- greenhouse: blacked-out glass extrusion (raked windshield + rear glass) ---
  const g = new THREE.Shape()
  g.moveTo(L * 0.30, belt - 0.05)
  g.quadraticCurveTo(L * 0.26, belt + 0.27, L * 0.06, belt + 0.39) // raked windshield
  g.lineTo(-L * 0.12, belt + 0.41)                      // roof line
  g.quadraticCurveTo(-L * 0.28, belt + 0.37, -L * 0.40, belt - 0.03) // raked rear glass
  g.lineTo(L * 0.30, belt - 0.05)
  const cabinGeo = smoothExtrude(g, W - 0.18, 0.04)
  const cabin = new THREE.Mesh(cabinGeo, cabinGlassMat) // v66 — lighter glass so the driver reads inside
  cabin.castShadow = false
  // painted roof panel on top of the glass greenhouse → roofline step
  const roof = new THREE.Mesh(new RoundedBoxGeometry(W - 0.30, 0.07, L * 0.21, 2, 0.03), paint)
  roof.position.set(0, belt + 0.425, -L * 0.03)
  roof.castShadow = true
  const dark = merged([
    box(1.66, 0.2, 0.28, 0, 0.42, L / 2 - 0.02), box(1.66, 0.2, 0.28, 0, 0.42, -L / 2 + 0.02), // rubber bumper strips
    box(0.86, 0.16, 0.1, 0, 0.66, L / 2 + 0.02), // grille housing
    box(0.24, 0.05, 0.02, 0, 0.68, L / 2 + 0.075), box(0.24, 0.05, 0.02, 0, 0.62, L / 2 + 0.075), box(0.24, 0.05, 0.02, 0, 0.56, L / 2 + 0.075), // grille slats
    box(1.44, 0.2, L * 0.80, 0, 0.34, 0),        // chassis slab — fills the underbody between the wheels
    box(1.6, 0.09, L * 0.44, 0, 0.27, 0),        // side skirts
    box(0.03, 0.012, L * 0.34, 0.795, 0.74, L * 0.02), box(0.03, 0.012, L * 0.34, -0.795, 0.74, L * 0.02), // door seams (front)
    box(0.03, 0.012, L * 0.3, 0.795, 0.74, -L * 0.26), box(0.03, 0.012, L * 0.3, -0.795, 0.74, -L * 0.26), // door seams (rear)
    box(0.14, 0.045, 0.02, 0.62, 0.84, L * 0.14), box(0.14, 0.045, 0.02, -0.62, 0.84, L * 0.14),           // door handles
    box(0.05, 0.04, 0.06, 0.76, belt + 0.05, L * 0.16), box(0.05, 0.04, 0.06, -0.76, belt + 0.05, L * 0.16), // mirror stalks
    box(0.16, 0.11, 0.07, 0.86, belt + 0.09, L * 0.16), box(0.16, 0.11, 0.07, -0.86, belt + 0.09, L * 0.16), // mirrors
    box(0.4, 0.02, 0.05, 0.28, 0.91, L * 0.26, -0.5), box(0.4, 0.02, 0.05, -0.28, 0.91, L * 0.26, -0.5),   // wipers
  ], trimMat)
  const chrome = merged([
    box(0.5, 0.05, 0.06, 0, 0.76, L / 2 + 0.03), // grille centre bar
    new THREE.CylinderGeometry(0.05, 0.05, 0.24, 7).rotateX(Math.PI / 2).translate(-0.55, 0.36, -L / 2 - 0.1), // exhaust tip
    box(0.014, 0.3, 0.014, 0.6, belt + 0.46, -L * 0.24), // aerial
  ], chromeMat, false)
  const headlights = merged([
    box(0.4, 0.13, 0.08, 0.5, 0.78, L / 2 + 0.02), box(0.4, 0.13, 0.08, -0.5, 0.78, L / 2 + 0.02),          // main lamps
    new THREE.CylinderGeometry(0.07, 0.07, 0.06, 8).rotateX(Math.PI / 2).translate(0.55, 0.52, L / 2 + 0.03), // fog lamps
    new THREE.CylinderGeometry(0.07, 0.07, 0.06, 8).rotateX(Math.PI / 2).translate(-0.55, 0.52, L / 2 + 0.03),
  ], headlightMat, false)
  const taillights = merged([box(1.34, 0.11, 0.07, 0, 0.84, -L / 2 - 0.02)], taillightMat, false) // full-width light bar
  const plates: THREE.BufferGeometry[] = [box(0.4, 0.14, 0.04, 0, 0.5, L / 2 + 0.1), box(0.4, 0.14, 0.04, 0, 0.52, -L / 2 - 0.09)]
  if (variant % CAR_PALETTES.length === 0) plates.push(box(0.52, 0.15, 0.24, 0, belt + 0.52, -L * 0.03)) // taxi roof sign (gold flavour)
  const extras = variant % CAR_PALETTES.length === 3
    ? merged([box(0.05, 0.06, L * 0.4, 0.5, belt + 0.54, -L * 0.03), box(0.05, 0.06, L * 0.4, -0.5, belt + 0.54, -L * 0.03), box(0.05, 0.06, 1.0, 0, belt + 0.54, -L * 0.03)], chromeMat, false) // luggage rack (cream flavour)
    : null
  const w = buildWheels(4, [[-0.7, L * 0.315], [0.7, L * 0.315], [-0.7, -L * 0.32], [0.7, -L * 0.32]], 0.34, { width: 0.26, steer: true, rims: true, torus: true })
  const group = new THREE.Group()
  group.add(body, cabin, roof, dark, chrome, headlights, taillights, merged(plates, plateMat, false), w.group)
  if (extras) group.add(extras)
  // v66 — driver at the wheel (India RHD: right-hand seat), shared cached figure
  const drv = mountFigure('car', variant)
  drv.position.set(0.42, 0.62, L * 0.18)
  group.add(drv)
  return { group, wheels: w.wheels }
}

/** v36 helper — extrude a side-profile Shape across the body width with a bevel,
 *  weld coincident vertices and recompute smooth normals (UVs dropped: untextured). */
function smoothExtrude(shape: THREE.Shape, depth: number, bevel: number): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.9,
    bevelSegments: 3,
    curveSegments: 10,
  })
  geo.deleteAttribute('uv')
  const welded = mergeVertices(geo, 1e-4)
  if (welded) { geo.dispose(); geo = welded }
  geo.computeVertexNormals()
  geo.rotateY(-Math.PI / 2) // profile length (shape x) → world +Z (front), extrusion → X
  geo.computeBoundingBox()
  const bb = geo.boundingBox
  if (bb) geo.translate(-(bb.min.x + bb.max.x) / 2, 0, 0) // center across the width
  return geo
}

function buildBus(variant: number): { group: THREE.Group; wheels: VehicleWheel[] } {
  const L = 8.6
  const cream = flatMat('#e7ddc4', { roughness: 0.6, flatShading: false })
  cream.userData.envInt = 0.4
  const liveryMat = flatMat(variant % 2 ? '#7a3040' : '#3e6b4f', { roughness: 0.55, flatShading: false }) // maroon / green livery
  liveryMat.userData.envInt = 0.45
  const creamParts: THREE.BufferGeometry[] = [
    new RoundedBoxGeometry(2.36, 1.85, L, 2, 0.12).translate(0, 1.525, 0), // main body — rounded edges all around
    new RoundedBoxGeometry(2.3, 0.17, L - 0.1, 2, 0.06).translate(0, 2.535, 0), // roof cap
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
  // v35 realism kit — chrome + lamps + underbody details (merged, ~3 extra draw calls)
  const chromeBits = merged([
    box(1.9, 0.06, 0.06, 0, 1.06, L / 2 + 0.05),                        // front chrome bumper bar
    box(0.04, 0.06, L * 0.72, 1.21, 2.62, 0), box(0.04, 0.06, L * 0.72, -1.21, 2.62, 0), // roof rails
    box(0.06, 0.22, 0.9, 0, 0.42, 1.4),                                 // fuel tank
    box(0.5, 0.05, 0.02, 0, 2.06, L / 2 + 0.06),                        // windshield divider
  ], chromeMat, false)
  const grilleBits = merged([
    box(1.7, 0.05, 0.04, 0, 0.68, L / 2 + 0.06), box(1.7, 0.05, 0.04, 0, 0.6, L / 2 + 0.06), box(1.7, 0.05, 0.04, 0, 0.52, L / 2 + 0.06), // grille slats
    box(0.9, 0.04, 0.03, 0, 0.66, -L / 2 - 0.055), box(0.9, 0.04, 0.03, 0, 0.58, -L / 2 - 0.055),                                          // rear engine grille
  ], trimMat)
  const indicatorMat = flatMat('#d98a2b', { emissive: '#ff9d2e', emissiveIntensity: 0.7, roughness: 0.4 })
  const indicatorBits = merged([
    box(0.16, 0.12, 0.06, 1.02, 0.86, L / 2 + 0.05), box(0.16, 0.12, 0.06, -1.02, 0.86, L / 2 + 0.05),   // front indicators
    box(0.06, 0.1, 0.5, 1.21, 1.15, 2.55), box(0.06, 0.1, 0.5, -1.21, 1.15, 2.55),                        // side repeaters
  ], indicatorMat, false)
  const mudflaps = merged([
    box(0.34, 0.3, 0.03, 1.05, 0.32, -2.62), box(0.34, 0.3, 0.03, -1.05, 0.32, -2.62),
    box(0.34, 0.3, 0.03, 1.05, 0.32, -3.57), box(0.34, 0.3, 0.03, -1.05, 0.32, -3.57),
  ], trimMat, false)
  const w = buildWheels(6, [[-1.05, 2.9], [1.05, 2.9], [-1.05, -2.0], [1.05, -2.0], [-1.05, -2.95], [1.05, -2.95]], 0.5, { width: 0.32, steer: true, torus: true })
  const group = new THREE.Group()
  group.add(
    merged(creamParts, cream),
    merged([box(2.42, 0.5, L + 0.04, 0, 0.85, 0), box(2.42, 0.5, 0.3, 0, 1.1, L / 2 - 0.1), box(2.42, 0.5, 0.3, 0, 1.1, -L / 2 + 0.1)], liveryMat),
    merged(glassParts, glassMat, false),
    dark,
    chromeBits,
    grilleBits,
    indicatorBits,
    mudflaps,
    merged([box(0.36, 0.16, 0.07, 0.8, 0.78, L / 2 + 0.05), box(0.36, 0.16, 0.07, -0.8, 0.78, L / 2 + 0.05)], headlightMat, false),
    merged([box(0.36, 0.16, 0.07, 0.85, 0.95, -L / 2 - 0.05), box(0.36, 0.16, 0.07, -0.85, 0.95, -L / 2 - 0.05)], taillightMat, false),
    w.group,
  )
  // v66 — bus captain: skin head + cap above the dark driver silhouette (RHD, front right)
  const driverHead = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), driverSkinMat)
  driverHead.position.set(0.72, 1.9, 2.15)
  driverHead.castShadow = false
  const driverCap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.07, 8), driverKitMat(variant))
  driverCap.position.set(0.72, 2.0, 2.15)
  driverCap.castShadow = false
  group.add(driverHead, driverCap)
  return { group, wheels: w.wheels }
}

/** buildAuto v2 (v37) — proper auto-rickshaw construction with the car's extrusion
 *  technology: the classic silhouette (round snout, raked windscreen, long curved
 *  roof, rounded tail) drawn as side-profile Shapes with the front fender + rear
 *  wheel arches cut into the outline, extruded across the width with a bevel and
 *  welded. Delhi CNG livery: green body, yellow canopy, chrome cockpit kit, fare
 *  meter, roof luggage rails, taillight. Unlike the other vehicles the wheel set
 *  is lifted so the three tires rest ON the ground (proper stance). Merged
 *  primitive discipline — the body parts stay a handful of draw calls. */
function buildAuto(variant = 0): { group: THREE.Group; wheels: VehicleWheel[] } {
  const green = flatMat('#2f7050', { roughness: 0.45, flatShading: false }) // CNG body green
  green.userData.envInt = 0.5
  const yellow = flatMat('#e8b93a', { roughness: 0.45, flatShading: false }) // CNG canopy yellow
  yellow.userData.envInt = 0.5
  const FW = 1.02, RW = -0.98 // wheelbase z (front = +z)
  const archR = 0.38, archY = 0.33
  // --- green lower body: snout + footboard + passenger tub, wheel arches cut ---
  const b = new THREE.Shape()
  b.moveTo(-1.52, 0.34)
  b.lineTo(RW - archR, 0.34)
  b.absarc(RW, archY, archR, Math.PI, 0, true)       // rear wheel arch
  b.lineTo(FW - archR - 0.1, 0.34)                   // low footboard line between the axles
  b.absarc(FW, archY, archR, Math.PI, 0, true)       // front fender arch
  b.lineTo(1.44, 0.36)
  b.quadraticCurveTo(1.56, 0.52, 1.5, 0.8)           // round snout nose
  b.quadraticCurveTo(1.47, 1.0, 1.22, 1.04)          // cowl top
  b.lineTo(0.6, 0.99)                                // door-sill dip
  b.lineTo(-0.7, 1.05)                               // tub beltline
  b.lineTo(-1.44, 1.07)
  b.quadraticCurveTo(-1.58, 0.94, -1.52, 0.34)       // rounded tail drop
  const body = new THREE.Mesh(smoothExtrude(b, 1.42, 0.045), green)
  body.castShadow = true
  // --- yellow canopy: raked windscreen → long roof crown → curved rear drop ---
  const c = new THREE.Shape()
  c.moveTo(1.14, 1.0)
  c.lineTo(0.74, 1.68)                               // raked windscreen line
  c.quadraticCurveTo(0.2, 1.84, -0.5, 1.8)           // roof crown
  c.quadraticCurveTo(-1.3, 1.72, -1.5, 1.04)         // rear drop onto the tub
  c.lineTo(1.14, 1.0)
  const canopy = new THREE.Mesh(smoothExtrude(c, 1.26, 0.04), yellow)
  canopy.castShadow = true
  // --- glazing: raked windscreen + big tinted side openings (one merge) ---
  const glass = merged([
    box(0.88, 0.54, 0.04, 0, 1.34, 1.0, -0.5),       // windscreen (rides the canopy's raked line)
    box(0.03, 0.44, 1.46, 0.675, 1.33, -0.24),       // side openings (proud of the canopy face)
    box(0.03, 0.44, 1.46, -0.675, 1.33, -0.24),
  ], glassMat, false)
  // --- darks: twin underbody trays (slotted so the single front wheel shows),
  // rear fender lips, external footboard step ---
  const dark = merged([
    box(0.55, 0.28, 2.5, -0.425, 0.44, -0.1), box(0.55, 0.28, 2.5, 0.425, 0.44, -0.1),
    box(0.22, 0.16, 0.62, 0.70, 0.64, RW), box(0.22, 0.16, 0.62, -0.70, 0.64, RW),
    box(1.0, 0.05, 0.3, 0, 0.315, 0.3),
  ], trimMat)
  // --- chrome cockpit kit: handlebar, mirror, grab rail, exhaust tip ---
  const chromeBits = merged([
    box(0.05, 0.34, 0.05, 0, 1.14, 0.94, 0.35),      // steering column (raked)
    box(0.52, 0.04, 0.04, 0, 1.3, 0.87),             // handlebar
    box(0.09, 0.05, 0.09, 0.26, 1.3, 0.87), box(0.09, 0.05, 0.09, -0.26, 1.3, 0.87), // grips
    box(0.2, 0.04, 0.04, 0.70, 1.6, 0.84),           // mirror stalk (right side, rickshaw-style)
    box(0.04, 0.16, 0.26, 0.80, 1.6, 0.84),          // mirror head
    box(0.86, 0.04, 0.04, 0, 1.28, -1.55),           // rear passenger grab rail
    new THREE.CylinderGeometry(0.045, 0.05, 0.26, 7).rotateX(Math.PI / 2).translate(0.5, 0.3, -1.54), // exhaust tip
  ], chromeMat, false)
  // --- yellow trim: fare meter box, windscreen rails, roof luggage rails ---
  const trimBits = merged([
    box(0.3, 0.14, 0.4, 0, 1.13, 1.02),              // fare meter box atop the cowl
    box(0.9, 0.04, 0.04, 0, 1.62, 0.83, -0.5),       // windscreen top rail (raked)
    box(0.04, 0.5, 0.04, 0.44, 1.32, 1.0, -0.5), box(0.04, 0.5, 0.04, -0.44, 1.32, 1.0, -0.5), // windscreen side rails
    box(0.03, 0.03, 1.15, 0.38, 1.88, -0.32), box(0.03, 0.03, 1.15, -0.38, 1.88, -0.32),       // roof luggage rails
  ], yellow)
  // --- round headlamp in a chrome ring, low on the snout + red tail bar ---
  const headlamp = merged([
    new THREE.CylinderGeometry(0.085, 0.085, 0.05, 10).rotateX(Math.PI / 2).translate(0, 0.9, 1.52),
  ], headlightMat, false)
  const chromeRing = merged([new THREE.TorusGeometry(0.1, 0.02, 6, 12).translate(0, 0.9, 1.53)], chromeMat, false)
  const tail = merged([box(0.5, 0.09, 0.03, 0, 0.88, -1.58)], taillightMat, false)
  const plates = merged([box(0.32, 0.13, 0.04, 0, 0.62, -1.58)], plateMat, false)
  const w = buildWheels(3, [[0, FW], [-0.68, RW], [0.68, RW]], 0.3, { width: 0.16, steer: true, rims: 'front', torus: true })
  w.group.position.y = 0.3 // the rickshaw's own stance: tires rest on the ground
  const group = new THREE.Group()
  group.add(body, canopy, glass, dark, chromeBits, trimBits, headlamp, chromeRing, tail, plates, w.group)
  // v66 — auto driver behind the fare meter (open sides make him clearly visible)
  const drv = mountFigure('auto', variant)
  drv.position.set(0, 1.0, 0.55)
  group.add(drv)
  return { group, wheels: w.wheels }
}

const BIKE_PALETTES = ['#b5543a', '#2e6b4a', '#d9a441', '#e8e2d4'] // red, green, gold, cream (poster palette)

/** buildBike v3 (v38) — motorcycle rebuilt with the car's extrusion technology:
 *  fuel tank and tail unit are extruded side-profile Shapes (smooth rounded panels
 *  with a bevel), front/rear fenders are true ARCS — annular extrusions wrapping the
 *  wheels — and the chassis is real tube-frame geometry (spine, down tube, steering
 *  head, sub-frame, swingarm) with telescopic forks (chrome stanchions inside dark
 *  sliders), a finned single-cylinder engine, a down-then-up chrome exhaust with a
 *  raised muffler, over-damper rear shock springs, raised handlebar with a round
 *  nacelle headlamp, fly screen and mirrors. Clearcoat paint + env reflections match
 *  the approved car look. Merged-primitive discipline kept: 6 body draw calls. */
function buildBike(variant: number): { group: THREE.Group; wheels: VehicleWheel[] } {
  const paint = carPaint(BIKE_PALETTES[variant % BIKE_PALETTES.length])
  const AZ = 0.66 // axle z (wheelbase 1.32, front = +z)
  const AY = 0.33 // axle height (torus tires r = 0.33)
  // --- painted bodywork: extruded tank + tail, arced fenders, side panels ---
  const tank = new THREE.Shape()
  tank.moveTo(0.46, 0.9)
  tank.lineTo(0.41, 1.0)                              // dash-side front rise
  tank.quadraticCurveTo(0.26, 1.07, 0.08, 1.05)       // tank crown
  tank.quadraticCurveTo(-0.1, 1.03, -0.18, 0.94)      // rear taper into the seat
  tank.lineTo(-0.1, 0.87)
  tank.quadraticCurveTo(0.18, 0.83, 0.46, 0.9)        // knee-recess underside
  const tail = new THREE.Shape()
  tail.moveTo(-0.12, 0.86)
  tail.lineTo(-0.18, 0.95)                            // seat nose
  tail.quadraticCurveTo(-0.45, 0.99, -0.62, 0.96)     // rider seat
  tail.lineTo(-0.9, 1.04)                             // pillion tail kick
  tail.quadraticCurveTo(-1.03, 1.04, -1.02, 0.92)     // tail tip
  tail.quadraticCurveTo(-0.7, 0.79, -0.42, 0.79)      // underside
  tail.lineTo(-0.12, 0.86)
  const fenderArc = (cz: number, ro: number, ri: number, a0: number, a1: number) => {
    const f = new THREE.Shape()
    f.absarc(cz, AY, ro, a0, a1, false)               // outer arc over the wheel
    f.absarc(cz, AY, ri, a1, a0, true)                // inner arc back
    f.closePath()
    return smoothExtrude(f, 0.18, 0.02)
  }
  const painted = merged([
    smoothExtrude(tank, 0.3, 0.035),                  // fuel tank (wide, crowned)
    smoothExtrude(tail, 0.24, 0.03),                  // tail unit
    fenderArc(AZ, 0.46, 0.37, Math.PI * 0.3, Math.PI * 0.7),     // front fender arc
    fenderArc(-AZ, 0.42, 0.34, Math.PI * 0.36, Math.PI * 0.74), // rear fender arc
    box(0.03, 0.17, 0.32, 0.16, 0.68, -0.42), box(0.03, 0.17, 0.32, -0.16, 0.68, -0.42), // side panels
  ], paint)
  // --- dark chassis: tube frame, engine, fork sliders, swingarm, dampers, seat pads ---
  const dark = merged([
    tube(0, 0.93, 0.42, 0, 0.83, -0.32, 0.042),       // main spine
    tube(0, 1.05, 0.45, 0, 0.86, 0.5, 0.048),         // steering head
    tube(0, 0.88, 0.44, 0, 0.4, 0.26, 0.036),         // down tube to the engine mounts
    tube(0, 0.8, -0.34, 0, 0.92, -0.95, 0.032),       // rear sub-frame
    tube(0.09, 0.74, 0.55, 0.09, 0.36, 0.655, 0.038), tube(-0.09, 0.74, 0.55, -0.09, 0.36, 0.655, 0.038), // fork sliders
    box(0.24, 0.05, 0.12, 0, 1.05, 0.455),            // triple clamp
    tube(0.09, 0.4, -0.32, 0.09, AY, -AZ, 0.03), tube(-0.09, 0.4, -0.32, -0.09, AY, -AZ, 0.03), // swingarm
    tube(0.11, 0.4, -0.56, 0.11, 0.78, -0.42, 0.02), tube(-0.11, 0.4, -0.56, -0.11, 0.78, -0.42, 0.02), // shock damper rods
    new RoundedBoxGeometry(0.3, 0.26, 0.5, 2, 0.05).translate(0, 0.42, 0.06), // crankcase
    box(0.2, 0.22, 0.17, 0, 0.63, 0.13, 0.12),        // cylinder block (slight forward tilt)
    box(0.24, 0.014, 0.21, 0, 0.57, 0.145, 0.12), box(0.24, 0.014, 0.21, 0, 0.63, 0.13, 0.12), box(0.24, 0.014, 0.21, 0, 0.69, 0.115, 0.12), // cooling fins
    new RoundedBoxGeometry(0.24, 0.06, 0.52, 2, 0.025).translate(0, 1.0, -0.4),   // rider seat pad
    new RoundedBoxGeometry(0.22, 0.05, 0.3, 2, 0.02).translate(0, 1.07, -0.82),   // pillion pad
    tube(0.21, 1.18, 0.42, 0.3, 1.18, 0.42, 0.04), tube(-0.3, 1.18, 0.42, -0.21, 1.18, 0.42, 0.04), // grips
    new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6).rotateZ(Math.PI / 2).translate(0.2, 0.4, -0.08),  // foot pegs
    new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6).rotateZ(Math.PI / 2).translate(-0.2, 0.4, -0.08),
    box(0.12, 0.08, 0.04, 0, 1.0, -1.03),             // taillight housing
    box(0.1, 0.14, 0.03, 0.33, 1.33, 0.34), box(0.1, 0.14, 0.03, -0.33, 1.33, 0.34), // mirror heads
  ], trimMat)
  // --- chrome kit: stanchions, handlebar, exhaust, springs, cap, ring, mirror stalks ---
  const chrome = merged([
    tube(0.09, 0.94, 0.485, 0.09, 0.7, 0.56, 0.026), tube(-0.09, 0.94, 0.485, -0.09, 0.7, 0.56, 0.026), // fork stanchions
    tube(0, 1.05, 0.455, 0, 1.18, 0.42, 0.028),       // bar riser
    tube(-0.3, 1.18, 0.42, 0.3, 1.18, 0.42, 0.026),   // handlebar
    tube(0.15, 0.56, 0.2, 0.17, 0.3, 0.0, 0.03),      // exhaust header (down from the cylinder)
    tube(0.17, 0.3, 0.0, 0.17, 0.46, -0.78, 0.058, 9),// muffler rising to the tail
    tube(0.11, 0.42, -0.58, 0.11, 0.76, -0.44, 0.037), tube(-0.11, 0.42, -0.58, -0.11, 0.76, -0.44, 0.037), // shock springs
    new THREE.CylinderGeometry(0.045, 0.045, 0.02, 8).translate(0, 1.075, 0.1),   // fuel cap
    new THREE.TorusGeometry(0.1, 0.022, 6, 12).translate(0, 1.12, 0.61),          // headlamp ring
    tube(0.24, 1.18, 0.42, 0.33, 1.34, 0.34, 0.014, 5), tube(-0.24, 1.18, 0.42, -0.33, 1.34, 0.34, 0.014, 5), // mirror stalks
  ], chromeMat, false)
  const lamp = merged([
    new THREE.CylinderGeometry(0.1, 0.1, 0.07, 10).rotateX(Math.PI / 2).translate(0, 1.12, 0.585), // round headlamp
    box(0.14, 0.07, 0.03, 0, 1.0, -1.06),             // taillight lens
  ], headlightMat, false)
  const screen = merged([box(0.3, 0.14, 0.02, 0, 1.26, 0.5, -0.35)], glassMat, false) // fly screen
  const plates = merged([
    box(0.16, 0.13, 0.02, 0, 0.9, 0.74, -0.15),       // front plate under the headlamp
    box(0.2, 0.12, 0.02, 0, 0.86, -1.07),             // rear plate under the tail
  ], plateMat, false)
  const w = buildWheels(2, [[0, AZ], [0, -AZ]], 0.33, { width: 0.12, steer: true, rims: true, torus: true })
  const group = new THREE.Group()
  group.add(painted, dark, chrome, lamp, screen, plates, w.group)
  // v66 — rider astride the seat, hands on the grips; every other bike carries a pillion
  const rider = mountFigure('bike', variant)
  rider.position.set(0, 0.97, -0.3)
  group.add(rider)
  if (variant % 2 === 0) {
    const pill = mountFigure('pillion', variant + 1)
    pill.position.set(0, 1.07, -0.78)
    group.add(pill)
  }
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
  // road-safety collar: amber bell + reflective band so free-roaming cows read at night too
  const bellMat = new THREE.MeshStandardMaterial({ color: '#c9a02e', emissive: '#ffaa33', emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.3 })
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), bellMat)
  bell.position.set(0, 1.06, 0.92)
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 5, 10), bellMat)
  band.position.set(0, 1.16, 0.88)
  band.rotation.x = Math.PI / 2.4
  group.add(bell, band)
  return { group, wheels: [] }
}

export class VehicleSystem {
  group = new THREE.Group()
  vehicles: VehicleVisual[] = []
  onPlayerHit: ((kind: string, x: number, z: number, dmg: number) => void) | null = null
  /** v66 — spatial horn honks: fired by the deterministic per-vehicle scheduler in
   *  update() when the vehicle is near the player, and by the game on vehicle-player
   *  contact. The host maps kind → SfxName through AudioManager.playAt. */
  onHonk: ((kind: string, x: number, z: number) => void) | null = null
  private hitCooldown = 0

  constructor(world: WorldDef, renderer?: THREE.WebGLRenderer) {
    for (let i = 0; i < world.vehicles.length; i++) {
      const v = world.vehicles[i]
      const built = v.kind === 'bus' ? buildBus(i)
        : v.kind === 'cow' ? buildCow()
        : v.kind === 'auto' ? buildAuto(i)
        : v.kind === 'bike' ? buildBike(i)
        : buildCar(i) // 'car' kind (and safe fallback for any future kind)
      built.group.name = `vehicle-${v.kind}-${v.id}`
      this.group.add(built.group)
      const path = v.path.map(([px, pz]) => ({ x: px, z: pz }))
      const cum: number[] = [0]
      for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k].x - path[k - 1].x, path[k].z - path[k - 1].z))
      // v66 — closed-loop detection: ring-road routes repeat their first waypoint so
      // traffic circles the quadrant forever instead of ping-ponging.
      const closed = path.length > 2 && Math.hypot(path[0].x - path[path.length - 1].x, path[0].z - path[path.length - 1].z) < 0.5
      // deterministic honk phase from the route id (server/client agree without state)
      let hash = 0
      for (let k = 0; k < v.id.length; k++) hash = (hash * 31 + v.id.charCodeAt(k)) | 0
      this.vehicles.push({ id: v.id, kind: v.kind, group: built.group, path, cum, speed: v.speed, wheels: built.wheels, prevHeading: NaN, steer: 0, closed, honkOff: Math.abs(hash) % 17 })
    }
    // v36 — env reflections on vehicle materials only (world look untouched)
    if (renderer) {
      ensureVehicleEnv(renderer)
      applyVehicleEnv(this.group)
    }
  }

  /** Deterministic update from shared world time (seconds since match start).
   *  v37 — polyline traversal: constant speed along the waypoint chain, ping-pong
   *  at the ends. For a 2-point path this reduces EXACTLY to the old shuttle math
   *  (same formula the game-server mirrors), so existing routes are unchanged.
   *  v66 — closed loops (first waypoint repeats) traverse cyclically with no
   *  reversal, and every occupied vehicle honks on a deterministic schedule when
   *  the player is close. */
  update(worldTime: number, dt: number, playerPos: THREE.Vector3 | null, localAuth: boolean) {
    this.hitCooldown = Math.max(0, this.hitCooldown - dt)
    const step = Math.max(dt, 1e-4)
    for (const v of this.vehicles) {
      const total = v.cum[v.cum.length - 1]
      if (!(total > 0)) continue
      const period = v.closed ? total / v.speed : (total / v.speed) * 2
      const phase = ((worldTime % period) + period) % period
      const dir = v.closed ? 1 : (phase < period / 2 ? 1 : -1)
      const sDist = (v.closed ? phase : (phase < period / 2 ? phase : period - phase)) * v.speed // metres along the chain
      let i = 0
      while (i < v.path.length - 2 && sDist > v.cum[i + 1]) i++
      const segLen = v.cum[i + 1] - v.cum[i]
      const t = segLen > 0 ? Math.min(1, Math.max(0, (sDist - v.cum[i]) / segLen)) : 0
      const a = v.path[i], b = v.path[i + 1]
      const x = a.x + (b.x - a.x) * t
      const z = a.z + (b.z - a.z) * t
      v.group.position.set(x, 0, z)
      const heading = Math.atan2(b.x - a.x, b.z - a.z) * dir
      // body yaw eases toward the target heading (shortest arc) — corners read as
      // real turns instead of snaps; client-visual only (server uses positions).
      if (Number.isFinite(v.prevHeading)) {
        let dh = heading - v.group.rotation.y
        while (dh > Math.PI) dh -= Math.PI * 2
        while (dh < -Math.PI) dh += Math.PI * 2
        v.group.rotation.y += dh * Math.min(1, step * 7)
      } else {
        v.group.rotation.y = heading
      }
      // steer angle ≈ signed turn rate of the target heading, clamped ±0.5 rad
      if (Number.isFinite(v.prevHeading)) {
        let dh = heading - v.prevHeading
        while (dh > Math.PI) dh -= Math.PI * 2
        while (dh < -Math.PI) dh += Math.PI * 2
        const turn = Math.max(-0.5, Math.min(0.5, dh / step))
        v.steer += (turn - v.steer) * Math.min(1, step * 7)
      }
      v.prevHeading = heading
      // wheels spin by actual travel speed; front pivots take the steer angle
      for (const w of v.wheels) {
        w.spin.rotation.x += (v.speed * dt) / w.radius
        if (w.steers) w.pivot.rotation.y = v.steer
      }
      // collision with local player (per-kind ring + damage, mirrored server-side)
      if (playerPos && localAuth && this.hitCooldown <= 0) {
        const hit = VEHICLE_HIT[v.kind] ?? { r: 1.7, dmg: 35 }
        const d = Math.hypot(playerPos.x - x, playerPos.z - z)
        if (d < hit.r) {
          this.hitCooldown = 1.2
          this.onHonk?.(v.kind, x, z) // v66 — angry honk on contact
          this.onPlayerHit?.(v.kind, x, z, hit.dmg)
        }
      }
      // v66 — proximity honks: deterministic worldTime scheduler (no per-vehicle
      // state, identical on every client), gated to vehicles near the player so the
      // city sounds alive without an honk wall. Cows moo via the animal system — skip.
      if (v.kind !== 'cow' && playerPos && localAuth) {
        const d2 = (playerPos.x - x) * (playerPos.x - x) + (playerPos.z - z) * (playerPos.z - z)
        if (d2 < 34 * 34) {
          const iv = v.kind === 'bike' ? 8.5 : v.kind === 'auto' ? 9.5 : v.kind === 'bus' ? 14 : 12
          const t = (worldTime + v.honkOff) % iv
          if (t < step) this.onHonk?.(v.kind, x, z)
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
