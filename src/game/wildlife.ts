// VoteChor wildlife — task 108: the 10 GLB animal species from the user's
// "Characters & Animals" pack now live in three HABITATS (per the user's brief):
//   • DOMESTIC (cow, bull, donkey, horse, shiba-inu) — herds at the city street
//     margins + the countryside farm belt. These REPLACE the old procedural
//     traffic cows (world-def veh_cow1..6 and the street-animal cow spots).
//   • GRAVEYARD (fox, husky) — haunting the Vanodyan Kabristan fence ring and
//     the three forgotten-grave clusters of the far wild.
//   • JUNGLE (deer, stag, wolf) — rejection-sampled wild spots, reshuffled every
//     session.
// PANIC-FLEE (the core of this task): every beast has a species temperament
// radius — the moment the player steps inside it, the beast bolts (Gallop
// clip), keeps RE-AIMING its escape vector while it is still chased (so the
// player can never corner it), and only settles once the threat is gone.
// Domestic beasts are habituated (small panic radius, slower flight, leashed
// to their pasture); wild ones are skittish (big radius, fast, long flight).
// A spatial panic voice (moo/bark) sells the moment.
//
// Design unchanged from task 107: independent client-side ambience bots driven
// by the pack's own GLB clips through tiny per-beast mixers; no server/physics
// coupling (kinematic, ground-sampled); lazily streamed on first approach.
//
// FACING (v104 binary recipe, verified on every animal file): heads/horns
// extend +Z, canid tails swing −Z — the pack is natively +Z-facing, which is
// EXACTLY the VoteChor heading convention (ry = atan2(vx, vz)) → no flip.
import * as THREE from 'three'
import { GRAVEYARD, WORLD_DISC } from './shared/constants'
import { wildnessAt } from './jungle-ambience'
import { AudioManager, type SfxName } from './audio'
import type { GLBAssetManager, GLBAsset, GLBInstance } from './glb'
import type { PhysicsWorld } from './physics'

type Habitat = 'domestic' | 'graveyard' | 'jungle'

interface BeastDef {
  id: string
  url: string
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
}

const BEASTS: BeastDef[] = [
  // ---- DOMESTIC: the old street/traffic cows' replacements — city + farm ----
  { id: 'cow',    url: '/models/cow.glb',       count: 3, speed: 0.9, habitat: 'domestic',  panicR: 4.6, fleeMul: 2.2, leash: 24, voice: 'moo' },
  { id: 'bull',   url: '/models/bull.glb',      count: 2, speed: 1.0, habitat: 'domestic',  panicR: 5.0, fleeMul: 2.4, leash: 24, voice: 'moo' },
  { id: 'donkey', url: '/models/donkey.glb',    count: 2, speed: 1.0, habitat: 'domestic',  panicR: 5.4, fleeMul: 2.4, leash: 24, voice: 'moo' },
  { id: 'horse',  url: '/models/horse.glb',     count: 2, speed: 1.3, habitat: 'domestic',  panicR: 6.0, fleeMul: 2.8, leash: 26, voice: 'moo' },
  { id: 'shiba',  url: '/models/shiba-inu.glb', count: 2, speed: 1.4, habitat: 'domestic',  panicR: 6.5, fleeMul: 2.8, leash: 22, voice: 'bark' },
  // ---- GRAVEYARD: scavengers of the Kabristan + the forgotten clusters ----
  { id: 'fox',    url: '/models/fox.glb',       count: 3, speed: 1.9, habitat: 'graveyard', panicR: 8.5, fleeMul: 2.9, leash: 30, voice: 'bark' },
  { id: 'husky',  url: '/models/husky.glb',     count: 2, speed: 1.7, habitat: 'graveyard', panicR: 8.0, fleeMul: 2.9, leash: 30, voice: 'bark' },
  // ---- JUNGLE: the deep wild, random every session ----
  { id: 'deer',   url: '/models/deer.glb',      count: 4, speed: 1.7, habitat: 'jungle', panicR: 10.5, fleeMul: 3.0, leash: 40, voice: null },
  { id: 'stag',   url: '/models/stag.glb',      count: 3, speed: 1.5, habitat: 'jungle', panicR: 10.0, fleeMul: 3.0, leash: 40, voice: null },
  { id: 'wolf',   url: '/models/wolf.glb',      count: 3, speed: 1.8, habitat: 'jungle', panicR: 9.0,  fleeMul: 3.0, leash: 40, voice: null },
]

