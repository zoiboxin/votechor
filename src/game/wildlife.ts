// VoteChor wildlife — task 107: the 10 GLB animal species from the user's
// "Characters & Animals" pack live in the Vanodyan Jungle at RANDOM locations
// every session, plus the pack's four props (3 vehicles + water tower) placed
// as abandoned jungle landmarks.
//
// Design: independent client-side ambience bots — same philosophy as the street
// animals/birds in animals.ts, but DRIVEN BY THE PACK'S OWN GLB ANIMATION CLIPS
// (Idle/Idle_2/Idle_Headlow/Walk/Eating/Gallop) through tiny per-beast mixers.
// No server coupling, no physics coupling (kinematic, ground-sampled). They
// lazily stream the FIRST time the player approaches the wild (wildness gate),
// so city-only sessions never pay the ~30 MB download.
//
// FACING (v104 binary recipe, verified on every animal file): heads/horns
// extend +Z, canid tails swing −Z — the pack is natively +Z-facing, which is
// EXACTLY the VoteChor heading convention (ry = atan2(vx, vz)) → no flip.
import * as THREE from 'three'
import { GRAVEYARD, WORLD_DISC } from './shared/constants'
import { wildnessAt } from './jungle-ambience'
import type { GLBAssetManager, GLBAsset, GLBInstance } from './glb'
import type { PhysicsWorld } from './physics'

interface BeastDef {
  id: string
  url: string
  count: number
  /** wander speed (m/s) — plausibly scaled to species size */
  speed: number
}

const BEASTS: BeastDef[] = [
  { id: 'deer', url: '/models/deer.glb', count: 4, speed: 1.7 },
  { id: 'stag', url: '/models/stag.glb', count: 3, speed: 1.5 },
  { id: 'fox', url: '/models/fox.glb', count: 3, speed: 1.9 },
  { id: 'wolf', url: '/models/wolf.glb', count: 3, speed: 1.8 },
  { id: 'husky', url: '/models/husky.glb', count: 2, speed: 1.7 },
  { id: 'shiba', url: '/models/shiba-inu.glb', count: 3, speed: 1.4 },
  { id: 'cow', url: '/models/cow.glb', count: 3, speed: 0.9 },
  { id: 'bull', url: '/models/bull.glb', count: 2, speed: 1.0 },
  { id: 'donkey', url: '/models/donkey.glb', count: 2, speed: 1.0 },
  { id: 'horse', url: '/models/horse.glb', count: 2, speed: 1.3 },
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
  spookCd: number
}

interface Prop {
  inst: GLBInstance
}

function validSpot(x: number, z: number, used: Array<{ x: number; z: number }>, minDist: number, wildMin = 0.35): boolean {
  const dx = x - WORLD_DISC.cx
  const dz = z - WORLD_DISC.cz
  if (dx * dx + dz * dz > 600 * 600) return false
  if (z > 20) return false // the city band keeps its street animals; the wild starts here
  if (wildnessAt(x, z) < wildMin) return false
  const gx = x - GRAVEYARD.x
  const gz = z - GRAVEYARD.z
  const gr = GRAVEYARD.r + 16
  if (gx * gx + gz * gz < gr * gr) return false
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

  /** Idempotent lazy start — the first time the player nears the wild, the
   *  pack streams in and beasts spawn at random jungle spots. */
  ensureStarted(px: number, pz: number): void {
    if (this.started || this.disposed) return
    if (wildnessAt(px, pz) < 0.18) return
    this.started = true
    void this.build()
  }

  private async build(): Promise<void> {
    for (const def of BEASTS) {
      if (this.disposed) return
      const asset = await this.mgr.load(def.url)
      if (!asset) continue // loader already logged; this species just stays home
      let last: { x: number; z: number } | null = null
      for (let n = 0; n < def.count; n++) {
        if (this.disposed) return
        // HERD clustering: the first member rejection-samples a fresh wild spot;
        // later members huddle near the previous one (natural herds AND the
        // jungle actually reads alive when a player finds one group)
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
        this.spawnBeast(def, asset, spot)
      }
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

  private spawnBeast(def: BeastDef, asset: GLBAsset, spot: { x: number; z: number }): void {
    const inst = this.mgr.instantiate(asset)
    if (!inst) return
    this.used.push(spot)
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
      wanderR: 9 + Math.random() * 12,
      target: { x: spot.x, z: spot.z },
      ry: Math.random() * Math.PI * 2,
      y: this.physics.groundHeight(spot.x, spot.z, 40),
      spookCd: 0,
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

  update(dt: number, player: { x: number; z: number }): void {
    if (!this.beasts.length) return
    for (const b of this.beasts) {
      const dx = player.x - b.inst.group.position.x
      const dz = player.z - b.inst.group.position.z
      const distSq = dx * dx + dz * dz
      const far = distSq > 140 * 140
      const hidden = distSq > 190 * 190
      if (b.inst.group.visible !== !hidden) b.inst.group.visible = !hidden
      if (b.spookCd > 0) b.spookCd -= dt

      // spook: player stumbles into a beast → short flight away (herbivore energy)
      if (!far && b.state !== 'flee' && b.gallop && b.spookCd <= 0 && distSq < 5.5 * 5.5) {
        b.state = 'flee'
        b.stateT = 1.5 + Math.random() * 0.9
        b.spookCd = 9
        const away = Math.atan2(-dx, -dz) + (Math.random() - 0.5) * 0.6
        b.target.x = b.inst.group.position.x + Math.sin(away) * 22
        b.target.z = b.inst.group.position.z + Math.cos(away) * 22
        this.play(b, b.gallop, 0.18)
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
          const tx = b.target.x - b.inst.group.position.x
          const tz = b.target.z - b.inst.group.position.z
          const d = Math.hypot(tx, tz)
          const speed = b.state === 'flee' ? b.def.speed * 2.6 : b.def.speed
          const arrive = b.state === 'flee' ? 0.6 : 0.5
          if (d < arrive || b.stateT <= 0) {
            b.state = 'idle'
            b.stateT = 2.5 + Math.random() * 5
            this.play(b, b.idles[0] ?? null)
          } else {
            const step = Math.min(speed * dt, d)
            const nx = b.inst.group.position.x + (tx / d) * step
            const nz = b.inst.group.position.z + (tz / d) * step
            // heading: the pack faces +Z, same convention as the players
            const want = Math.atan2(tx, tz)
            let dr = want - b.ry
            while (dr > Math.PI) dr -= Math.PI * 2
            while (dr < -Math.PI) dr += Math.PI * 2
            b.ry += dr * Math.min(1, dt * 5)
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
