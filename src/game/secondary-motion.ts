// VoteChor secondary-motion physics — the "cartoon but real" layer (task 97).
//
// Runs AFTER the AnimationMixer writes each frame's keyframed pose and adds
// damped-spring overlays on top, the way modern game characters get their
// life-like feel:
//   • speed lean   — torso pitches into velocity (walk slight, run strong)
//   • turn bank    — the body rolls INTO turns (angular-velocity driven)
//   • accel lurch  — pitch kick on sudden speed-ups / brakes
//   • squash&stretch — volume-preserving root scale spring fired on take-off
//                      and landing (classic cartoon physics)
//   • gaze inertia — the head counter-rotates against torso lean and LAGS
//                    behind facing changes, keeping the eyes level
//   • cap jiggle   — kid only: the Cap node lags the head with its own spring
//   • ponytail     — human female: the Ponytail node swings with accel + turns
//
// The overlay is IDEMPOTENT: every node's last-applied offset quaternion is
// undone before the new one is applied, so offsets never accumulate even when
// the anim-LOD throttle skips mixer updates between frames. dispose() unwinds
// everything so a body swap leaves a clean pose.
import * as THREE from 'three'

export interface SecondaryMotionState {
  hSpeed: number   // horizontal speed (m/s)
  vy: number       // vertical velocity (m/s)
  grounded: boolean
}

/** Critically-damped-ish spring step (semi-implicit Euler, clamped dt). */
function spring(cur: number, vel: number, target: number, k: number, c: number, dt: number): [number, number] {
  vel += (-k * (cur - target) - c * vel) * dt
  cur += vel * dt
  return [cur, vel]
}

const RUN_REF_SPEED = 7.6
const _e = new THREE.Euler()
const _q = new THREE.Quaternion()

export class SecondaryMotion {
  private root: THREE.Group
  private baseScale: THREE.Vector3
  private torso: THREE.Object3D | null
  private head: THREE.Object3D | null
  private cap: THREE.Object3D | null
  private capBase = { x: 0, z: 0 }
  private hasCap = false
  private pony: THREE.Object3D | null
  private ponyBase = { x: 0, z: 0 }
  private hasPony = false
  // last applied overlays (undone before each new apply → idempotent)
  private torsoQ = new THREE.Quaternion()
  private headQ = new THREE.Quaternion()
  // spring states
  private lean = 0; private leanV = 0
  private bank = 0; private bankV = 0
  private lurch = 0; private lurchV = 0
  private squash = 1; private squashV = 0
  private capX = 0; private capXV = 0
  private capZ = 0; private capZV = 0
  private ponyX = 0; private ponyXV = 0
  private ponyZ = 0; private ponyZV = 0
  private headYaw = 0; private headYawV = 0
  // previous-frame inputs
  private prevRy: number | null = null
  private prevSpeed = 0
  private wasGrounded = true

  constructor(root: THREE.Group) {
    this.root = root
    this.baseScale = root.scale.clone()
    this.torso = root.getObjectByName('Torso') ?? null
    this.head = root.getObjectByName('Head') ?? null
    this.cap = root.getObjectByName('Cap') ?? null
    if (this.cap) {
      this.capBase = { x: this.cap.rotation.x, z: this.cap.rotation.z }
      this.hasCap = true
    }
    this.pony = root.getObjectByName('Ponytail') ?? null
    if (this.pony) {
      this.ponyBase = { x: this.pony.rotation.x, z: this.pony.rotation.z }
      this.hasPony = true
    }
  }

