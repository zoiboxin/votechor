// VoteChor animals — ambient sky birds + street strays (dogs, cats, cows) as
// fully independent client-side bots, exactly like the vehicles: wander AI,
// procedural walk/sit/graze animation, synthesized voices (bark/meow/moo/chirp
// — zero assets), and a feed-to-follow pet mechanic (drop food → the animal
// walks over, eats it, then follows the player for a while; feeding again
// extends the friendship). No server coupling, no physics coupling — the
// animals are kinematic props that live on hand-placed open spots.
import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { AudioManager } from './audio'
import { PET_FOLLOW_SEC } from './shared/constants'
import type { FxSystem } from './fx'
import type { PhysicsWorld } from './physics'

export type AnimalKind = 'dog' | 'cat' | 'cow'

export interface AnimalHandle {
  idx: number
  kind: AnimalKind
  label: string
  petting: boolean
}

type AnimalState = 'wander' | 'idle' | 'goEat' | 'eat' | 'follow' | 'flee'

interface Animal {
  kind: AnimalKind
  label: string
  group: THREE.Group
  legs: THREE.Object3D[]
  tail: THREE.Object3D | null
  head: THREE.Object3D | null
  bodyRoot: THREE.Group
  home: { x: number; z: number }
  wanderR: number
  target: { x: number; z: number }
  speed: number
  followSpeed: number
  state: AnimalState
  stateT: number
  phase: number
  moveAmt: number // smoothed 0..1 leg-swing driver
  ry: number
  voiceT: number
  eatSfxT: number
  petUntil: number // worldTime (s); 0 = not a pet
  heartT: number
  crumb: THREE.Group | null
  sit: boolean
  wasPet: boolean // was already a pet when the current crumb was dropped
}

interface Bird {
  group: THREE.Group
  wingL: THREE.Object3D
  wingR: THREE.Object3D
  cx: number
  cz: number
  cy: number
  r: number
  ang: number
  angSpd: number
  flapHz: number
  flapOff: number
  bobOff: number
  voiceT: number
  driftAng: number
}

// ---- shared material cache (module level — no per-instance allocation) ----
const matCache = new Map<string, THREE.MeshStandardMaterial>()
function mat(color: string): THREE.MeshStandardMaterial {
  let m = matCache.get(color)
  if (!m) { m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 }); matCache.set(color, m) }
  return m
}

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

