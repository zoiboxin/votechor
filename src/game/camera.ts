// VoteChor third-person camera — orbit, wall clipping, shake, zoom.
import * as THREE from 'three'
import type { PhysicsWorld } from './physics'

export class ThirdPersonCamera {
  yaw = 0
  pitch = 0.32
  distance = 5.4
  targetDistance = 5.4
  offset = new THREE.Vector3(0, 1.55, 0)
  pos = new THREE.Vector3()
  lookAt = new THREE.Vector3()
  shake = 0
  private shakeOffset = new THREE.Vector3()
  /** Phase accumulator for the layered-sine shake (advances only while shaking). */
  private shakeT = 0
  /** 0..1 normalized focus speed (set by the render loop) — pulls the boom back slightly at sprint. */
  speedNorm = 0
  sensitivityMul = 1

  constructor(private camera: THREE.PerspectiveCamera, private physics: PhysicsWorld) {}

  update(dt: number, target: THREE.Vector3, lookDx: number, lookDy: number) {
    // NaN shield: a poisoned focus (positional glitch upstream) must never reach the
    // camera — a NaN camera matrix makes the renderer frustum-cull the entire scene
    // and the screen shows only the sky/floor color. Hold the last good view instead;
    // the player controller's own sentinel restores the position within one tick.
    if (!Number.isFinite(target.x + target.y + target.z)) return
    this.yaw -= lookDx
    this.pitch = Math.max(-0.55, Math.min(1.15, this.pitch + lookDy))
    // smooth distance — photo zoom (targetDistance, wheel-owned) + sprint dolly:
    // a ~0.5m pull-back at full sprint reads as speed without touching the FOV kick
    const wantDistance = this.targetDistance + this.speedNorm * 0.55
    this.distance += (wantDistance - this.distance) * Math.min(1, dt * 8)

    const focus = new THREE.Vector3(target.x, target.y + this.offset.y, target.z)

    // desired camera position (behind + above based on yaw/pitch)
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch)
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp)
    const desired = focus.clone().add(dir.clone().multiplyScalar(this.distance))

    // wall clip: shrink if ray to desired hits colliders
    const toCam = desired.clone().sub(focus)
    const len = toCam.length()
    toCam.normalize()
    let d = len
    const step = 0.35
    for (let t = step; t <= len; t += step) {
      const px = focus.x + toCam.x * t, py = focus.y + toCam.y * t, pz = focus.z + toCam.z * t
      if (this.physics.raycastBlocked(focus.x, focus.y, focus.z, px, py, pz) || py < 0.35) {
        d = Math.max(1.6, t - step)
        break
      }
    }
    desired.copy(focus).add(toCam.multiplyScalar(d))
    desired.y = Math.max(0.4, desired.y)

    // smooth follow
    const lag = 1 - Math.pow(0.0001, dt)
    this.pos.lerp(desired, lag)
    this.lookAt.lerp(focus, Math.min(1, dt * 14))

    // shake — layered incommensurate sines (pseudo-Perlin): raw per-frame random
    // reads as a glitch; slow layered wobble reads as a camera being buffeted
    // (UE camera-shake practice: noise pattern + blend envelope). The amplitude
    // envelope stays the existing linear decay; the noise layers ride on it.
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.4)
      this.shakeT += dt * 13
      const s = this.shake * 0.24
      this.shakeOffset.set(
        (Math.sin(this.shakeT) * 0.55 + Math.sin(this.shakeT * 2.7 + 1.3) * 0.45) * s,
        (Math.sin(this.shakeT * 1.7 + 0.6) * 0.6 + Math.sin(this.shakeT * 3.1 + 2.2) * 0.4) * s,
        (Math.sin(this.shakeT * 1.3 + 1.9) * 0.5 + Math.sin(this.shakeT * 2.3 + 0.4) * 0.5) * s,
      )
    } else this.shakeOffset.set(0, 0, 0)

    this.camera.position.copy(this.pos).add(this.shakeOffset)
    // belt-and-braces: never hand the renderer a non-finite camera matrix
    if (!Number.isFinite(this.camera.position.x + this.camera.position.y + this.camera.position.z)) {
      this.camera.position.set(focus.x + 4, focus.y + 2.5, focus.z + 5)
      this.pos.copy(this.camera.position)
    }
    this.camera.lookAt(this.lookAt)
  }

  addShake(v: number) { this.shake = Math.min(1.2, this.shake + v) }
}
