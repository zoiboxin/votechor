// VoteChor forest — v112 CARTOON REBUILD ("remove all .glb, smooth and
// lightweight"). The 38 GLB plant models are GONE: every tree/pine/dead tree/
// log/stick/bush/grass tuft is now a tiny PROCEDURAL low-poly mesh — merged
// vertex-colored geometry (one shared MeshLambertMaterial across ALL species,
// flat-shaded cartoon look). Each species renders as ONE InstancedMesh, so the
// whole forest is ~7 draw calls and ~0 MB of downloads.
//
// HABITATS (unchanged from v110):
//   • DEEP WILD (wildness ≥ 0.55 — the Vanodyan Deep and the far ring):
//     pine groves, dead trees, fallen trunks, logs and stick litter.
//   • FRINGE (0.18 ≤ wildness < 0.55 — where fields thin into forest):
//     broadleaf trees, bushes, grass tufts, the odd log.
//   • CITY BAND (wildness < 0.18): NO trees (buildings own the skyline) —
//     low bushes + grass tufts along the open sidewalk margins only.
//   • GRAVEYARD ring: dead trees haunt the Kabristan fence (r+6..r+30).
//
// All placement is rejection-sampled clear of roads (spine, cross streets,
// ring road), the Bhayanak river band, the arena-exit corridor, the spawn
// plaza and the graveyard interior, and every instance is ground-snapped.
// A seeded RNG (mulberry32) keeps a session's forest stable once built.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GRAVEYARD, WORLD_DISC } from './shared/constants'
import { wildnessAt } from './jungle-ambience'
import type { PhysicsWorld } from './physics'

/** Deterministic RNG so a built forest stays put for the whole session. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- procedural cartoon flora kit ----------
// One shared flat material for the entire forest (vertex colors carry the
// palette) — every species is a merged, vertex-colored BufferGeometry.
const FOREST_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })

const G_BOX = new THREE.BoxGeometry(1, 1, 1)
const G_CYL = new THREE.CylinderGeometry(0.5, 0.62, 1, 6)
const G_CONE = new THREE.ConeGeometry(0.5, 1, 6)
const G_SPH = new THREE.SphereGeometry(0.5, 7, 5)
const G_ICO = new THREE.IcosahedronGeometry(0.5, 0)

const _c = new THREE.Color()
function paint(geo: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const n = geo.attributes.position.count
  const colors = new Float32Array(n * 3)
  _c.set(hex)
  for (let i = 0; i < n; i++) {
    colors[i * 3] = _c.r
    colors[i * 3 + 1] = _c.g
    colors[i * 3 + 2] = _c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _s = new THREE.Vector3()
interface Piece {
  geo: THREE.BufferGeometry
  hex: string
  px?: number; py?: number; pz?: number
  rx?: number; ry?: number; rz?: number
  sx?: number; sy?: number; sz?: number
}
function merge(parts: Piece[]): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = []
  for (const p of parts) {
    const g = p.geo.clone()
    _q.setFromEuler(_e.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0))
    _v.set(p.px ?? 0, p.py ?? 0, p.pz ?? 0)
    _s.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1)
    _m.compose(_v, _q, _s)
    g.applyMatrix4(_m)
    geos.push(paint(g, p.hex))
  }
  const merged = mergeGeometries(geos, false)
  for (const g of geos) g.dispose()
  return merged ?? paint(G_BOX.clone(), '#4a6b3a')
}

/** Species builders — each returns ONE merged geometry (origin at ground). */
function buildPine(): THREE.BufferGeometry {
  return merge([
    { geo: G_CYL, hex: '#6b4a2e', py: 0.55, sx: 0.26, sy: 1.1, sz: 0.26 },
    { geo: G_CONE, hex: '#3d6b35', py: 1.55, sx: 1.5, sy: 1.9, sz: 1.5 },
    { geo: G_CONE, hex: '#4a7d3f', py: 2.6, sx: 1.05, sy: 1.5, sz: 1.05 },
    { geo: G_CONE, hex: '#558d47', py: 3.5, sx: 0.62, sy: 1.1, sz: 0.62 },
  ])
}
function buildTree(): THREE.BufferGeometry {
  return merge([
    { geo: G_CYL, hex: '#7a5636', py: 0.9, sx: 0.3, sy: 1.8, sz: 0.3 },
    { geo: G_SPH, hex: '#5d8f43', py: 2.25, sx: 2.0, sy: 1.7, sz: 2.0 },
    { geo: G_SPH, hex: '#6b9e4c', py: 2.9, px: 0.55, sz: 1.35, sy: 1.15, sx: 1.35 },
    { geo: G_SPH, hex: '#527f3c', py: 2.75, px: -0.6, pz: 0.3, sz: 1.15, sy: 1.0, sx: 1.15 },
  ])
}
function buildDeadTree(): THREE.BufferGeometry {
  return merge([
    { geo: G_CYL, hex: '#6e6258', py: 1.15, sx: 0.24, sy: 2.3, sz: 0.24, rz: 0.06 },
    { geo: G_CYL, hex: '#7a6e62', py: 1.9, px: 0.34, sx: 0.1, sy: 1.0, sz: 0.1, rz: -0.85 },
    { geo: G_CYL, hex: '#7a6e62', py: 2.15, px: -0.3, sx: 0.09, sy: 0.85, sz: 0.09, rz: 0.95 },
    { geo: G_CYL, hex: '#6e6258', py: 2.75, sx: 0.08, sy: 0.7, sz: 0.08, rz: 0.22 },
  ])
}
function buildLog(): THREE.BufferGeometry {
  return merge([
    { geo: G_CYL, hex: '#7a5636', py: 0.22, rz: Math.PI / 2, sx: 0.44, sy: 1.7, sz: 0.44 },
  ])
}
function buildStick(): THREE.BufferGeometry {
  return merge([
    { geo: G_CYL, hex: '#6e5a42', py: 0.1, rz: Math.PI / 2, sx: 0.1, sy: 0.85, sz: 0.1, ry: 0.4 },
  ])
}
function buildBush(): THREE.BufferGeometry {
  return merge([
    { geo: G_ICO, hex: '#4a7d3f', py: 0.42, sx: 1.1, sy: 0.85, sz: 1.1 },
    { geo: G_ICO, hex: '#558d47', py: 0.6, px: 0.3, sx: 0.7, sy: 0.6, sz: 0.7 },
  ])
}
function buildGrass(): THREE.BufferGeometry {
  return merge([
    { geo: G_CONE, hex: '#6b9e4c', py: 0.16, px: -0.08, sx: 0.16, sy: 0.42, sz: 0.16, rz: 0.14 },
    { geo: G_CONE, hex: '#7aad57', py: 0.2, sx: 0.18, sy: 0.55, sz: 0.18 },
    { geo: G_CONE, hex: '#6b9e4c', py: 0.14, px: 0.1, sx: 0.15, sy: 0.38, sz: 0.15, rz: -0.16 },
  ])
}