function merged(parts: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh {
  // all-primitive pipeline (boxes/cones/cylinders are indexed + uv'd) — normalize
  // anyway so this stays immune to the silent-null-merge bug class (v38 lesson)
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

/** Leg pivot group — child geometry hangs BELOW the pivot so rotation.x swings it. */
function legPivot(x: number, y: number, z: number, radius: number, len: number, material: THREE.Material): THREE.Group {
  const pivot = new THREE.Group()
  pivot.position.set(x, y, z)
  const legGeo = new THREE.CylinderGeometry(radius, radius * 0.88, len, 6)
  legGeo.translate(0, -len / 2, 0)
  const m = new THREE.Mesh(legGeo, material)
  m.castShadow = false
  pivot.add(m)
  return pivot
}

const DOG_COLORS = ['#b98a5a', '#8a6844', '#9a958c']
const CAT_COLORS = ['#d98e4a', '#8d8d94']

function buildDog(variant: number): { group: THREE.Group; legs: THREE.Object3D[]; tail: THREE.Object3D; head: THREE.Object3D } {
  const fur = mat(DOG_COLORS[variant % DOG_COLORS.length])
  const belly = mat('#d8c9ae')
  const dark = mat('#2a241e')
  const group = new THREE.Group()
  const bodyRoot = new THREE.Group()
  group.add(bodyRoot)
  // torso + chest
  bodyRoot.add(merged([
    box(0.4, 0.34, 0.78, 0, 0.47, 0),
    box(0.32, 0.2, 0.3, 0, 0.36, 0.28), // chest
  ], fur))
  const bellyM = new THREE.Mesh(box(0.3, 0.12, 0.5, 0, 0.31, 0.02), belly)
  bellyM.castShadow = false
  bodyRoot.add(bellyM)
  // head (pivot at the neck — pitch for sniff/look, yaw for look-around)
  const head = new THREE.Group()
  head.position.set(0, 0.62, 0.4)
  const skull = merged([
    box(0.3, 0.26, 0.28, 0, 0.1, 0.08),
    box(0.16, 0.13, 0.2, 0, 0.04, 0.28), // snout
    box(0.07, 0.05, 0.05, 0, 0.07, 0.39), // nose
    box(0.09, 0.14, 0.05, 0.16, 0.24, 0.02), // floppy ear R
    box(0.09, 0.14, 0.05, -0.16, 0.24, 0.02), // floppy ear L
  ], fur)
  skull.castShadow = true
  const eyes = merged([
    box(0.045, 0.05, 0.02, 0.09, 0.13, 0.21),
    box(0.045, 0.05, 0.02, -0.09, 0.13, 0.21),
  ], dark)
  eyes.castShadow = false
  head.add(skull, eyes)
  bodyRoot.add(head)
  // collar
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 5, 10), mat('#b5302a'))
  collar.position.set(0, 0.6, 0.32)
  collar.rotation.x = Math.PI / 2 - 0.25
  collar.castShadow = false
  bodyRoot.add(collar)
  // legs (FL, FR, BL, BR)
  const legs = [
    legPivot(0.13, 0.36, 0.3, 0.052, 0.36, fur),
    legPivot(-0.13, 0.36, 0.3, 0.052, 0.36, fur),
    legPivot(0.13, 0.36, -0.28, 0.052, 0.36, fur),
    legPivot(-0.13, 0.36, -0.28, 0.052, 0.36, fur),
  ]
  for (const l of legs) bodyRoot.add(l)
  // tail — up-curved, wags on rotation.z
  const tail = new THREE.Group()
  tail.position.set(0, 0.58, -0.38)
  const tailGeo = new THREE.CylinderGeometry(0.035, 0.05, 0.32, 5)
  tailGeo.translate(0, 0.16, 0)
  const tailMesh = new THREE.Mesh(tailGeo, fur)
  tailMesh.castShadow = false
  tail.add(tailMesh)
  tail.rotation.x = -0.75
  bodyRoot.add(tail)
  return { group, legs, tail, head }
}

function buildCat(variant: number): { group: THREE.Group; legs: THREE.Object3D[]; tail: THREE.Object3D; head: THREE.Object3D } {
  const fur = mat(CAT_COLORS[variant % CAT_COLORS.length])
  const dark = mat('#26221d')
  const pink = mat('#d8a0a0')
  const group = new THREE.Group()
  const bodyRoot = new THREE.Group()
  group.add(bodyRoot)
  bodyRoot.add(merged([
    box(0.26, 0.22, 0.52, 0, 0.32, 0), // slim torso
  ], fur))
  // head with cone ears
  const head = new THREE.Group()
  head.position.set(0, 0.44, 0.24)
  const earGeo = (x: number) => {
    const g = new THREE.ConeGeometry(0.05, 0.1, 4)
    g.translate(x, 0.2, 0)
    return g
  }
  const skull = merged([
    box(0.2, 0.18, 0.18, 0, 0.09, 0.06),
    box(0.1, 0.07, 0.08, 0, 0.05, 0.17), // muzzle
    earGeo(0.07), earGeo(-0.07),
  ], fur)
  skull.castShadow = true
  const nose = new THREE.Mesh(box(0.03, 0.025, 0.02, 0, 0.06, 0.215), pink)
  const eyes = merged([
    box(0.035, 0.04, 0.02, 0.06, 0.11, 0.15),
    box(0.035, 0.04, 0.02, -0.06, 0.11, 0.15),
  ], dark)
  eyes.castShadow = false
  head.add(skull, nose, eyes)
  bodyRoot.add(head)
  const legs = [
    legPivot(0.08, 0.24, 0.19, 0.035, 0.24, fur),
    legPivot(-0.08, 0.24, 0.19, 0.035, 0.24, fur),
    legPivot(0.08, 0.24, -0.18, 0.035, 0.24, fur),
    legPivot(-0.08, 0.24, -0.18, 0.035, 0.24, fur),
  ]
  for (const l of legs) bodyRoot.add(l)
  // long tail — curved up, slow sway
  const tail = new THREE.Group()
  tail.position.set(0, 0.4, -0.24)
  const t1 = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.24, 5), fur)
  t1.geometry.translate(0, 0.12, 0)
  t1.position.y = 0
  const t2 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.022, 0.18, 5), fur)
  t2.geometry.translate(0, 0.09, 0)
  t2.position.set(0, 0.22, 0.04)
  t2.rotation.x = -0.5
  t1.castShadow = t2.castShadow = false
  tail.add(t1, t2)
  tail.rotation.x = -0.45
  bodyRoot.add(tail)
  return { group, legs, tail, head }
}

