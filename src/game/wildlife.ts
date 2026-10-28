// VoteChor wildlife — v112 CARTOON REBUILD ("remove all .glb, keep the game
// cartoon for kids, smooth and lightweight"). The 10 GLB species are GONE:
// every beast is now a tiny procedural low-poly cartoon animal built from a
// handful of shared unit geometries (box / sphere / cone) + cached flat
// materials — zero downloads, zero textures, zero skinned meshes, zero
// AnimationMixers. A full beast is ~12 meshes of stock geometry, so the whole
// system costs less GPU memory than ONE of the old GLB files.
//
// Everything the player loved is preserved 1:1:
//   • HABITATS (v109 grouping): PETS inside the city streets (shiba + husky at
//     the proven street corners), DOMESTIC herds on BOTH flanks (city-edge
//     pasture + farm-belt pasture), JUNGLE wanderers (fox/deer/stag/wolf)
//     rejection-sampled into the wild every session.
//   • PANIC-FLEE: species temperament radius → bolt + re-aim while chased +
//     home leash + spatial moo/bark voice.
//   • Idle/walk/eat life loop — now animated PROCEDURALLY: sinusoid leg
//     swings (diagonal pairs), body bob, head-dip grazing, tail wag.
//   • Distance LOD: invisible beyond 190 m, anim math skipped beyond 140 m.
//   • The one-shot __vcDiag 'wildlifeCensus' for console diagnosis.
//
// FACING: beasts face +Z at ry=0 (head at +z, tail at −z) — the same
// VoteChor heading convention as every character (ry = atan2(vx, vz)).
import * as THREE from 'three'
import { GRAVEYARD, WORLD_DISC } from './shared/constants'
import { wildnessAt } from './jungle-ambience'
import { AudioManager, type SfxName } from './audio'
import type { PhysicsWorld } from './physics'

type Habitat = 'pet' | 'domestic' | 'jungle'

type EarStyle = 'round' | 'point' | 'long' | 'none'
type TailStyle = 'stub' | 'curl' | 'bushy' | 'long'
type HornStyle = 'none' | 'bovine' | 'antler'

interface BeastDef {
  id: string
  count: number
  /** wander speed (m/s) — plausibly scaled to species size */
  speed: number
  habitat: Habitat
  /** player distance (m) inside which the beast panics and bolts */
  panicR: number
  /** flight speed multiplier over `speed` while fleeing */
  fleeMul: number
  /** max distance (m) from home the beast may ever stray (panic leash) */
  leash: number
  /** spatial voice played when the panic starts (null = silent species) */
  voice: SfxName | null
  /** PETS: one member per street corner (count must match the list) */
  petSites?: Array<[number, number]>
  /** DOMESTIC: the city-edge pasture [x, z] */
  cityHerd?: [number, number]
  /** DOMESTIC: the farm-belt pasture [x, z] */
  farmHerd?: [number, number]
  cityCount?: number
  farmCount?: number
  // ---- cartoon body spec (meters) ----
  bodyLen: number
  bodyW: number
  bodyH: number
  legLen: number
  legW: number
  headR: number
  ears: EarStyle
  tail: TailStyle
  horns: HornStyle
  hump?: boolean
  mane?: boolean
  palette: { body: string; accent: string; dark: string }
}

