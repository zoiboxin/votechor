// VoteChor wildlife — task 109 reshuffle (user brief: "keep dogs cats inside
// city, cow/horse/donkey near city, wild animals in jungle"), superseding the
// task-108 graveyard habitat. The 10 GLB species from the user's
// "Characters & Animals" pack now live in three HABITATS:
//   • PETS (shiba-inu, husky — the GLB dogs) live IN the city streets, pinned to
//     the same proven street-animal corners the procedural dogs/cats have used
//     since v66. (The pack ships no cat GLB — the city's cats remain the
//     procedural street cats of animal-sim.ts.)
//   • DOMESTIC herds (cow, bull, donkey, horse) graze BOTH flanks: a city-edge
//     pasture just off the avenue corridor (walking distance — impossible to
//     miss) and a farm-belt pasture out in the Zone-B countryside fields.
//   • JUNGLE (deer, stag, wolf, fox) — rejection-sampled wild spots, reshuffled
//     every session. The fox moved here from the graveyard (it is a wild animal
//     in the new grouping); the husky moved into the city (it is a dog).
// LAZY-START FIX: task 108 gated the build behind a 65 m walk from spawn — but
// the nearest city sites sit at 55 m, so a player strolling the spawn plaza
// never saw a single beast start loading. The build now starts on the FIRST
// match frame: loads stream in sequentially, and the five city/edge species
// (≈14 MB) are pre-warmed by the cookie-consent cache.
// PANIC-FLEE (unchanged core): every beast has a species temperament radius —
// the moment the player steps inside it, the beast bolts (Gallop clip), keeps
// RE-AIMING its escape vector while it is still chased (so the player can
// never corner it), and only settles once the threat is gone.
// Pets and domestic beasts are habituated (small panic radius, slower flight,
// leashed to their patch); wild ones are skittish (big radius, fast, long
// flight). A spatial panic voice (moo/bark) sells the moment.
//
// Design unchanged from task 107: independent client-side ambience bots driven
// by the pack's own GLB clips through tiny per-beast mixers; no server/physics
// coupling (kinematic, ground-sampled).
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

type Habitat = 'pet' | 'domestic' | 'jungle'

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
  /** PETS: one member per street corner (count must match the list) */
  petSites?: Array<[number, number]>
  /** DOMESTIC: the city-edge pasture [x, z] (just off the avenue corridor) */
  cityHerd?: [number, number]
  /** DOMESTIC: the farm-belt pasture [x, z] (Zone-B countryside fields) */
  farmHerd?: [number, number]
  /** DOMESTIC: members huddling the city-edge vs farm-belt pasture */
  cityCount?: number
  farmCount?: number
}