function buildCow(): { group: THREE.Group; legs: THREE.Object3D[]; tail: THREE.Object3D; head: THREE.Object3D } {
  const coat = mat('#ece5d8')
  const patch = mat('#6b5138')
  const dark = mat('#2a241e')
  const hornM = mat('#8a8574')
  const group = new THREE.Group()
  const bodyRoot = new THREE.Group()
  group.add(bodyRoot)
  // barrel + patches (slightly proud so flat shading catches them)
  bodyRoot.add(merged([
    box(0.82, 0.78, 1.62, 0, 1.0, 0),
    box(0.84, 0.4, 0.5, 0, 1.1, 0.5),  // shoulder hump mass
  ], coat))
  const patches = merged([
    box(0.86, 0.34, 0.42, 0.02, 1.12, -0.28),
    box(0.86, 0.26, 0.3, -0.02, 0.86, 0.18),
  ], patch)
  patches.castShadow = false
  bodyRoot.add(patches)
  // head (grazing pivot)
  const head = new THREE.Group()
  head.position.set(0, 1.28, 0.86)
  const skull = merged([
    box(0.44, 0.42, 0.44, 0, 0, 0.18),
    box(0.3, 0.22, 0.2, 0, -0.14, 0.46), // snout
    box(0.14, 0.1, 0.16, 0.26, 0.16, 0.1), // ear R
    box(0.14, 0.1, 0.16, -0.26, 0.16, 0.1), // ear L
  ], coat)
  skull.castShadow = true
  const snout = new THREE.Mesh(box(0.26, 0.14, 0.1, 0, -0.16, 0.5), mat('#d8a0a0'))
  const horn1 = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 5), hornM)
  horn1.position.set(0.17, 0.26, 0.08)
  horn1.rotation.z = 0.5
  const horn2 = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 5), hornM)
  horn2.position.set(-0.17, 0.26, 0.08)
  horn2.rotation.z = -0.5
  const eyes = merged([
    box(0.05, 0.06, 0.02, 0.15, 0.04, 0.4),
    box(0.05, 0.06, 0.02, -0.15, 0.04, 0.4),
  ], dark)
  eyes.castShadow = false
  head.add(skull, snout, horn1, horn2, eyes)
  bodyRoot.add(head)
  // road-safety bell (matches the veh_cow collar language)
  const bellMat = new THREE.MeshStandardMaterial({ color: '#c9a02e', emissive: '#ffaa33', emissiveIntensity: 0.4, roughness: 0.4, metalness: 0.3 })
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.04, 5, 10), bellMat)
  band.position.set(0, 1.16, 0.8)
  band.rotation.x = Math.PI / 2.3
  band.castShadow = false
  bodyRoot.add(band)
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), bellMat)
  bell.position.set(0, 1.04, 0.84)
  bell.castShadow = false
  bodyRoot.add(bell)
  // legs
  const legs = [
    legPivot(0.28, 0.66, 0.6, 0.09, 0.66, coat),
    legPivot(-0.28, 0.66, 0.6, 0.09, 0.66, coat),
    legPivot(0.28, 0.66, -0.58, 0.09, 0.66, coat),
    legPivot(-0.28, 0.66, -0.58, 0.09, 0.66, coat),
  ]
  for (const l of legs) bodyRoot.add(l)
  // tail with tuft — slow swish
  const tail = new THREE.Group()
  tail.position.set(0, 1.22, -0.8)
  const tGeo = new THREE.CylinderGeometry(0.035, 0.045, 0.6, 5)
  tGeo.translate(0, -0.3, 0)
  const tMesh = new THREE.Mesh(tGeo, coat)
  const tuft = new THREE.Mesh(box(0.08, 0.12, 0.08, 0, -0.66, 0), patch)
  tMesh.castShadow = tuft.castShadow = false
  tail.add(tMesh, tuft)
  bodyRoot.add(tail)
  return { group, legs, tail, head }
}