const BEASTS: BeastDef[] = [
  // ---- CITY PETS: cartoon dogs live IN the streets, at the same proven
  //      street-animal corners the procedural dogs/cats have used since v66
  { id: 'shiba', count: 3, speed: 1.4, habitat: 'pet', panicR: 6.0, fleeMul: 2.8, leash: 20, voice: 'bark',
    petSites: [[8, -66], [-7, -188], [10, -462]],       // plaza side · market exit · colony cross
    bodyLen: 0.55, bodyW: 0.26, bodyH: 0.3, legLen: 0.2, legW: 0.07, headR: 0.17,
    ears: 'point', tail: 'curl', horns: 'none',
    palette: { body: '#d98e4a', accent: '#f2e3c8', dark: '#3a2e26' } },
  { id: 'husky', count: 2, speed: 1.6, habitat: 'pet', panicR: 6.5, fleeMul: 2.8, leash: 22, voice: 'bark',
    petSites: [[-12, -272], [11, -516]],                // avenue cross · parliament approach
    bodyLen: 0.64, bodyW: 0.28, bodyH: 0.32, legLen: 0.24, legW: 0.08, headR: 0.18,
    ears: 'point', tail: 'bushy', horns: 'none',
    palette: { body: '#8a8f98', accent: '#e8e6e0', dark: '#2e3238' } },
  // ---- DOMESTIC HERDS: every species grazes BOTH flanks — a city-edge
  //      pasture just off the avenue corridor AND a farm-belt pasture out
  //      among the Zone-B countryside fields ("cow near horse donkey near city")
  { id: 'cow', count: 4, speed: 0.9, habitat: 'domestic', panicR: 4.6, fleeMul: 2.2, leash: 24, voice: 'moo',
    cityHerd: [9, -105],   cityCount: 2, farmHerd: [120, -240], farmCount: 2,
    bodyLen: 1.45, bodyW: 0.72, bodyH: 0.8, legLen: 0.5, legW: 0.16, headR: 0.3,
    ears: 'round', tail: 'long', horns: 'bovine',
    palette: { body: '#f2ede1', accent: '#e8b4a0', dark: '#4a3a2e' } },
  { id: 'bull', count: 2, speed: 1.0, habitat: 'domestic', panicR: 5.0, fleeMul: 2.4, leash: 24, voice: 'moo',
    cityHerd: [-9, -145],  cityCount: 1, farmHerd: [-132, -430], farmCount: 1,
    bodyLen: 1.5, bodyW: 0.78, bodyH: 0.85, legLen: 0.52, legW: 0.18, headR: 0.32,
    ears: 'round', tail: 'long', horns: 'bovine', hump: true,
    palette: { body: '#6b4a35', accent: '#c8a88a', dark: '#2e2118' } },
  { id: 'donkey', count: 3, speed: 1.0, habitat: 'domestic', panicR: 5.4, fleeMul: 2.4, leash: 24, voice: 'moo',
    cityHerd: [10, -438],  cityCount: 2, farmHerd: [128, -470], farmCount: 1,
    bodyLen: 1.2, bodyW: 0.55, bodyH: 0.65, legLen: 0.5, legW: 0.13, headR: 0.26,
    ears: 'long', tail: 'long', horns: 'none',
    palette: { body: '#9a948c', accent: '#c5beb2', dark: '#3a352e' } },
  { id: 'horse', count: 3, speed: 1.3, habitat: 'domestic', panicR: 6.0, fleeMul: 2.8, leash: 26, voice: 'moo',
    cityHerd: [9, -240],   cityCount: 2, farmHerd: [62, -588],  farmCount: 1,
    bodyLen: 1.5, bodyW: 0.6, bodyH: 0.75, legLen: 0.68, legW: 0.14, headR: 0.26,
    ears: 'point', tail: 'long', horns: 'none', mane: true,
    palette: { body: '#8a5a3a', accent: '#3a2c20', dark: '#241a12' } },
  // ---- JUNGLE: the deep wild, random every session ----
  { id: 'fox', count: 3, speed: 1.9, habitat: 'jungle', panicR: 8.5, fleeMul: 2.9, leash: 40, voice: 'bark',
    bodyLen: 0.52, bodyW: 0.22, bodyH: 0.26, legLen: 0.18, legW: 0.06, headR: 0.14,
    ears: 'point', tail: 'bushy', horns: 'none',
    palette: { body: '#d97a3a', accent: '#f2ede1', dark: '#2e2118' } },
  { id: 'deer', count: 4, speed: 1.7, habitat: 'jungle', panicR: 10.5, fleeMul: 3.0, leash: 40, voice: null,
    bodyLen: 0.95, bodyW: 0.4, bodyH: 0.5, legLen: 0.5, legW: 0.09, headR: 0.18,
    ears: 'point', tail: 'stub', horns: 'antler',
    palette: { body: '#b8875a', accent: '#e8d8c0', dark: '#3a2c20' } },
  { id: 'stag', count: 3, speed: 1.5, habitat: 'jungle', panicR: 10.0, fleeMul: 3.0, leash: 40, voice: null,
    bodyLen: 1.15, bodyW: 0.5, bodyH: 0.6, legLen: 0.6, legW: 0.11, headR: 0.22,
    ears: 'point', tail: 'stub', horns: 'antler',
    palette: { body: '#8a6540', accent: '#d8c4a0', dark: '#2e2118' } },
  { id: 'wolf', count: 3, speed: 1.8, habitat: 'jungle', panicR: 9.0, fleeMul: 3.0, leash: 40, voice: null,
    bodyLen: 0.75, bodyW: 0.3, bodyH: 0.36, legLen: 0.28, legW: 0.09, headR: 0.17,
    ears: 'point', tail: 'bushy', horns: 'none',
    palette: { body: '#7a7d85', accent: '#c8c4bc', dark: '#22252a' } },
]