// DOMESTIC herd sites. City pool = the exact street margins the old procedural
// street animals used (all verified ≥4 m off every vehicle lane by the v66
// route data); farm pool = the Zone-B countryside field belt that continues the
// ring roads outward. Each species pops ONE site from the pools (alternating
// city/farm so both zones are always stocked) and huddles its herd there.
const CITY_MARGINS: Array<{ x: number; z: number }> = [
  { x: 10,  z: -400 }, // grand avenue east margin (the classic cow spot)
  { x: -6,  z: -505 }, // Parliament Plaza north edge
  { x: 8,   z: -62 },  // plaza side, north of Plaza Cross Rd
  { x: -7,  z: -188 }, // Market Exit margin
  { x: 10,  z: -462 }, // Colony Cross Rd east margin
]
const FARM_BELT: Array<{ x: number; z: number }> = [
  { x: 120,  z: -240 }, // east countryside field belt
  { x: -125, z: -215 }, // west countryside field belt
  { x: 132,  z: -455 }, // SE countryside by the ring road
  { x: -132, z: -430 }, // SW countryside
  { x: 62,   z: -588 }, // south fields before the Vanodyan Deep
]

// GRAVEYARD sites: the Kabristan itself (beasts scavenge just OUTSIDE the
// grave ring — r+5..r+16) + the three v71 forgotten-grave clusters of the far
// wild (NW wing, SE wing, far north). Members round-robin across the sites so
// every session haunts several graveyards at once.
const GRAVE_SITES: Array<{ x: number; z: number; r: number }> = [
  { x: GRAVEYARD.x, z: GRAVEYARD.z, r: GRAVEYARD.r }, // Vanodyan Kabristan
  { x: -330, z: -100, r: 12 }, // NW forgotten graves
  { x: 300,  z: -620, r: 12 }, // SE forgotten graves
  { x: -30,  z: 62,   r: 12 }, // far-north forgotten graves
]

const PROPS: Array<{ url: string }> = [
  { url: '/models/vehicle-pickup.glb' },
  { url: '/models/vehicle-sports.glb' },
  { url: '/models/vehicle-truck.glb' },
  { url: '/models/water-tower.glb' },
]

type BeastState = 'idle' | 'walk' | 'eat' | 'flee'

interface Beast {
  def: BeastDef
  inst: GLBInstance
  idles: THREE.AnimationClip[]
  walk: THREE.AnimationClip | null
  gallop: THREE.AnimationClip | null
  eat: THREE.AnimationClip | null
  cur: THREE.AnimationAction | null
  state: BeastState
  stateT: number
  home: { x: number; z: number }
  wanderR: number
  target: { x: number; z: number }
  ry: number
  y: number
  /** panic re-aim countdown (s) — keeps the escape vector fresh while chased */
  reevalT: number
  /** spatial voice cooldown (s) so a long chase does not spam audio nodes */
  voiceCd: number
}