  update(dt: number, s: SecondaryMotionState) {
    dt = Math.min(Math.max(dt, 1e-4), 0.05)
    // ---- facing turn rate (rad/s, shortest-arc) ----
    let turnRate = 0
    const ry = this.root.rotation.y
    if (this.prevRy !== null) {
      let d = ry - this.prevRy
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      turnRate = d / dt
    }
    this.prevRy = ry

    // ---- take-off / landing impulses from grounded+vy edges ----
    if (!this.wasGrounded && s.grounded) {
      this.squashV -= Math.min(6.5, Math.abs(s.vy) * 0.55 + 1.8)
    } else if (this.wasGrounded && !s.grounded && s.vy > 2.5) {
      this.squashV += 2.4
    }
    this.wasGrounded = s.grounded

    // ---- acceleration estimate (m/s²) ----
    const accel = (s.hSpeed - this.prevSpeed) / dt
    this.prevSpeed = s.hSpeed

    // ---- spring targets ----
    const speedK = Math.min(1, s.hSpeed / RUN_REF_SPEED)
    const leanT = speedK * 0.16 + (s.grounded ? 0 : -0.05)
    const bankT = THREE.MathUtils.clamp(-turnRate * 0.045, -0.22, 0.22) * Math.min(1, s.hSpeed / 3)
    const lurchT = THREE.MathUtils.clamp(accel * 0.012, -0.12, 0.12)

    // ---- integrate springs ----
    ;[this.lean, this.leanV] = spring(this.lean, this.leanV, leanT, 60, 10, dt)
    ;[this.bank, this.bankV] = spring(this.bank, this.bankV, bankT, 50, 8, dt)
    ;[this.lurch, this.lurchV] = spring(this.lurch, this.lurchV, lurchT, 70, 11, dt)
    ;[this.squash, this.squashV] = spring(this.squash, this.squashV, 1, 170, 13, dt)
    this.squash = THREE.MathUtils.clamp(this.squash, 0.7, 1.32)
    ;[this.capX, this.capXV] = spring(this.capX, this.capXV, THREE.MathUtils.clamp(accel * 0.02, -0.18, 0.18), 90, 7, dt)
    ;[this.capZ, this.capZV] = spring(this.capZ, this.capZV, THREE.MathUtils.clamp(-turnRate * 0.05, -0.25, 0.25), 90, 7, dt)
    ;[this.headYaw, this.headYawV] = spring(this.headYaw, this.headYawV, THREE.MathUtils.clamp(-turnRate * 0.06, -0.3, 0.3), 40, 7, dt)
    // ponytail: swings UP-BACK with speed (x negative lifts the tail), lags turns (z)
    ;[this.ponyX, this.ponyXV] = spring(this.ponyX, this.ponyXV, THREE.MathUtils.clamp(speedK * 0.22 + accel * 0.01, -0.1, 0.4), 55, 6, dt)
    ;[this.ponyZ, this.ponyZV] = spring(this.ponyZ, this.ponyZV, THREE.MathUtils.clamp(turnRate * 0.05, -0.3, 0.3), 50, 5.5, dt)

    // ---- apply overlays (undo previous → apply new) ----
    const pitch = this.lean + this.lurch
    if (this.torso) {
      this.torso.quaternion.multiply(_q.copy(this.torsoQ).invert())
      _e.set(pitch, 0, this.bank)
      this.torsoQ.setFromEuler(_e)
      this.torso.quaternion.multiply(this.torsoQ)
    }
    if (this.head) {
      this.head.quaternion.multiply(_q.copy(this.headQ).invert())
      // gaze stabilization: counter ~45% of the lean + the yaw lag
      _e.set(-pitch * 0.45, this.headYaw, -this.bank * 0.35)
      this.headQ.setFromEuler(_e)
      this.head.quaternion.multiply(this.headQ)
    }
    if (this.hasCap && this.cap) {
      // cap has NO mixer channels — direct rotation on top of its base pose
      this.cap.rotation.x = this.capBase.x + this.capX
      this.cap.rotation.z = this.capBase.z + this.capZ
    }
    if (this.hasPony && this.pony) {
      this.pony.rotation.x = this.ponyBase.x + this.ponyX
      this.pony.rotation.z = this.ponyBase.z + this.ponyZ
    }
    // volume-preserving squash & stretch on the root scale
    const st = this.squash
    this.root.scale.set(
      this.baseScale.x * (1 + (1 - st) * 0.55),
      this.baseScale.y * st,
      this.baseScale.z * (1 + (1 - st) * 0.55),
    )
  }

  /** Unwind every overlay and restore the exact attach-time transform. */
  dispose() {
    if (this.torso) this.torso.quaternion.multiply(_q.copy(this.torsoQ).invert())
    if (this.head) this.head.quaternion.multiply(_q.copy(this.headQ).invert())
    if (this.hasCap && this.cap) {
      this.cap.rotation.x = this.capBase.x
      this.cap.rotation.z = this.capBase.z
    }
    if (this.hasPony && this.pony) {
      this.pony.rotation.x = this.ponyBase.x
      this.pony.rotation.z = this.ponyBase.z
    }
    this.root.scale.copy(this.baseScale)
    this.torsoQ.identity()
    this.headQ.identity()
    this.lean = this.leanV = this.bank = this.bankV = this.lurch = this.lurchV = 0
    this.squash = this.squashV = 0
    this.capX = this.capXV = this.capZ = this.capZV = 0
    this.ponyX = this.ponyXV = this.ponyZ = this.ponyZV = 0
    this.headYaw = this.headYawV = 0
    this.prevRy = null
    this.prevSpeed = 0
  }
}
