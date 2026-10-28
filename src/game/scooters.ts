// VoteChor drivable scooters — "Hamara Scooter" fleet (v115).
//
// The master-prompt stretch goal: parked pastel scooters around the city that a
// player can mount with E and drive arcade-style (throttle, brake/reverse,
// speed-sensitive steering, lean-into-turns). Space rings the bell — comedy
// first, police attention second. Everything is client-driven: the rider's own
// position stream IS the scooter's position, so the server needs no new
// protocol fields — remotes simply see `anim: 'ride'` and a scooter is attached
// under their rig by syncRemotes().
//
// Design guards:
// - Top speed 12.5 m/s stays under the 13.5 m/s remote-interpolation cap.
// - Drive integration reuses physics.moveActor (radius 0.95) so scooters
//   respect every wall, stall, bench and barricade the pedestrians do.
// - Parked spots are a fixed curated list (identical for every client).
import * as THREE from 'three'
import type { PhysicsWorld } from './physics'

export interface ScooterSpot { x: number; z: number; ry: number }

/** Curated roadside spots — spine corridor edges, cross streets, ring road, market. */
export const SCOOTER_SPOTS: ScooterSpot[] = [
  { x: 11.5, z: -7, ry: 0.5 },      // plaza east edge
  { x: -10.5, z: 5, ry: -1.3 },     // plaza west edge
  { x: 12.2, z: -84, ry: 0.1 },     // market street north
  { x: -12.2, z: -128, ry: 3.1 },   // market street south
  { x: 26, z: -193, ry: 1.57 },     // cross street -198 east
  { x: -32, z: -203, ry: -1.57 },   // cross street -198 west
  { x: -52, z: -86, ry: 0.8 },      // mall district approach
  { x: 70, z: -128, ry: 2.0 },      // colony lane
  { x: 160, z: -262, ry: 1.57 },    // ring road east
  { x: -150, z: -302, ry: 3.6 },    // ring road west
  { x: 12, z: -318, ry: 0.05 },     // south spine
  { x: -90, z: -58, ry: 1.9 },      // maidan chai cart
]

const MAX_SPEED = 12.5   // m/s (~45 km/h) — under the 13.5 m/s interpolation cap
const REVERSE_MAX = 4
const ACCEL = 7.5
const BRAKE = 16
const COAST_DRAG = 1.9
const TURN_BASE = 2.5    // rad/s at crawl; falls with speed
const MOUNT_RADIUS = 3.4

const PALETTE = ['#7fb069', '#e2727a', '#e8b64c', '#e07b39', '#f2e2c4', '#9a8bb8']

/** Shared Lambert material cache (keyed by color). */
const matCache = new Map<string, THREE.MeshLambertMaterial>()
function mat(color: string): THREE.MeshLambertMaterial {
  let m = matCache.get(color)
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); matCache.set(color, m) }
  return m
}
const DARK = '#3a3532'
const CHROME = '#c9c4bd'

export interface ScooterFeedback {
  /** >0 — wall crash at this speed (play impact, shake camera, comic popup). */
  crash: number
  /** Drive speed for HUD/camera effects. */
  speed: number
}

export class DrivableScooter {
  readonly id: string
  readonly group = new THREE.Group()
  pos = new THREE.Vector3()
  ry: number
  speed = 0 // signed m/s (+ forward)
  color: string
  private wheels: THREE.Mesh[] = []
  private baseRy: number
  /** Original curated spot — resetAll() returns the fleet here between matches. */
  originX = 0
  originZ = 0
  originRy = 0

  constructor(id: string, spot: ScooterSpot, color: string) {
    this.id = id
    this.baseRy = spot.ry
    this.ry = spot.ry
    this.color = color
    this.build()
    this.pos.set(spot.x, 0, spot.z)
    this.syncMesh()
  }