interface SpeciesDef {
  build: () => THREE.BufferGeometry
  /** [min, max] uniform instance scale */
  scale: [number, number]
  /** instance budget per zone */
  deep?: number
  fringe?: number
  city?: number
  grave?: number
}

const SPECIES: SpeciesDef[] = [
  // broadleaf trees — the fringe's woodland
  { build: buildTree, scale: [0.8, 1.5], fringe: 34 },
  // pines — the deep wild's conifer groves
  { build: buildPine, scale: [0.9, 1.6], deep: 80 },
  { build: buildPine, scale: [0.7, 1.3], deep: 60 },
  // the dead — Vanodyan Deep litter + the Kabristan's haunting row
  { build: buildDeadTree, scale: [0.9, 1.5], deep: 30, grave: 16 },
  // ground litter
  { build: buildLog, scale: [1.0, 1.7], deep: 26, fringe: 10 },
  { build: buildStick, scale: [1.0, 2.0], deep: 60 },
  // understory — bushes everywhere the ground is soft, grass tufts too
  { build: buildBush, scale: [0.8, 1.4], fringe: 42, city: 16 },
  { build: buildGrass, scale: [0.8, 1.6], fringe: 48, city: 14 },
]

const CROSS_ROAD_Z = [-78, -198, -286, -452]

/** Common placement guard: inside the disc, clear of every road, the river,
 *  the arena exit, the spawn plaza, the graveyard interior and the city spine. */
function placeable(x: number, z: number): boolean {
  const dx = x - WORLD_DISC.cx
  const dz = z - WORLD_DISC.cz
  if (dx * dx + dz * dz > (WORLD_DISC.r - 26) * (WORLD_DISC.r - 26)) return false
  if (Math.abs(x) < 13.5 && z < 40 && z > -566) return false // spine + city corridor
  for (const cz of CROSS_ROAD_Z) if (Math.abs(z - cz) < 9 && Math.abs(x) < 176) return false
  if (z < 44 && Math.abs(Math.abs(x) - 166) < 13) return false // ring roads
  if (Math.abs(x) < 214 && z < -662 && z > -712) return false // river band
  if (Math.abs(x) < 46 && z < -564) return false // arena exit + south trail head
  if (x * x + (z + 8) * (z + 8) < 14 * 14) return false // spawn plaza
  const gx = x - GRAVEYARD.x
  const gz = z - GRAVEYARD.z
  if (gx * gx + gz * gz < (GRAVEYARD.r + 4) * (GRAVEYARD.r + 4)) return false // grave interior
  return true
}

function wildBand(x: number, z: number, min: number, max: number): boolean {
  const w = wildnessAt(x, z)
  return w >= min && (max === Infinity || w < max)
}

