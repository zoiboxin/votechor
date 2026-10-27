// VoteChor forest — task 110: the user's AmiPolyGon Forest Free Pack (38 GLB
// species: trees, pines, dead trees, trunks, logs, sticks, bushes, grass)
// scattered across the world as GPU-INSTANCED clusters. Every model is a
// single mesh + single material (verified from the GLB JSON), so each species
// becomes ONE InstancedMesh — ~1350 plants in ~38 draw calls total.
//
// HABITATS (mirrors the wildlife grouping):
//   • DEEP WILD (wildness ≥ 0.55 — the Vanodyan Deep and the far ring):
//     pine groves, dead trees, fallen trunks, logs and stick litter.
//   • FRINGE (0.18 ≤ wildness < 0.55 — where fields thin into forest):
//     broadleaf trees mixed into the existing woodland, bushes, grass tufts,
//     the odd log.
//   • CITY BAND (wildness < 0.18): NO trees (buildings own the skyline) —
//     low bushes + grass tufts along the open sidewalk margins only.
//   • GRAVEYARD ring: dead trees haunt the Kabristan fence (r+6..r+30).
//
// All placement is rejection-sampled clear of roads (spine, cross streets,
// ring road), the Bhayanak river band, the arena-exit corridor, the spawn
// plaza and the graveyard interior, and every instance is ground-snapped.
// A seeded RNG (mulberry32) keeps a session's forest stable once built.
import * as THREE from 'three'
import { GRAVEYARD, WORLD_DISC } from './shared/constants'
import { wildnessAt } from './jungle-ambience'
import type { GLBAssetManager, GLBAsset } from './glb'
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

interface SpeciesDef {
  file: string
  /** [min, max] uniform instance scale */
  scale: [number, number]
  /** instance budget per zone */
  deep?: number
  fringe?: number
  city?: number
  grave?: number
}