interface Prop {
  inst: GLBInstance
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

/** Common hazard exclusions for the anchored habitats (domestic + graveyard):
 *  inside the disc, off the Kabristan interior, out of the Bhayanak river band
 *  and the arena exit corridor, and not stacked on a claimed spot. Graveyard
 *  scavengers pass avoidGraveyard=false — they are SUPPOSED to haunt the
 *  Kabristan fence ring. */
function anchoredValid(x: number, z: number, used: Array<{ x: number; z: number }>, minDist: number, avoidGraveyard = true): boolean {
  if (!inDisc(x, z)) return false
  if (avoidGraveyard && nearGraveyard(x, z)) return false
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

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export class WildlifeSystem {
  readonly group = new THREE.Group()
  private mgr: GLBAssetManager
  private physics: PhysicsWorld
  private beasts: Beast[] = []
  private props: Prop[] = []
  private used: Array<{ x: number; z: number }> = []
  private cityPool: Array<{ x: number; z: number }> = []
  private farmPool: Array<{ x: number; z: number }> = []
  private gravePool: Array<{ x: number; z: number; r: number }> = []
  private started = false
  private disposed = false

  constructor(mgr: GLBAssetManager, physics: PhysicsWorld) {
    this.mgr = mgr
    this.physics = physics
    this.group.name = 'vc-wildlife'
  }

  /** Idempotent lazy start — task 108: the domestic herds live AT the city
   *  margins now, so the old wildness-only gate would never open for a city
   *  session. Start once the player leaves the spawn plaza (0, −8) by 65 m —
   *  every real match does within its first minute — or wanders into the wild. */
  ensureStarted(px: number, pz: number): void {
    if (this.started || this.disposed) return
    if (wildnessAt(px, pz) < 0.18 && Math.hypot(px, pz + 8) < 65) return
    this.started = true
    void this.build()
  }

  private async build(): Promise<void> {
    // per-session habitat pools (reshuffled every build)
    this.cityPool = shuffled(CITY_MARGINS)
    this.farmPool = shuffled(FARM_BELT)
    this.gravePool = shuffled(GRAVE_SITES)
    for (const def of BEASTS) {
      if (this.disposed) return
      const asset = await this.mgr.load(def.url)
      if (!asset) continue // loader already logged; this species just stays home
      if (def.habitat === 'domestic') this.spawnDomestic(def, asset)
      else if (def.habitat === 'graveyard') this.spawnGraveyard(def, asset)
      else this.spawnJungle(def, asset)
    }
    // abandoned landmarks — bigger spacing so they read as intentional set pieces
    for (const p of PROPS) {
      if (this.disposed) return
      const asset = await this.mgr.load(p.url)
      if (!asset) continue
      const inst = this.mgr.instantiate(asset)
      if (!inst) continue
      const spot = pickSpot(this.used, 26)
      if (!spot) { this.mgr.disposeInstance(inst); continue }
      this.used.push(spot)
      const y = this.physics.groundHeight(spot.x, spot.z, 40)
      inst.group.position.set(spot.x, y, spot.z)
      inst.group.rotation.y = Math.random() * Math.PI * 2
      this.group.add(inst.group)
      this.props.push({ inst })
    }
  }

  /** DOMESTIC herds: alternate the city-margin and farm-belt pools so both
   *  zones are always stocked, huddling each species' herd at its own site. */
  private domesticToggle = false
  private spawnDomestic(def: BeastDef, asset: GLBAsset): void {
    let pool: Array<{ x: number; z: number }>
    if (this.cityPool.length && this.farmPool.length) {
      this.domesticToggle = !this.domesticToggle
      pool = this.domesticToggle ? this.cityPool : this.farmPool
    } else {
      pool = this.cityPool.length ? this.cityPool : this.farmPool
    }
    const site = pool.shift()
    if (!site) return
    let last: { x: number; z: number } | null = null
    for (let n = 0; n < def.count; n++) {
      if (this.disposed) return
      let spot: { x: number; z: number } | null = null
      for (let t = 0; t < 14 && !spot; t++) {
        const base = last ?? site
        const j = last ? 7 : 4
        const x = base.x + (Math.random() * 2 - 1) * j
        const z = base.z + (Math.random() * 2 - 1) * j
        if (anchoredValid(x, z, this.used, 3)) spot = { x, z }
      }
      if (!spot) spot = { x: site.x + (Math.random() * 2 - 1) * 4, z: site.z + (Math.random() * 2 - 1) * 4 }
      last = spot
      this.used.push(spot)
      this.spawnBeast(def, asset, spot, 5 + Math.random() * 4)
    }
  }

  /** GRAVEYARD scavengers: members round-robin across the Kabristan + the
   *  three forgotten clusters — several haunted graveyards every session. */
  private spawnGraveyard(def: BeastDef, asset: GLBAsset): void {
    const baseIdx = Math.floor(Math.random() * this.gravePool.length)
    for (let n = 0; n < def.count; n++) {
      if (this.disposed) return
      const site = this.gravePool[(baseIdx + n) % this.gravePool.length] ?? GRAVE_SITES[0]
      // the Kabristan (r 44): the fence ring r+5..r+16, just outside the graves;
      // the small forgotten clusters: anywhere in the patch
      const rMin = site.r > 20 ? site.r + 5 : 2
      const rMax = site.r > 20 ? site.r + 16 : site.r
      let spot: { x: number; z: number } | null = null
      for (let t = 0; t < 14 && !spot; t++) {
        const a = Math.random() * Math.PI * 2
        const r = rMin + Math.random() * (rMax - rMin)
        const x = site.x + Math.cos(a) * r
        const z = site.z + Math.sin(a) * r
        if (anchoredValid(x, z, this.used, 3.5, false)) spot = { x, z }
      }
      if (!spot) continue // grave site is jammed this session — skip the member
      this.used.push(spot)
      this.spawnBeast(def, asset, spot, 7 + Math.random() * 6)
    }
  }

  /** JUNGLE wanderers: the task-107 rejection sampling + herd clustering. */
  private spawnJungle(def: BeastDef, asset: GLBAsset): void {
    let last: { x: number; z: number } | null = null
    for (let n = 0; n < def.count; n++) {
      if (this.disposed) return
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
      this.spawnBeast(def, asset, spot, 9 + Math.random() * 12)
    }
  }

  private spawnBeast(def: BeastDef, asset: GLBAsset, spot: { x: number; z: number }, wanderR: number): void {
    const inst = this.mgr.instantiate(asset)
    if (!inst) return
    // resolve the species' clip set (names are lowercased by instantiate())
    const clip = (name: string) => inst.clips.get(name) ?? null
    const idles = ['idle', 'idle_2', 'idle_headlow', 'idle_2_headlow']
      .map((n) => clip(n))
      .filter((c): c is THREE.AnimationClip => !!c)
    const beast: Beast = {
      def,
      inst,
      idles,
      walk: clip('walk'),
      gallop: clip('gallop') ?? clip('gallop_jump'),
      eat: clip('eating'),
      cur: null,
      state: 'idle',
      stateT: 2 + Math.random() * 5,
      home: { x: spot.x, z: spot.z },
      wanderR,
      target: { x: spot.x, z: spot.z },
      ry: Math.random() * Math.PI * 2,
      y: this.physics.groundHeight(spot.x, spot.z, 40),
      reevalT: 0,
      voiceCd: 0,
    }
    inst.group.position.set(spot.x, beast.y, spot.z)
    inst.group.rotation.y = beast.ry
    this.group.add(inst.group)
    this.beasts.push(beast)
    this.play(beast, beast.idles[0] ?? null)
  }

  private play(b: Beast, c: THREE.AnimationClip | null, fade = 0.3): void {
    if (!c) return
    const next = b.inst.mixer.clipAction(c)
    if (b.cur === next) return
    next.reset().fadeIn(fade).play()
    if (b.cur) b.cur.fadeOut(fade)
    b.cur = next
  }

  private retarget(b: Beast): void {
    const ang = Math.random() * Math.PI * 2
    const r = 4 + Math.random() * (b.wanderR - 4)
    b.target.x = b.home.x + Math.cos(ang) * r
    b.target.z = b.home.z + Math.sin(ang) * r
  }

  /** PANIC VECTOR — aim away from the player with a slight random tangent,
   *  then clamp onto the home leash so a flight can never drag a cow three
   *  districts away (or a fox off its graveyard). */
  private retargetFlee(b: Beast, px: number, pz: number): void {
    const pos = b.inst.group.position
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
    AudioManager.playAt(b.def.voice, b.inst.group.position.x, b.inst.group.position.z, px, pz, yaw, 46, 1.0)
  }

  update(dt: number, player: { x: number; z: number }, yaw = 0): void {
    if (!this.beasts.length) return
    for (const b of this.beasts) {
      const def = b.def
      const pos = b.inst.group.position
      const dx = player.x - pos.x
      const dz = player.z - pos.z
      const distSq = dx * dx + dz * dz
      const far = distSq > 140 * 140
      const hidden = distSq > 190 * 190
      if (b.inst.group.visible !== !hidden) b.inst.group.visible = !hidden
      if (b.voiceCd > 0) b.voiceCd -= dt

      // ---- PANIC: the player stepped inside the species' comfort radius ----
      if (b.state !== 'flee' && !far && distSq < def.panicR * def.panicR) {
        b.state = 'flee'
        b.stateT = 2.2
        b.reevalT = 0
        this.retargetFlee(b, player.x, player.z)
        this.play(b, b.gallop ?? b.walk, 0.16)
        this.voice(b, player.x, player.z, yaw)
      }

      b.stateT -= dt
      switch (b.state) {
        case 'idle': {
          if (b.stateT <= 0) {
            const roll = Math.random()
            if (roll < 0.45 && b.walk) {
              b.state = 'walk'
              b.stateT = 20 // arrival-based; safety ceiling
              this.retarget(b)
              this.play(b, b.walk)
            } else if (roll < 0.72 && b.eat) {
              b.state = 'eat'
              b.stateT = 3 + Math.random() * 4
              this.play(b, b.eat)
            } else {
              b.stateT = 3 + Math.random() * 6
              if (b.idles.length > 1 && Math.random() < 0.5) this.play(b, b.idles[Math.floor(Math.random() * b.idles.length)])
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
              this.play(b, b.idles[0] ?? null)
            }
          } else {
            const step = Math.min(speed * dt, d)
            const nx = pos.x + (tx / d) * step
            const nz = pos.z + (tz / d) * step
            // heading: the pack faces +Z, same convention as the players
            const want = Math.atan2(tx, tz)
            let dr = want - b.ry
            while (dr > Math.PI) dr -= Math.PI * 2
            while (dr < -Math.PI) dr += Math.PI * 2
            b.ry += dr * Math.min(1, dt * (fleeing ? 7 : 5))
            b.inst.group.rotation.y = b.ry
            b.inst.group.position.set(nx, this.physics.groundHeight(nx, nz, 40), nz)
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

      // skinning is the cost — freeze the mixer beyond 140 m (pose holds)
      if (!far) b.inst.mixer.update(dt)
    }
  }

  dispose(): void {
    this.disposed = true
    for (const b of this.beasts) this.mgr.disposeInstance(b.inst)
    for (const p of this.props) this.mgr.disposeInstance(p.inst)
    this.beasts = []
    this.props = []
    this.used = []
    this.cityPool = []
    this.farmPool = []
    this.gravePool = []
  }
}