  private build() {
    const body = mat(this.color)
    const dark = mat(DARK)
    const chrome = mat(CHROME)

    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geo, m)
      mesh.position.set(x, y, z)
      mesh.rotation.x = rx
      mesh.rotation.z = rz
      this.group.add(mesh)
      return mesh
    }

    const wheelGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.12, 10)
    this.wheels.push(add(wheelGeo, dark, 0, 0.24, -0.58, 0, Math.PI / 2))
    this.wheels.push(add(wheelGeo.clone(), dark, 0, 0.24, 0.62, 0, Math.PI / 2))

    // rounded body shell — a squashed sphere reads pastel-cartoon at distance
    const shellGeo = new THREE.SphereGeometry(1, 12, 10)
    const shell = add(shellGeo, body, 0, 0.44, -0.12)
    shell.scale.set(0.34, 0.3, 0.86)
    const apron = add(new THREE.BoxGeometry(0.32, 0.52, 0.18), body, 0, 0.66, 0.44, 0.18)
    apron.name = 'apron'
    add(new THREE.BoxGeometry(0.3, 0.05, 0.52), dark, 0, 0.22, 0.18) // floorboard
    add(new THREE.BoxGeometry(0.36, 0.11, 0.52), dark, 0, 0.58, -0.24) // seat
    const column = add(new THREE.CylinderGeometry(0.03, 0.035, 0.52, 6), chrome, 0, 0.72, 0.44, 0.32)
    column.name = 'column'
    add(new THREE.BoxGeometry(0.58, 0.045, 0.05), chrome, 0, 0.96, 0.5) // handlebar
    const lamp = add(new THREE.SphereGeometry(0.075, 8, 6), mat('#ffe9b0'), 0, 0.82, 0.55)
    const lampMat = lamp.material as THREE.MeshLambertMaterial
    lampMat.emissive = new THREE.Color('#b8933a')

    // comedy pennant flag on a stick — visible over crowds, flutters while riding
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 5), chrome, 0, 0.95, -0.52)
    const pennant = add(new THREE.ConeGeometry(0.09, 0.26, 3), body, 0.09, 1.16, -0.52, 0, -Math.PI / 2)
    pennant.name = 'pennant'
  }

  syncMesh() {
    this.group.position.copy(this.pos)
    this.group.rotation.y = this.ry
  }

  spinWheels(dt: number) {
    const w = this.speed * dt / 0.24
    for (const wheel of this.wheels) wheel.rotation.x += w
  }

  lean(steerEff: number) {
    this.group.rotation.z = -steerEff * 0.16 * Math.min(1, Math.abs(this.speed) / 7)
  }

  /** Back to the curated bay (match teardown). */
  resetToOrigin() {
    this.pos.set(this.originX, 0, this.originZ)
    this.ry = this.originRy
    this.speed = 0
    this.group.rotation.z = 0
    this.syncMesh()
  }
}

export class ScooterSystem {
  readonly group = new THREE.Group()
  readonly scooters: DrivableScooter[] = []
  mounted: DrivableScooter | null = null
  /** Rendering pool of spare scooters parented under remote riders (anim 'ride'). */
  private riderPool: THREE.Group[] = []
  private bellCd = 0

  constructor(private physics: PhysicsWorld, scene: THREE.Scene) {
    for (let i = 0; i < SCOOTER_SPOTS.length; i++) {
      const spot = SCOOTER_SPOTS[i]
      const sc = new DrivableScooter(`sc${i}`, spot, PALETTE[i % PALETTE.length])
      sc.originX = spot.x
      sc.originZ = spot.z
      sc.originRy = spot.ry
      this.scooters.push(sc)
      this.group.add(sc.group)
    }
    // 6 remote-rider scooters (same cartoon look, muted palette)
    for (let i = 0; i < 6; i++) {
      const sc = new DrivableScooter(`pool${i}`, { x: 0, z: 0, ry: 0 }, PALETTE[(i + 2) % PALETTE.length])
      sc.group.visible = false
      this.riderPool.push(sc.group)
      this.group.add(sc.group)
    }
    scene.add(this.group)
  }

  nearestMountable(x: number, z: number): DrivableScooter | null {
    let best: DrivableScooter | null = null
    let bestD = MOUNT_RADIUS
    for (const sc of this.scooters) {
      if (sc === this.mounted) continue
      const d = Math.hypot(sc.pos.x - x, sc.pos.z - z)
      if (d < bestD) { bestD = d; best = sc }
    }
    return best
  }