// ---------- shared cartoon kit: FOUR unit geometries + a material cache ----------
// Every part of every beast is one of these scaled/positioned — nothing is
// allocated per beast beyond Object3Ds.
const G_BOX = new THREE.BoxGeometry(1, 1, 1)
const G_LEG = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0) // origin at the hip
const G_SPH = new THREE.SphereGeometry(0.5, 8, 6)
const G_CONE = new THREE.ConeGeometry(0.5, 1, 6)

const MAT_CACHE = new Map<string, THREE.MeshLambertMaterial>()
function mat(hex: string): THREE.MeshLambertMaterial {
  let m = MAT_CACHE.get(hex)
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true })
    MAT_CACHE.set(hex, m)
  }
  return m
}

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, hex: string,
  px: number, py: number, pz: number, sx: number, sy: number, sz: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(hex))
  m.position.set(px, py, pz)
  m.scale.set(sx, sy, sz)
  m.castShadow = false
  m.receiveShadow = false
  parent.add(m)
  return m
}

interface BeastBody {
  group: THREE.Group      // world position + heading (faces +Z)
  bodyG: THREE.Group      // bobs/breathes/pitches
  headPivot: THREE.Group  // grazing dip
  tailPivot: THREE.Group | null
  legs: THREE.Mesh[]      // [FL, FR, BL, BR] — swing around the hip
  restY: number
}