export class ForestPack {
  readonly group = new THREE.Group()
  private physics: PhysicsWorld
  private meshes: THREE.InstancedMesh[] = []
  private geos: THREE.BufferGeometry[] = []
  private started = false
  private disposed = false

  constructor(physics: PhysicsWorld) {
    this.physics = physics
    this.group.name = 'vc-forest'
  }

  /** Idempotent start — the build is SYNCHRONOUS now (no GLB streams): the
   *  whole forest lands on the first match frame, ~7 draw calls total. */
  ensureStarted(): void {
    if (this.started || this.disposed) return
    this.started = true
    this.build()
  }

  private build(): void {
    const rand = mulberry32(0x0ce7110) // deterministic per session
    for (const sp of SPECIES) {
      if (this.disposed) return
      const zones: Array<{ n: number; sample: () => { x: number; z: number } | null }> = []
      if (sp.deep) zones.push({ n: sp.deep, sample: () => this.sampleIn(0.55, Infinity, rand) })
      if (sp.fringe) zones.push({ n: sp.fringe, sample: () => this.sampleIn(0.18, 0.55, rand) })
      if (sp.grave) zones.push({ n: sp.grave, sample: () => this.sampleGrave(rand) })
      if (sp.city) zones.push({ n: sp.city, sample: () => this.sampleCity(rand) })
      const total = zones.reduce((s, z) => s + z.n, 0)
      if (total <= 0) continue
      const geo = sp.build()
      this.geos.push(geo)
      const inst = new THREE.InstancedMesh(geo, FOREST_MAT, total)
      inst.castShadow = false
      inst.receiveShadow = false
      const m4 = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      const up = new THREE.Vector3(0, 1, 0)
      const pos = new THREE.Vector3()
      const scl = new THREE.Vector3()
      let i = 0
      for (const zone of zones) {
        for (let n = 0; n < zone.n; n++) {
          const spot = zone.sample()
          if (!spot) continue
          const y = this.physics.groundHeight(spot.x, spot.z, 40)
          const s = sp.scale[0] + rand() * (sp.scale[1] - sp.scale[0])
          pos.set(spot.x, y, spot.z)
          q.setFromAxisAngle(up, rand() * Math.PI * 2)
          scl.set(s, s, s)
          m4.compose(pos, q, scl)
          inst.setMatrixAt(i++, m4)
        }
      }
      inst.count = i // zones that ran out of samples just shrink
      inst.instanceMatrix.needsUpdate = true
      inst.computeBoundingSphere()
      this.group.add(inst)
      this.meshes.push(inst)
    }
    // QA affordance: forest census for __vcDiag
    try {
      const w = window as unknown as { __vcDiag?: Array<Record<string, unknown>> }
      w.__vcDiag = w.__vcDiag ?? []
      w.__vcDiag.push({
        kind: 'forestCensus',
        species: this.meshes.length,
        instances: this.meshes.reduce((s, m) => s + m.count, 0),
        t: Date.now(),
      })
    } catch { /* best-effort */ }
  }

  /** Rejection-sample the wild band [minW, maxW) inside the disc. */
  private sampleIn(minW: number, maxW: number, rand: () => number): { x: number; z: number } | null {
    for (let t = 0; t < 40; t++) {
      const x = WORLD_DISC.cx + (rand() * 2 - 1) * (WORLD_DISC.r - 40)
      const z = WORLD_DISC.cz + (rand() * 2 - 1) * (WORLD_DISC.r - 40)
      if (!placeable(x, z)) continue
      if (!wildBand(x, z, minW, maxW)) continue
      return { x, z }
    }
    return null
  }

  /** Dead trees ring the Kabristan fence: r+6 .. r+30, any bearing. */
  private sampleGrave(rand: () => number): { x: number; z: number } | null {
    for (let t = 0; t < 40; t++) {
      const a = rand() * Math.PI * 2
      const r = GRAVEYARD.r + 6 + rand() * 24
      const x = GRAVEYARD.x + Math.cos(a) * r
      const z = GRAVEYARD.z + Math.sin(a) * r
      if (placeable(x, z)) return { x, z }
    }
    return null
  }

  /** City understory: bushes/grass along the open sidewalk margins (the same
   *  corridor the street animals use), never on the asphalt or cross roads. */
  private sampleCity(rand: () => number): { x: number; z: number } | null {
    for (let t = 0; t < 40; t++) {
      const x = (rand() < 0.5 ? -1 : 1) * (10.5 + rand() * 5)
      const z = -60 - rand() * 480
      if (!placeable(x, z)) continue
      return { x, z }
    }
    return null
  }

  dispose(): void {
    this.disposed = true
    for (const m of this.meshes) {
      this.group.remove(m)
      m.dispose()
    }
    for (const g of this.geos) g.dispose()
    this.meshes = []
    this.geos = []
  }
}
