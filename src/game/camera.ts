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
  sensitivityMul = 1

  constructor(private camera: THREE.PerspectiveCamera, private physics: PhysicsWorld) {}

  update(dt: number, target: THREE.Vector3, lookDx: number, lookDy: number) {
    this.yaw -= lookDx
    this.pitch = Math.max(-0.55, Math.min(1.15, this.pitch + lookDy))
    // smooth distance
    this.distance += (this.targetDistance - this.distance) * Math.min(1, dt * 8)

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

    // shake
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.4)
      const s = this.shake * 0.22
      this.shakeOffset.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s)
    } else this.shakeOffset.set(0, 0, 0)

    this.camera.position.copy(this.pos).add(this.shakeOffset)
    this.camera.lookAt(this.lookAt)
  }

  addShake(v: number) { this.shake = Math.min(1.2, this.shake + v) }
}