/** Build one cartoon beast facing +Z. Head at +z, tail at −z. */
function buildBeast(def: BeastDef): BeastBody {
  const p = def.palette
  const group = new THREE.Group()
  const bodyG = new THREE.Group()
  group.add(bodyG)
  const restY = def.legLen + def.bodyH * 0.5
  bodyG.position.y = restY

  // torso
  part(bodyG, G_BOX, p.body, 0, 0, 0, def.bodyW, def.bodyH, def.bodyLen)
  // bull hump over the shoulders
  if (def.hump) part(bodyG, G_SPH, p.body, 0, def.bodyH * 0.5, def.bodyLen * 0.22, def.bodyW * 0.7, def.bodyH * 0.5, def.bodyLen * 0.3)

  // head — pivot at the neck so grazing = one rotation
  const headPivot = new THREE.Group()
  headPivot.position.set(0, def.bodyH * 0.34, def.bodyLen * 0.5 + def.headR * 0.5)
  bodyG.add(headPivot)
  part(headPivot, G_SPH, p.body, 0, def.headR * 0.36, def.headR * 0.55, def.headR * 1.7, def.headR * 1.7, def.headR * 1.8)
  // snout
  part(headPivot, G_BOX, p.accent, 0, def.headR * 0.14, def.headR * 1.42, def.headR * 0.9, def.headR * 0.66, def.headR * 0.9)
  // eyes — the cartoon soul of the whole rebuild
  const eyeZ = def.headR * 1.15
  const eyeX = def.headR * 0.52
  part(headPivot, G_SPH, '#1c1a17', eyeX, def.headR * 0.55, eyeZ, def.headR * 0.16, def.headR * 0.16, def.headR * 0.16)
  part(headPivot, G_SPH, '#1c1a17', -eyeX, def.headR * 0.55, eyeZ, def.headR * 0.16, def.headR * 0.16, def.headR * 0.16)

  // ears
  if (def.ears === 'round') {
    part(headPivot, G_SPH, p.body, def.headR * 0.82, def.headR * 0.85, def.headR * 0.2, def.headR * 0.42, def.headR * 0.5, def.headR * 0.2)
    part(headPivot, G_SPH, p.body, -def.headR * 0.82, def.headR * 0.85, def.headR * 0.2, def.headR * 0.42, def.headR * 0.5, def.headR * 0.2)
  } else if (def.ears === 'point') {
    part(headPivot, G_CONE, p.body, def.headR * 0.58, def.headR * 1.22, 0, def.headR * 0.5, def.headR * 0.85, def.headR * 0.28)
    part(headPivot, G_CONE, p.body, -def.headR * 0.58, def.headR * 1.22, 0, def.headR * 0.5, def.headR * 0.85, def.headR * 0.28)
  } else if (def.ears === 'long') {
    part(headPivot, G_BOX, p.body, def.headR * 0.42, def.headR * 1.5, -def.headR * 0.15, def.headR * 0.26, def.headR * 1.5, def.headR * 0.14)
    part(headPivot, G_BOX, p.body, -def.headR * 0.42, def.headR * 1.5, -def.headR * 0.15, def.headR * 0.26, def.headR * 1.5, def.headR * 0.14)
  }

  // horns
  if (def.horns === 'bovine') {
    part(headPivot, G_CONE, p.accent, def.headR * 0.72, def.headR * 1.15, def.headR * 0.25, def.headR * 0.28, def.headR * 0.7, def.headR * 0.28).rotation.z = 0.9
    part(headPivot, G_CONE, p.accent, -def.headR * 0.72, def.headR * 1.15, def.headR * 0.25, def.headR * 0.28, def.headR * 0.7, def.headR * 0.28).rotation.z = -0.9
  } else if (def.horns === 'antler') {
    // two-prong antlers: main beam + a tine, per side
    for (const s of [1, -1]) {
      const main = part(headPivot, G_CONE, p.accent, s * def.headR * 0.5, def.headR * 1.6, def.headR * 0.1, def.headR * 0.16, def.headR * 1.2, def.headR * 0.16)
      main.rotation.z = s * 0.42
      const tine = part(headPivot, G_CONE, p.accent, s * def.headR * 0.92, def.headR * 1.85, def.headR * 0.1, def.headR * 0.12, def.headR * 0.6, def.headR * 0.12)
      tine.rotation.z = s * 1.15
    }
  }

  // mane (horse) — a dark strip along the neck
  if (def.mane) {
    part(headPivot, G_BOX, p.accent, 0, def.headR * 1.05, def.headR * 0.05, def.headR * 0.22, def.headR * 0.6, def.headR * 1.5)
    part(bodyG, G_BOX, p.accent, 0, def.bodyH * 0.5, def.bodyLen * 0.32, def.bodyW * 0.16, def.bodyH * 0.22, def.bodyLen * 0.34)
  }

  // tail
  let tailPivot: THREE.Group | null = null
  if (def.tail !== 'stub') {
    tailPivot = new THREE.Group()
    tailPivot.position.set(0, def.bodyH * 0.34, -def.bodyLen * 0.5)
    bodyG.add(tailPivot)
    if (def.tail === 'long') {
      part(tailPivot, G_BOX, p.dark, 0, -def.bodyH * 0.28, -def.headR * 0.3, def.headR * 0.2, def.bodyH * 0.62, def.headR * 0.2)
    } else if (def.tail === 'bushy') {
      part(tailPivot, G_SPH, p.body, 0, def.headR * 0.34, -def.headR * 0.85, def.headR * 0.55, def.headR * 0.55, def.headR * 1.5)
      if (def.id === 'fox') part(tailPivot, G_SPH, p.accent, 0, def.headR * 0.42, -def.headR * 1.5, def.headR * 0.4, def.headR * 0.4, def.headR * 0.7)
    } else if (def.tail === 'curl') {
      part(tailPivot, G_SPH, p.accent, 0, def.headR * 0.85, -def.headR * 0.45, def.headR * 0.5, def.headR * 0.5, def.headR * 0.5)
    }
  } else {
    part(bodyG, G_SPH, p.accent, 0, def.bodyH * 0.3, -def.bodyLen * 0.52, def.headR * 0.34, def.headR * 0.34, def.headR * 0.34)
  }

  // legs — FL, FR, BL, BR (diagonal pairs share a phase)
  const legs: THREE.Mesh[] = []
  const hipY = -def.bodyH * 0.5
  const zx = def.bodyW * 0.5 - def.legW * 0.6
  const zz = def.bodyLen * 0.5 - def.legW * 0.9
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const leg = part(bodyG, G_LEG, p.dark, sx * zx, hipY, sz * zz, def.legW, def.legLen, def.legW)
    legs.push(leg)
  }

  return { group, bodyG, headPivot, tailPivot, legs, restY }
}