function buildBird(): { group: THREE.Group; wingL: THREE.Object3D; wingR: THREE.Object3D } {
  const dark = mat('#33302c')
  const group = new THREE.Group()
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 5), dark)
  body.geometry.rotateX(Math.PI / 2) // cone points forward +z
  body.castShadow = false
  group.add(body)
  const wingGeo = new THREE.BoxGeometry(0.36, 0.015, 0.13)
  wingGeo.translate(0.19, 0, 0)
  const wingL = new THREE.Group()
  wingL.add(new THREE.Mesh(wingGeo, dark))
  const wingR = new THREE.Group()
  const wr = new THREE.Mesh(wingGeo, dark)
  wr.scale.x = -1
  wingR.add(wr)
  group.add(wingL, wingR)
  return { group, wingL, wingR }
}

function buildCrumb(): THREE.Group {
  const g = new THREE.Group()
  const bread = mat('#c99a5e')
  const crust = mat('#9a6b3a')
  const c1 = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.1, 4), bread)
  c1.position.y = 0.05
  c1.rotation.y = 0.6
  const c2 = new THREE.Mesh(box(0.1, 0.06, 0.08, 0.14, 0.03, 0.05), crust)
  const c3 = new THREE.Mesh(box(0.08, 0.05, 0.07, -0.12, 0.025, -0.04), bread)
  c1.castShadow = c2.castShadow = c3.castShadow = false
  g.add(c1, c2, c3)
  return g
}

// ---- world spots (hand-placed on plazas/sidewalk margins, ≥4 m off every
// vehicle lane verified by tests/route-check.ts data) ----
const SPOTS: Array<{ kind: AnimalKind; x: number; z: number; r: number }> = [
  { kind: 'dog', x: 8, z: -66, r: 7 },    // plaza side, north of Plaza Cross Rd
  { kind: 'dog', x: -7, z: -188, r: 7 },  // Market Exit margin
  { kind: 'dog', x: 10, z: -462, r: 6 },  // Colony Cross Rd east margin
  { kind: 'cat', x: -9, z: -270, r: 5 },  // Avenue Cross Rd north margin
  { kind: 'cat', x: 7, z: -512, r: 5 },   // Parliament Plaza approach
  { kind: 'cow', x: 8, z: -400, r: 4.5 }, // grand avenue east margin
  { kind: 'cow', x: -6, z: -505, r: 4 },  // Parliament Plaza north edge
]

const BIRD_FLOCKS = [
  { cx: 0, cz: -250, cy: 22, r: 34, count: 6 },
  { cx: 28, cz: -440, cy: 26, r: 28, count: 6 },
]

const KIND_EMOJI: Record<AnimalKind, string> = { dog: '🐕', cat: '🐈', cow: '🐄' }

const VOICE_SFX: Record<AnimalKind, Parameters<typeof AudioManager.play>[0]> = { dog: 'bark', cat: 'meow', cow: 'moo' }
const VOICE_MIN: Record<AnimalKind, number> = { dog: 9, cat: 8, cow: 14 }
const VOICE_RAND: Record<AnimalKind, number> = { dog: 11, cat: 10, cow: 14 }

export class AnimalSystem {
  group = new THREE.Group()
  private animals: Animal[] = []
  private birds: Bird[] = []
  private t = 0