  mount(sc: DrivableScooter) {
    this.mounted = sc
    sc.speed = 0
  }

  /** Step off — the scooter stays exactly where it was left. Returns the mount point beside it. */
  dismount(): { x: number; z: number } {
    const sc = this.mounted
    if (!sc) return { x: 0, z: 0 }
    const sideX = sc.pos.x + Math.cos(sc.ry) * 1.1
    const sideZ = sc.pos.z - Math.sin(sc.ry) * 1.1
    sc.speed = 0
    sc.group.rotation.z = 0
    this.mounted = null
    return { x: sideX, z: sideZ }
  }

  /** True if the bell actually rang (cooldown gate) — caller plays SFX + noise. */
  ringBell(): boolean {
    if (this.bellCd > 0 || !this.mounted) return false
    this.bellCd = 0.55
    return true
  }

  /** Arcade drive tick — call INSTEAD of player.applyInput while mounted. */
  update(dt: number, drive: { forward: number; strafe: number }): ScooterFeedback {
    const sc = this.mounted
    this.bellCd = Math.max(0, this.bellCd - dt)
    if (!sc) return { crash: 0, speed: 0 }

    // steering — rate falls with speed, flips in reverse (real scooter feel)
    const steerEff = drive.strafe
    const turn = TURN_BASE / (1 + Math.abs(sc.speed) * 0.13)
    sc.ry -= steerEff * turn * dt * (sc.speed < -0.2 ? -1 : 1)

    // throttle / brake / coast
    const fwd = drive.forward
    if (fwd > 0.05) {
      sc.speed = Math.min(MAX_SPEED, sc.speed + ACCEL * fwd * dt)
    } else if (fwd < -0.05) {
      if (sc.speed > 0.2) sc.speed = Math.max(0, sc.speed - BRAKE * dt)
      else sc.speed = Math.max(-REVERSE_MAX, sc.speed + ACCEL * 0.6 * fwd * dt)
    } else {
      const drag = COAST_DRAG * dt
      sc.speed = Math.abs(sc.speed) <= drag ? 0 : sc.speed - Math.sign(sc.speed) * drag
    }

    // integrate along the heading through the shared collision world
    const vel = { x: Math.sin(sc.ry) * sc.speed, y: 0, z: Math.cos(sc.ry) * sc.speed }
    const res = this.physics.moveActor(sc.pos, vel, dt, 0.95, 1.6)
    let crash = 0
    if (res.hitWall) {
      if (Math.abs(sc.speed) > 6.5) crash = Math.abs(sc.speed)
      sc.speed *= -0.18 // comic bounce-back off the obstacle
    }
    sc.spinWheels(dt)
    sc.lean(steerEff)
    sc.syncMesh()
    return { crash, speed: sc.speed }
  }

  /**
   * Remote riders — for every remote whose anim is 'ride', parent a pooled
   * scooter under their rig group (position comes free from their state
   * stream). When they dismount, return it to the pool.
   */
  syncRemotes(entries: Array<{ anim: string; rig: { group: THREE.Group } | null }>) {
    let poolIdx = 0
    for (const r of entries) {
      const wants = r.anim === 'ride' && r.rig
      if (wants && r.rig) {
        const g = this.riderPool[poolIdx++]
        if (!g) continue // more simultaneous riders than the pool — rare, skip
        if (g.parent !== r.rig.group) {
          r.rig.group.add(g)
          g.position.set(0, 0, 0)
          g.rotation.set(0, 0, 0)
          g.visible = true
        }
      }
    }
    for (; poolIdx < this.riderPool.length; poolIdx++) {
      const g = this.riderPool[poolIdx]
      if (g.visible) { g.visible = false; g.parent?.remove(g) }
    }
  }

  dispose() {
    this.group.removeFromParent()
  }

  /** Match teardown — force-dismount and return every scooter to its bay. */
  resetAll() {
    this.mounted = null
    for (const sc of this.scooters) sc.resetToOrigin()
    for (const g of this.riderPool) { g.visible = false; g.parent?.remove(g) }
  }
}