type BeastState = 'idle' | 'walk' | 'eat' | 'flee'

interface Beast {
  def: BeastDef
  body: BeastBody
  state: BeastState
  stateT: number
  home: { x: number; z: number }
  wanderR: number
  target: { x: number; z: number }
  ry: number
  /** gait phase — drives legs/bob/tail */
  phase: number
  /** current head-dip 0..1 (lerped — grazing eases in/out) */
  dip: number
  /** panic re-aim countdown (s) — keeps the escape vector fresh while chased */
  reevalT: number
  /** spatial voice cooldown (s) so a long chase does not spam audio nodes */
  voiceCd: number
}

function inDisc(x: number, z: number, r = 600): boolean {
  const dx = x - WORLD_DISC.cx
  const dz = z - WORLD_DISC.cz
  return dx * dx + dz * dz <= r * r
}

function nearGraveyard(x: number, z: number, pad = 16): boolean {
  const gx = x - GRAVEYARD.x
  const gz = z - GRAVEYARD.z
  const gr = GRAVEYARD.r + pad
  return gx * gx + gz * gz < gr * gr
}

/** Common hazard exclusions for the anchored habitats (pets + domestic):
 *  inside the disc, off the Kabristan interior, out of the Bhayanak river band
 *  and the arena exit corridor, and not stacked on a claimed spot. */
function anchoredValid(x: number, z: number, used: Array<{ x: number; z: number }>, minDist: number): boolean {
  if (!inDisc(x, z)) return false
  if (nearGraveyard(x, z)) return false
  if (Math.abs(x) < 46 && z < -564) return false // arena exit + south trail head
  if (Math.abs(x) < 214 && z < -662 && z > -712) return false // river band
  for (const u of used) {
    const ux = x - u.x
    const uz = z - u.z
    if (ux * ux + uz * uz < minDist * minDist) return false
  }
  return true
}

function validSpot(x: number, z: number, used: Array<{ x: number; z: number }>, minDist: number, wildMin = 0.35): boolean {
  if (!inDisc(x, z, 600)) return false
  if (z > 20) return false // the city band keeps its street animals; the wild starts here
  if (wildnessAt(x, z) < wildMin) return false
  if (nearGraveyard(x, z)) return false
  for (const u of used) {
    const ux = x - u.x
    const uz = z - u.z
    if (ux * ux + uz * uz < minDist * minDist) return false
  }
  return true
}

function pickSpot(used: Array<{ x: number; z: number }>, minDist: number, wildMin = 0.35): { x: number; z: number } | null {
  // rejection-sample the jungle: inside the world disc, wild enough, clear of
  // the graveyard's zombie budget and of previously claimed spots
  for (let i = 0; i < 260; i++) {
    const x = (Math.random() * 2 - 1) * 610
    const z = -950 + Math.random() * 990 // −950 .. 40
    if (!validSpot(x, z, used, minDist, wildMin)) continue
    return { x, z }
  }
  return null
}