const SPECIES: SpeciesDef[] = [
  // broadleaf trees — the fringe's new woodland species
  { file: 'tree_1.glb', scale: [0.8, 1.5], fringe: 34 },
  { file: 'tree_2.glb', scale: [0.8, 1.5], fringe: 34 },
  { file: 'tree_3.glb', scale: [0.8, 1.5], fringe: 34 },
  { file: 'tree_4.glb', scale: [0.8, 1.5], fringe: 30 },
  { file: 'tree_5.glb', scale: [0.8, 1.4], fringe: 26 },
  { file: 'tree_6.glb', scale: [0.8, 1.4], fringe: 26 },
  // pines — the deep wild's conifer groves
  { file: 'tree_pine_1.glb', scale: [0.9, 1.6], deep: 70 },
  { file: 'tree_pine_2.glb', scale: [0.9, 1.6], deep: 70 },
  { file: 'tree_pine_3.glb', scale: [0.9, 1.6], deep: 70 },
  // the dead — Vanodyan Deep litter + the Kabristan's haunting row
  { file: 'dead_tree_1.glb', scale: [0.9, 1.5], deep: 18, grave: 10 },
  { file: 'dead_tree_2.glb', scale: [0.9, 1.5], deep: 18, grave: 10 },
  { file: 'dead_tree_3.glb', scale: [0.9, 1.5], deep: 18, grave: 10 },
  { file: 'trunk_1.glb', scale: [1.0, 1.6], deep: 16 },
  { file: 'trunk_2.glb', scale: [1.0, 1.6], deep: 16 },
  { file: 'trunk_3.glb', scale: [1.0, 1.6], deep: 16 },
  { file: 'trunk_4.glb', scale: [1.0, 1.6], deep: 16 },
  { file: 'log_1.glb', scale: [1.0, 1.7], deep: 12, fringe: 8 },
  { file: 'log_2.glb', scale: [1.0, 1.7], deep: 12, fringe: 8 },
  { file: 'log_3.glb', scale: [1.0, 1.7], deep: 12, fringe: 8 },
  { file: 'log_4.glb', scale: [1.0, 1.7], deep: 12, fringe: 8 },
  { file: 'stick_1.glb', scale: [1.0, 2.0], deep: 45 },
  { file: 'stick_2.glb', scale: [1.0, 2.0], deep: 45 },
  { file: 'stick_3.glb', scale: [1.0, 2.0], deep: 45 },
  // understory — bushes everywhere the ground is soft, grass tufts too
  { file: 'bush_1.glb', scale: [0.8, 1.4], fringe: 30, city: 14 },
  { file: 'bush_2.glb', scale: [0.8, 1.4], fringe: 30, city: 14 },
  { file: 'bush_3.glb', scale: [0.8, 1.4], fringe: 30, city: 12 },
  { file: 'bush_4.glb', scale: [0.8, 1.4], fringe: 30, city: 12 },
  { file: 'grass_1.glb', scale: [0.8, 1.6], fringe: 26, city: 10 },
  { file: 'grass_2.glb', scale: [0.8, 1.6], fringe: 26, city: 10 },
  { file: 'grass_3.glb', scale: [0.8, 1.6], fringe: 26, city: 10 },
  { file: 'grass_4.glb', scale: [0.8, 1.6], fringe: 26, city: 10 },
  { file: 'grass_5.glb', scale: [0.8, 1.6], fringe: 26, city: 10 },
  { file: 'grass_6.glb', scale: [0.8, 1.6], fringe: 26, city: 10 },
  { file: 'grass_7.glb', scale: [0.8, 1.6], fringe: 26, city: 10 },
  { file: 'grass_8.glb', scale: [0.8, 1.6], fringe: 26, city: 10 },
  { file: 'grass_9.glb', scale: [0.8, 1.6], fringe: 26, city: 10 },
  { file: 'grass_10.glb', scale: [0.8, 1.6], fringe: 26, city: 10 },
  { file: 'grass_11.glb', scale: [0.8, 1.6], fringe: 26, city: 10 },
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
  private mgr: GLBAssetManager
  private physics: PhysicsWorld
  private meshes: THREE.InstancedMesh[] = []
  private started = false
  private disposed = false

  constructor(mgr: GLBAssetManager, physics: PhysicsWorld) {
    this.mgr = mgr
    this.physics = physics
    this.group.name = 'vc-forest'
  }

  /** Idempotent start — the forest is pure static ambience (no per-frame work),
   *  so it only needs the one async build on the first match frame. */
  ensureStarted(): void {
    if (this.started || this.disposed) return
    this.started = true
    void this.build()
  }

  private async build(): Promise<void> {
    const rand = mulberry32(0x0ce7110) // deterministic per session
    for (const sp of SPECIES) {
      if (this.disposed) return
      const asset: GLBAsset | null = await this.mgr.load(`/models/forest/${sp.file}`)
      if (!asset) continue
      // every pack model is a single mesh + single material (verified) — pull
      // them out once; the InstancedMesh shares them across ALL instances
      let geo: THREE.BufferGeometry | null = null
      let mat: THREE.Material | null = null
      asset.scene.traverse((o) => {
        if (!geo && (o as THREE.Mesh).isMesh) {
          const m = o as THREE.Mesh
          geo = m.geometry
          mat = (Array.isArray(m.material) ? m.material[0] : m.material) ?? null
        }
      })
      if (!geo || !mat) continue
      const zones: Array<{ n: number; sample: () => { x: number; z: number } | null }> = []
      if (sp.deep) zones.push({ n: sp.deep, sample: () => this.sampleIn(0.55, Infinity, rand) })
      if (sp.fringe) zones.push({ n: sp.fringe, sample: () => this.sampleIn(0.18, 0.55, rand) })
      if (sp.grave) zones.push({ n: sp.grave, sample: () => this.sampleGrave(rand) })
      if (sp.city) zones.push({ n: sp.city, sample: () => this.sampleCity(rand) })
      const total = zones.reduce((s, z) => s + z.n, 0)
      const inst = new THREE.InstancedMesh(geo, mat, total)
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
      m.dispose() // frees instance buffers only — geometry/material stay in the GLB cache
    }
    this.meshes = []
  }
}