const BEASTS: BeastDef[] = [
  // ---- CITY PETS: the GLB dogs live IN the streets, at the same proven
  //      street-animal corners the procedural dogs/cats have used since v66
  //      (all ≥4 m off every vehicle lane). No cat GLB ships in the pack —
  //      the city cats stay procedural (animal-sim.ts).
  { id: 'shiba', url: '/models/shiba-inu.glb', count: 3, speed: 1.4, habitat: 'pet', panicR: 6.0, fleeMul: 2.8, leash: 20, voice: 'bark',
    petSites: [[8, -66], [-7, -188], [10, -462]] },       // plaza side · market exit · colony cross
  { id: 'husky', url: '/models/husky.glb', count: 2, speed: 1.6, habitat: 'pet', panicR: 6.5, fleeMul: 2.8, leash: 22, voice: 'bark',
    petSites: [[-12, -272], [11, -516]] },                // avenue cross · parliament approach
  // ---- DOMESTIC HERDS: every species grazes BOTH flanks — a city-edge
  //      pasture just off the avenue corridor (x ±6..11, between the cross
  //      streets, outside the zone-D widened asphalt) AND a farm-belt pasture
  //      out among the Zone-B countryside fields. City first per the brief:
  //      "cow near horse donkey near city".
  { id: 'cow',    url: '/models/cow.glb',    count: 4, speed: 0.9, habitat: 'domestic', panicR: 4.6, fleeMul: 2.2, leash: 24, voice: 'moo',
    cityHerd: [9, -105],   cityCount: 2, farmHerd: [120, -240], farmCount: 2 },
  { id: 'bull',   url: '/models/bull.glb',   count: 2, speed: 1.0, habitat: 'domestic', panicR: 5.0, fleeMul: 2.4, leash: 24, voice: 'moo',
    cityHerd: [-9, -145],  cityCount: 1, farmHerd: [-132, -430], farmCount: 1 },
  { id: 'donkey', url: '/models/donkey.glb', count: 3, speed: 1.0, habitat: 'domestic', panicR: 5.4, fleeMul: 2.4, leash: 24, voice: 'moo',
    cityHerd: [10, -438],  cityCount: 2, farmHerd: [128, -470], farmCount: 1 },
  { id: 'horse',  url: '/models/horse.glb',  count: 3, speed: 1.3, habitat: 'domestic', panicR: 6.0, fleeMul: 2.8, leash: 26, voice: 'moo',
    cityHerd: [9, -240],   cityCount: 2, farmHerd: [62, -588],  farmCount: 1 },
  // ---- JUNGLE: the deep wild, random every session (the fox is a wild
  //      animal in this grouping — moved here from the task-108 graveyard) ----
  { id: 'fox',    url: '/models/fox.glb', count: 3, speed: 1.9, habitat: 'jungle', panicR: 8.5, fleeMul: 2.9, leash: 40, voice: 'bark' },
  { id: 'deer',   url: '/models/deer.glb', count: 4, speed: 1.7, habitat: 'jungle', panicR: 10.5, fleeMul: 3.0, leash: 40, voice: null },
  { id: 'stag',   url: '/models/stag.glb', count: 3, speed: 1.5, habitat: 'jungle', panicR: 10.0, fleeMul: 3.0, leash: 40, voice: null },
  { id: 'wolf',   url: '/models/wolf.glb', count: 3, speed: 1.8, habitat: 'jungle', panicR: 9.0,  fleeMul: 3.0, leash: 40, voice: null },
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

/** Common hazard exclusions for the anchored habitats (pets + domestic):
 *  inside the disc, off the Kabristan interior, out of the Bhayanak river band
 *  and the arena exit corridor, and not stacked on a claimed spot. */
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

export class WildlifeSystem {
  readonly group = new THREE.Group()
  private mgr: GLBAssetManager
  private physics: PhysicsWorld
  private beasts: Beast[] = []
  private props: Prop[] = []
  private used: Array<{ x: number; z: number }> = []
  private started = false
  private disposed = false

  constructor(mgr: GLBAssetManager, physics: PhysicsWorld) {
    this.mgr = mgr
    this.physics = physics
    this.group.name = 'vc-wildlife'
  }

  /** Idempotent start — task 109 FIX: the old gates (wildness-only, then a
   *  65 m walk from spawn) starved the CITY sites — the nearest herds sit at
   *  55 m from spawn, so a player looking around the city beat the gate and
   *  saw nothing start. The build now fires on the FIRST match frame: loads
   *  stream in one-by-one (no frame hitch) and the cookie-consent cache has
   *  already pre-warmed the city/edge species. */
  ensureStarted(): void {
    if (this.started || this.disposed) return
    this.started = true
    void this.build()
  }

  private async build(): Promise<void> {
    for (const def of BEASTS) {
      if (this.disposed) return
      const asset = await this.mgr.load(def.url)
      if (!asset) continue // loader already logged; this species just stays home
      if (def.habitat === 'pet') this.spawnPets(def, asset)
      else if (def.habitat === 'domestic') this.spawnDomestic(def, asset)
      else this.spawnJungle(def, asset)
    }
    // QA affordance: a one-shot census of what actually spawned (and where),
    // so "the animals aren't showing" can be diagnosed from __vcDiag directly.
    try {
      const w = window as unknown as { __vcDiag?: Array<Record<string, unknown>> }
      w.__vcDiag = w.__vcDiag ?? []
      w.__vcDiag.push({
        kind: 'wildlifeCensus',
        beasts: this.beasts.map((b) => ({ id: b.def.id, x: Math.round(b.inst.group.position.x), z: Math.round(b.inst.group.position.z) })),
        props: this.props.length,
        t: Date.now(),
      })
    } catch { /* diag is best-effort */ }
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

  /** CITY PETS: one dog per proven street corner, huddled with a little
   *  sidewalk-side jitter so they don't stand stacked on the exact spot. */
  private spawnPets(def: BeastDef, asset: GLBAsset): void {
    const sites = def.petSites ?? []
    for (let n = 0; n < def.count; n++) {
      if (this.disposed) return
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
      this.spawnBeast(def, asset, spot, 6 + Math.random() * 4)
    }
  }

  /** DOMESTIC herds: every species splits its members between a CITY-EDGE
   *  pasture (just off the avenue corridor — impossible to miss on foot) and a
   *  FARM-BELT pasture out in the Zone-B countryside, so both zones are
   *  stocked every session (task 109: the old single-site toggle let a whole
   *  species end up somewhere the player never walks). */
  private spawnDomestic(def: BeastDef, asset: GLBAsset): void {
    const groups: Array<{ site: [number, number] | undefined; n: number }> = [
      { site: def.cityHerd, n: def.cityCount ?? 0 },
      { site: def.farmHerd, n: def.farmCount ?? 0 },
    ]
    for (const g of groups) {
      if (!g.site || g.n <= 0) continue
      let last: { x: number; z: number } | null = null
      for (let n = 0; n < g.n; n++) {
        if (this.disposed) return
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
        this.spawnBeast(def, asset, spot, 5 + Math.random() * 4)
      }
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
  }
}