export class WildlifeSystem {
  readonly group = new THREE.Group()
  private physics: PhysicsWorld
  private beasts: Beast[] = []
  private used: Array<{ x: number; z: number }> = []
  private started = false
  private disposed = false

  constructor(physics: PhysicsWorld) {
    this.physics = physics
    this.group.name = 'vc-wildlife'
  }

  /** Idempotent start — the build is SYNCHRONOUS now (no GLB streams): all
   *  30 cartoon beasts pop in on the first match frame at zero network cost. */
  ensureStarted(): void {
    if (this.started || this.disposed) return
    this.started = true
    this.build()
  }

  private build(): void {
    for (const def of BEASTS) {
      if (def.habitat === 'pet') this.spawnPets(def)
      else if (def.habitat === 'domestic') this.spawnDomestic(def)
      else this.spawnJungle(def)
    }
    // QA affordance: a one-shot census of what actually spawned (and where),
    // so "the animals aren't showing" can be diagnosed from __vcDiag directly.
    try {
      const w = window as unknown as { __vcDiag?: Array<Record<string, unknown>> }
      w.__vcDiag = w.__vcDiag ?? []
      w.__vcDiag.push({
        kind: 'wildlifeCensus',
        beasts: this.beasts.map((b) => ({ id: b.def.id, x: Math.round(b.body.group.position.x), z: Math.round(b.body.group.position.z) })),
        props: 0,
        t: Date.now(),
      })
    } catch { /* diag is best-effort */ }
  }

  /** CITY PETS: one dog per proven street corner, huddled with a little
   *  sidewalk-side jitter so they don't stand stacked on the exact spot. */
  private spawnPets(def: BeastDef): void {
    const sites = def.petSites ?? []
    for (let n = 0; n < def.count; n++) {
      const site = sites[n % Math.max(1, sites.length)]
      if (!site) return
      let spot: { x: number; z: number } | null = null
      for (let t = 0; t < 10 && !spot; t++) {
        const x = site[0] + (Math.random() * 2 - 1) * 3
        const z = site[1] + (Math.random() * 2 - 1) * 3
        if (anchoredValid(x, z, this.used, 2.5)) spot = { x, z }
      }
      if (!spot) spot = { x: site[0], z: site[1] }
      this.used.push(spot)
      this.spawnBeast(def, spot, 6 + Math.random() * 4)
    }
  }

  /** DOMESTIC herds: every species splits its members between a CITY-EDGE
   *  pasture and a FARM-BELT pasture so both zones are stocked every session. */
  private spawnDomestic(def: BeastDef): void {
    const groups: Array<{ site: [number, number] | undefined; n: number }> = [
      { site: def.cityHerd, n: def.cityCount ?? 0 },
      { site: def.farmHerd, n: def.farmCount ?? 0 },
    ]
    for (const g of groups) {
      if (!g.site || g.n <= 0) continue
      let last: { x: number; z: number } | null = null
      for (let n = 0; n < g.n; n++) {
        let spot: { x: number; z: number } | null = null
        for (let t = 0; t < 14 && !spot; t++) {
          const base = last ?? { x: g.site[0], z: g.site[1] }
          const j = last ? 7 : 4
          const x = base.x + (Math.random() * 2 - 1) * j
          const z = base.z + (Math.random() * 2 - 1) * j
          if (anchoredValid(x, z, this.used, 3)) spot = { x, z }
        }
        if (!spot) spot = { x: g.site[0] + (Math.random() * 2 - 1) * 4, z: g.site[1] + (Math.random() * 2 - 1) * 4 }
        last = spot
        this.used.push(spot)
        this.spawnBeast(def, spot, 5 + Math.random() * 4)
      }
    }
  }

  /** JUNGLE wanderers: the task-107 rejection sampling + herd clustering. */
  private spawnJungle(def: BeastDef): void {
    let last: { x: number; z: number } | null = null
    for (let n = 0; n < def.count; n++) {
      let spot: { x: number; z: number } | null = null
      if (last && Math.random() < 0.65) {
        for (let t = 0; t < 12 && !spot; t++) {
          const x = last.x + (Math.random() * 2 - 1) * 7
          const z = last.z + (Math.random() * 2 - 1) * 7
          if (validSpot(x, z, this.used, 3)) spot = { x, z }
        }
      }
      if (!spot) spot = pickSpot(this.used, 14)
      if (!spot) break
      last = spot
      this.used.push(spot)
      this.spawnBeast(def, spot, 9 + Math.random() * 12)
    }
  }