  constructor(
    private physics: PhysicsWorld,
    private fx: FxSystem,
    private hooks: {
      onFed?: (label: string, kind: AnimalKind, extended: boolean) => void
      onPetOver?: (label: string) => void
    } = {},
  ) {
    let dogV = 0
    let catV = 0
    for (const s of SPOTS) {
      const built = s.kind === 'dog' ? buildDog(dogV++) : s.kind === 'cat' ? buildCat(catV++) : buildCow()
      built.group.name = `animal-${s.kind}`
      built.group.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = false })
      const y = this.physics.groundHeight(s.x, s.z, 2)
      built.group.position.set(s.x, y, s.z)
      this.group.add(built.group)
      this.animals.push({
        kind: s.kind,
        label: s.kind === 'dog' ? 'The stray dog' : s.kind === 'cat' ? 'The street cat' : 'The cow',
        group: built.group, legs: built.legs, tail: built.tail, head: built.head,
        bodyRoot: (built.group.children[0] as THREE.Group) ?? built.group,
        home: { x: s.x, z: s.z }, wanderR: s.r,
        target: { x: s.x, z: s.z },
        speed: s.kind === 'cow' ? 1.1 : s.kind === 'dog' ? 1.9 : 1.6,
        followSpeed: s.kind === 'cow' ? 5.4 : s.kind === 'dog' ? 6.6 : 6.0,
        state: 'idle', stateT: 1 + Math.random() * 3,
        phase: Math.random() * 6, moveAmt: 0, ry: Math.random() * 6,
        voiceT: 4 + Math.random() * VOICE_RAND[s.kind],
        eatSfxT: 0, petUntil: 0, heartT: 0, crumb: null, sit: false, wasPet: false,
      })
    }
    for (const f of BIRD_FLOCKS) {
      for (let i = 0; i < f.count; i++) {
        const b = buildBird()
        b.group.name = 'bird'
        this.group.add(b.group)
        this.birds.push({
          group: b.group, wingL: b.wingL, wingR: b.wingR,
          cx: f.cx, cz: f.cz, cy: f.cy + (i % 3) * 1.6, r: f.r + (i - f.count / 2) * 2.2,
          ang: (i / f.count) * Math.PI * 2, angSpd: 0.22 + Math.random() * 0.1,
          flapHz: 5.5 + Math.random() * 2.5, flapOff: Math.random() * 6, bobOff: Math.random() * 6,
          voiceT: 6 + Math.random() * 14, driftAng: Math.random() * 6,
        })
      }
    }
  }

  /** Nearest feedable street animal within maxDist (followers included — re-feed extends). */
  nearestFeedable(px: number, pz: number, maxDist = 3.4): AnimalHandle | null {
    let best: AnimalHandle | null = null
    let bd = maxDist
    for (let i = 0; i < this.animals.length; i++) {
      const a = this.animals[i]
      const d = Math.hypot(a.group.position.x - px, a.group.position.z - pz)
      if (d < bd) { bd = d; best = { idx: i, kind: a.kind, label: a.label, petting: a.petUntil > 0 } }
    }
    return best
  }

  /** Drop food beside the animal — it will walk over, eat, then follow the player. */
  feed(idx: number, worldTime: number, playerPos: { x: number; z: number }): { label: string; kind: AnimalKind; extended: boolean } | null {
    const a = this.animals[idx]
    if (!a) return null
    a.wasPet = a.petUntil > 0
    if (!a.crumb && a.state !== 'eat' && a.state !== 'goEat') {
      // crumb lands between the animal and the player, biased toward the animal
      const ax = a.group.position.x, az = a.group.position.z
      const fx = ax + (playerPos.x - ax) * 0.3
      const fz = az + (playerPos.z - az) * 0.3
      const crumb = buildCrumb()
      crumb.position.set(fx, this.physics.groundHeight(fx, fz, 2) + 0.02, fz)
      this.group.add(crumb)
      a.crumb = crumb
      a.state = 'goEat'
      a.sit = false
    }
    return { label: a.label, kind: a.kind, extended: a.wasPet }
  }

  update(dt: number, worldTime: number, playerPos: { x: number; y: number; z: number }, playerSpeed: number, listenerYaw = 0) {
    this.t += dt
    const t = this.t
    for (const a of this.animals) {
      const p = a.group.position
      const pd = Math.hypot(p.x - playerPos.x, p.z - playerPos.z)

      // ---- voices (independent bots; v45 spatial — panned + distance-attenuated) ----
      a.voiceT -= dt
      if (a.voiceT <= 0) {
        a.voiceT = VOICE_MIN[a.kind] + Math.random() * VOICE_RAND[a.kind]
        AudioManager.playAt(VOICE_SFX[a.kind], p.x, p.z, playerPos.x, playerPos.z, listenerYaw, 52, 1.3)
      }

      // ---- pet timer ----
      if (a.petUntil > 0 && worldTime > a.petUntil) {
        a.petUntil = 0
        a.state = 'wander'
        a.target = { ...a.home }
        this.hooks.onPetOver?.(a.label)
      }

      // ---- startle: sprint right into a stray and it hops aside (cows do not care) ----
      // radius 2.2 / speed 6.8 mirrors the run threshold so a real sprint brushing
      // past always trips it, without firing for ordinary walks-by
      if ((a.kind === 'dog' || a.kind === 'cat') && a.state !== 'follow' && a.state !== 'flee' &&
          a.state !== 'eat' && a.state !== 'goEat' && pd < 2.2 && playerSpeed > 6.8) {
        const dx = p.x - playerPos.x, dz = p.z - playerPos.z
        const l = Math.max(0.2, Math.hypot(dx, dz))
        a.target = { x: p.x + (dx / l) * 5, z: p.z + (dz / l) * 5 }
        a.state = 'flee'
        a.stateT = 1.4
        a.sit = false
        AudioManager.playAt(VOICE_SFX[a.kind], p.x, p.z, playerPos.x, playerPos.z, listenerYaw, 26, 1.1)
      }

      let speed = 0
      switch (a.state) {
        case 'wander': {
          speed = a.speed
          if (Math.hypot(a.target.x - p.x, a.target.z - p.z) < 0.5) {
            a.state = 'idle'
            a.stateT = 2.5 + Math.random() * 4.5
            a.sit = a.kind === 'cow' ? false : Math.random() < (a.kind === 'cat' ? 0.45 : 0.25)
          }
          break
        }
        case 'idle': {
          a.stateT -= dt
          if (a.stateT <= 0) {
            // new wander target around home
            const ang = Math.random() * Math.PI * 2
            const rr = a.wanderR * (0.35 + Math.random() * 0.65)
            a.target = { x: a.home.x + Math.cos(ang) * rr, z: a.home.z + Math.sin(ang) * rr }
            a.state = 'wander'
            a.sit = false
          }
          break
        }
        case 'goEat': {
          if (!a.crumb) { a.state = 'wander'; break }
          speed = a.speed * 1.5
          const d = Math.hypot(a.crumb.position.x - p.x, a.crumb.position.z - p.z)
          if (d < 0.55) {
            a.state = 'eat'
            a.stateT = 1.9
            a.eatSfxT = 0
          }
          break
        }
        case 'eat': {
          a.stateT -= dt
          a.eatSfxT -= dt
          if (a.eatSfxT <= 0) {
            a.eatSfxT = 0.62
            AudioManager.playAt('crunch', p.x, p.z, playerPos.x, playerPos.z, listenerYaw, 30, 1.1)
          }
          if (a.stateT <= 0) {
            if (a.crumb) { this.group.remove(a.crumb); a.crumb = null }
            a.petUntil = worldTime + PET_FOLLOW_SEC
            a.state = 'follow'
            a.heartT = 0.3
            this.fx.burst(p.x, p.y + (a.kind === 'cow' ? 1.8 : 0.9), p.z, '#ff8fa3', 8, 1.8, 0.7)
            this.hooks.onFed?.(a.label, a.kind, a.wasPet)
          }
          break
        }
        case 'follow': {
          a.heartT -= dt
          if (a.heartT <= 0 && pd < 26) {
            a.heartT = 2.6
            this.fx.burst(p.x, p.y + (a.kind === 'cow' ? 1.9 : 1.0), p.z, '#ff8fa3', 2, 0.7, 0.6)
          }
          const d = Math.hypot(playerPos.x - p.x, playerPos.z - p.z)
          if (d > 50) {
            // leash fail-safe — never lose the pet to a teleport/rally
            p.x = playerPos.x + 1.5
            p.z = playerPos.z + 1.5
            p.y = this.physics.groundHeight(p.x, p.z, 2)
            break
          }
          if (d > 2.4) { speed = a.followSpeed * Math.min(1, (d - 2) / 4 + 0.55) }
          break
        }
        case 'flee': {
          a.stateT -= dt
          speed = a.speed * 2.4
          if (a.stateT <= 0 || Math.hypot(a.target.x - p.x, a.target.z - p.z) < 0.4) {
            a.state = 'wander'
            a.target = { x: a.home.x + (Math.random() - 0.5) * a.wanderR, z: a.home.z + (Math.random() - 0.5) * a.wanderR }
          }
          break
        }
      }

      // ---- move + face ----
      let moving = false
      if (speed > 0 && a.state !== 'eat') {
        const tx = a.state === 'follow' ? playerPos.x : a.target.x
        const tz = a.state === 'follow' ? playerPos.z : a.target.z
        const dx = tx - p.x, dz = tz - p.z
        const d = Math.hypot(dx, dz)
        if (d > 0.15) {
          const step = Math.min(d, speed * dt)
          p.x += (dx / d) * step
          p.z += (dz / d) * step
          moving = true
          const targetRy = Math.atan2(dx, dz)
          let dr = targetRy - a.ry
          while (dr > Math.PI) dr -= Math.PI * 2
          while (dr < -Math.PI) dr += Math.PI * 2
          a.ry += dr * Math.min(1, dt * 6)
        }
      }
      p.y = this.physics.groundHeight(p.x, p.z, 2)
      a.group.rotation.y = a.ry

      // ---- procedural animation ----
      a.moveAmt += ((moving ? 1 : 0) - a.moveAmt) * Math.min(1, dt * 8)
      a.phase += dt * (2.1 + a.moveAmt * (a.kind === 'cow' ? 2.6 : 4.6))
      const swing = (a.kind === 'cow' ? 0.42 : 0.6) * a.moveAmt
      const off = [0, Math.PI, Math.PI, 0]
      for (let i = 0; i < a.legs.length; i++) a.legs[i].rotation.x = Math.sin(a.phase + off[i]) * swing

      // tail language: wag fast when petted, lazy sway otherwise
      if (a.tail) {
        if (a.kind === 'dog') a.tail.rotation.z = Math.sin(t * (a.petUntil > 0 ? 9 : 2.2)) * (a.petUntil > 0 ? 0.5 : 0.16)
        else if (a.kind === 'cat') { a.tail.rotation.z = Math.sin(t * 1.6) * 0.3; a.tail.rotation.x = -0.45 + Math.sin(t * 0.9) * 0.2 }
        else a.tail.rotation.z = Math.sin(t * 1.3 + a.phase * 0.1) * 0.35
      }
      // head: sniff the ground while eating/grazing, look around while sitting, gentle bob otherwise
      if (a.head) {
        let hx = 0
        if (a.state === 'eat') hx = a.kind === 'cow' ? 1.0 : 0.85
        else if (a.state === 'idle' && a.kind === 'cow') hx = 0.55 + Math.sin(t * 0.8) * 0.15 // grazing idle
        if (a.sit && a.state === 'idle') a.head.rotation.y = Math.sin(t * 0.7) * 0.55
        else a.head.rotation.y = 0
        a.head.rotation.x += (hx + Math.sin(t * 1.7 + a.phase) * 0.04 - a.head.rotation.x) * Math.min(1, dt * 6)
      }
      // sit crouch + breathing
      const breathe = 1 + Math.sin(t * 2.1 + a.phase) * 0.012
      const targetScaleY = (a.sit && a.state === 'idle' ? 0.82 : 1) * breathe
      a.bodyRoot.scale.y += (targetScaleY - a.bodyRoot.scale.y) * Math.min(1, dt * 6)
      // pet hop — a little joy jump right after eating
      if (a.state === 'follow' && a.heartT > 2.2) a.bodyRoot.position.y = Math.max(0, Math.sin((2.9 - a.heartT) * 9)) * 0.14
      else a.bodyRoot.position.y = 0
    }

    // ---- birds ----
    for (const b of this.birds) {
      b.ang += b.angSpd * dt
      b.driftAng += dt * 0.014
      const cx = b.cx + Math.cos(b.driftAng) * 6
      const cz = b.cz + Math.sin(b.driftAng * 0.7) * 8
      const x = cx + Math.cos(b.ang) * b.r
      const z = cz + Math.sin(b.ang) * b.r
      const y = b.cy + Math.sin(t * 0.9 + b.bobOff) * 1.1
      b.group.position.set(x, y, z)
      // face the flight direction (tangent of the circle) — v = (−sin·ȧ, cos·ȧ)
      b.group.rotation.y = Math.atan2(-Math.sin(b.ang), Math.cos(b.ang))
      const flap = Math.sin(t * b.flapHz * Math.PI * 2 + b.flapOff) * 0.55
      b.wingL.rotation.z = 0.25 + flap
      b.wingR.rotation.z = -0.25 - flap
      b.voiceT -= dt
      if (b.voiceT <= 0) {
        b.voiceT = 7 + Math.random() * 12
        AudioManager.playAt('chirp', x, z, playerPos.x, playerPos.z, listenerYaw, 50, 0.85)
      }
    }
  }

  dispose() {
    for (const a of this.animals) if (a.crumb) { this.group.remove(a.crumb); a.crumb = null }
    this.animals = []
    this.birds = []
    this.group.clear()
  }
}