  private spawnBeast(def: BeastDef, spot: { x: number; z: number }, wanderR: number): void {
    const body = buildBeast(def)
    const beast: Beast = {
      def,
      body,
      state: 'idle',
      stateT: 2 + Math.random() * 5,
      home: { x: spot.x, z: spot.z },
      wanderR,
      target: { x: spot.x, z: spot.z },
      ry: Math.random() * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
      dip: 0,
      reevalT: 0,
      voiceCd: 0,
    }
    body.group.position.set(spot.x, this.physics.groundHeight(spot.x, spot.z, 40), spot.z)
    body.group.rotation.y = beast.ry
    this.group.add(body.group)
    this.beasts.push(beast)
  }

  private retarget(b: Beast): void {
    const ang = Math.random() * Math.PI * 2
    const r = 4 + Math.random() * (b.wanderR - 4)
    b.target.x = b.home.x + Math.cos(ang) * r
    b.target.z = b.home.z + Math.sin(ang) * r
  }

  /** PANIC VECTOR — aim away from the player with a slight random tangent,
   *  then clamp onto the home leash so a flight can never drag a cow three
   *  districts away (or a fox off its jungle). */
  private retargetFlee(b: Beast, px: number, pz: number): void {
    const pos = b.body.group.position
    const fx = pos.x - px
    const fz = pos.z - pz
    const l = Math.max(0.001, Math.hypot(fx, fz))
    const ang = Math.atan2(fx / l, fz / l) + (Math.random() - 0.5) * 0.7
    const dist = 14 + Math.random() * 10
    let tx = pos.x + Math.sin(ang) * dist
    let tz = pos.z + Math.cos(ang) * dist
    const hx = tx - b.home.x
    const hz = tz - b.home.z
    const hd = Math.hypot(hx, hz)
    if (hd > b.def.leash) {
      tx = b.home.x + (hx / hd) * b.def.leash
      tz = b.home.z + (hz / hd) * b.def.leash
    }
    b.target.x = tx
    b.target.z = tz
  }

  private voice(b: Beast, px: number, pz: number, yaw: number): void {
    if (!b.def.voice || b.voiceCd > 0) return
    b.voiceCd = 2.8 + Math.random() * 2.2
    AudioManager.playAt(b.def.voice, b.body.group.position.x, b.body.group.position.z, px, pz, yaw, 46, 1.0)
  }

  update(dt: number, player: { x: number; z: number }, yaw = 0): void {
    if (!this.beasts.length) return
    for (const b of this.beasts) {
      const def = b.def
      const pos = b.body.group.position
      const dx = player.x - pos.x
      const dz = player.z - pos.z
      const distSq = dx * dx + dz * dz
      const far = distSq > 140 * 140
      const hidden = distSq > 190 * 190
      if (b.body.group.visible !== !hidden) b.body.group.visible = !hidden
      if (b.voiceCd > 0) b.voiceCd -= dt

      // ---- PANIC: the player stepped inside the species' comfort radius ----
      if (b.state !== 'flee' && !far && distSq < def.panicR * def.panicR) {
        b.state = 'flee'
        b.stateT = 2.2
        b.reevalT = 0
        this.retargetFlee(b, player.x, player.z)
        this.voice(b, player.x, player.z, yaw)
      }

      b.stateT -= dt
      switch (b.state) {
        case 'idle': {
          if (b.stateT <= 0) {
            const roll = Math.random()
            if (roll < 0.45) {
              b.state = 'walk'
              b.stateT = 20 // arrival-based; safety ceiling
              this.retarget(b)
            } else if (roll < 0.72) {
              b.state = 'eat'
              b.stateT = 3 + Math.random() * 4
            } else {
              b.stateT = 3 + Math.random() * 6
            }
          }
          break
        }
        case 'walk':
        case 'flee': {
          const fleeing = b.state === 'flee'
          // while still chased, keep the escape vector fresh so the player can
          // never corner the beast against its leash
          if (fleeing) {
            b.reevalT -= dt
            if (b.reevalT <= 0) {
              b.reevalT = 0.45
              if (distSq < (def.panicR + 4) * (def.panicR + 4)) {
                this.retargetFlee(b, player.x, player.z)
                b.stateT = Math.max(b.stateT, 1.5)
              }
            }
          }
          const tx = b.target.x - pos.x
          const tz = b.target.z - pos.z
          const d = Math.hypot(tx, tz)
          const speed = fleeing ? def.speed * def.fleeMul : def.speed
          const arrive = fleeing ? 0.6 : 0.5
          const safe = distSq > (def.panicR + 7) * (def.panicR + 7)
          const arrived = d < arrive
          if (arrived || (!fleeing && b.stateT <= 0) || (fleeing && b.stateT <= 0 && safe)) {
            if (fleeing && !safe) {
              // cornered at the leash edge with the player still close — bolt again
              this.retargetFlee(b, player.x, player.z)
              b.stateT = 1.5 + Math.random()
              this.voice(b, player.x, player.z, yaw)
            } else {
              b.state = 'idle'
              b.stateT = 2.5 + Math.random() * 5
            }
          } else {
            const step = Math.min(speed * dt, d)
            const nx = pos.x + (tx / d) * step
            const nz = pos.z + (tz / d) * step
            // heading: beasts face +Z, same convention as the players
            const want = Math.atan2(tx, tz)
            let dr = want - b.ry
            while (dr > Math.PI) dr -= Math.PI * 2
            while (dr < -Math.PI) dr += Math.PI * 2
            b.ry += dr * Math.min(1, dt * (fleeing ? 7 : 5))
            pos.set(nx, this.physics.groundHeight(nx, nz, 40), nz)
          }
          break
        }
        case 'eat': {
          if (b.stateT <= 0) {
            b.state = 'idle'
            b.stateT = 2 + Math.random() * 5
          }
          break
        }
      }

      // ---- PROCEDURAL CARTOON ANIMATION (skipped beyond 140 m) ----
      if (!far) {
        const moving = b.state === 'walk' || b.state === 'flee'
        const gait = moving ? (b.state === 'flee' ? 11 : 6.5) : 1.6
        b.phase += dt * gait
        const swing = b.state === 'flee' ? 0.85 : b.state === 'walk' ? 0.5 : 0
        const { legs, bodyG, headPivot, tailPivot, restY } = b.body
        // diagonal pairs: FL+BR together, FR+BL opposite
        legs[0].rotation.x = Math.sin(b.phase) * swing
        legs[3].rotation.x = Math.sin(b.phase) * swing
        legs[1].rotation.x = Math.sin(b.phase + Math.PI) * swing
        legs[2].rotation.x = Math.sin(b.phase + Math.PI) * swing
        // body bob + gallop pitch + idle breath
        const bob = moving ? Math.abs(Math.sin(b.phase)) * 0.05 : Math.sin(b.phase) * 0.012
        bodyG.position.y = restY + bob
        bodyG.rotation.x = b.state === 'flee' ? Math.sin(b.phase * 2) * 0.07 : 0
        // grazing: ease the head down while eating, up otherwise
        const dipTarget = b.state === 'eat' ? 1 : 0
        b.dip += (dipTarget - b.dip) * Math.min(1, dt * 3.4)
        headPivot.rotation.x = b.dip * 0.95 + (moving ? Math.sin(b.phase * 0.5) * 0.05 : 0)
        // tail: happy wag when calm, streamed straight in a panic
        if (tailPivot) tailPivot.rotation.y = b.state === 'flee' ? 0 : Math.sin(b.phase * 0.9) * 0.3
      }
    }
  }

  dispose(): void {
    this.disposed = true
    for (const b of this.beasts) this.group.remove(b.body.group)
    this.beasts = []
    this.used = []
  }
}
