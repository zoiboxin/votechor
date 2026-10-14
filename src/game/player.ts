// VoteChor player controller — acceleration, sprint stamina, jump, slide, damage, states.
import * as THREE from 'three'
import { CharacterRig } from './character'
import { MOVE, DAMAGE, archetypeById } from './shared/constants'
import type { AnimName } from './shared/types'
import type { PhysicsWorld } from './physics'

export type PlayerState = 'normal' | 'sliding' | 'dazed' | 'detained' | 'frozen'

export class PlayerController {
  rig: CharacterRig
  pos = new THREE.Vector3()
  vel = new THREE.Vector3()
  ry = 0 // facing
  state: PlayerState = 'normal'
  grounded = true
  stamina = MOVE.staminaMax
  maxStamina = MOVE.staminaMax
  health = 100
  maxHealth = 100
  speedBoostUntil = 0
  slideTimer = 0
  dazedTimer = 0
  animOverride: AnimName | null = null
  animOverrideTimer = 0
  distance = 0
  // ---- double jump / coyote / jump buffer (Phase 2) ----
  jumpsUsed = 0 // jumps consumed in the current airborne sequence
  coyoteTimer = 0 // grace window after leaving a ledge
  jumpBufTimer = 0 // early-press buffering window
  private wasGrounded = true
  private footPhase = 0
  onFootstep: ((running: boolean) => void) | null = null
  onLand: ((hard: boolean) => void) | null = null
  onJump: (() => void) | null = null
  onDoubleJump: (() => void) | null = null
  onVault: (() => void) | null = null
  onSlide: (() => void) | null = null
  onDazed: (() => void) | null = null

  // stamina costs (floor at 0 — never blocks walking; sprint/jump gating unchanged)
  private static JUMP_COST = 3
  private static DOUBLE_JUMP_COST = 6

  constructor(
    archetype: string,
    name: string,
    spawn: { x: number; z: number },
    private physics: PhysicsWorld,
    opts?: {
      hat?: string; glasses?: boolean; signText?: string
      face?: string; outfit?: string; footwear?: string; gear?: string; held?: string
      cosmetics?: { skinTone?: string }
    },
  ) {
    const arch = archetypeById(archetype)
    this.maxHealth = 100 + arch.stats.healthBonus
    this.health = this.maxHealth
    this.maxStamina = MOVE.staminaMax * arch.stats.staminaMul
    this.stamina = this.maxStamina
    const colors = { ...arch.colors }
    if (opts?.cosmetics?.skinTone) colors.skin = opts.cosmetics.skinTone
    this.rig = new CharacterRig({
      archetype, name, colors,
      hat: opts?.hat, glasses: opts?.glasses, signText: opts?.signText,
      face: opts?.face, outfit: opts?.outfit, footwear: opts?.footwear, gear: opts?.gear, held: opts?.held,
    })
    this.pos.set(spawn.x, 0, spawn.z)
    this.rig.group.position.copy(this.pos)
  }

  get isDetained() { return this.state === 'detained' }
  get isDazed() { return this.state === 'dazed' }
  get archetypeSpeedMul() { return 1 }

  inputScale(archetype: string): number { return archetypeById(archetype).stats.speedMul }

  applyInput(
    dt: number,
    input: { forward: number; strafe: number; jump: boolean; sprint: boolean },
    camYaw: number,
    archetype: string,
    oneShot: 'jump' | 'slide' | null,
    speedBoostActive: boolean,
  ) {
    const arch = archetypeById(archetype)
    if (this.state === 'detained' || this.state === 'frozen') {
      this.vel.x = 0; this.vel.z = 0
      return
    }
    if (this.state === 'dazed') {
      this.dazedTimer -= dt
      this.vel.x *= Math.max(0, 1 - 6 * dt)
      this.vel.z *= Math.max(0, 1 - 6 * dt)
      if (this.dazedTimer <= 0) {
        this.state = 'normal'
        this.health = DAMAGE.dazedRecoverHealth
      }
    }

    const slideNow = this.state === 'sliding'
    if (slideNow) {
      this.slideTimer -= dt
      const decel = Math.exp(-MOVE.slideFriction * dt)
      this.vel.x *= decel; this.vel.z *= decel
      if (this.slideTimer <= 0) this.state = 'normal'
    } else if (this.state === 'normal') {
      // camera-relative wish direction
      const sin = Math.sin(camYaw), cos = Math.cos(camYaw)
      const wishX = input.strafe * cos - input.forward * sin
      const wishZ = -input.strafe * sin - input.forward * cos
      const wishLen = Math.hypot(wishX, wishZ)
      const canSprint = input.sprint && this.stamina > 2 && wishLen > 0.1
      let speed = (canSprint ? MOVE.sprintSpeed : MOVE.walkSpeed) * arch.stats.speedMul
      if (speedBoostActive) speed *= 1.45
      if (wishLen > 0.01) {
        const tx = (wishX / wishLen) * speed
        const tz = (wishZ / wishLen) * speed
        this.vel.x += (tx - this.vel.x) * Math.min(1, MOVE.accel * dt / speed)
        this.vel.z += (tz - this.vel.z) * Math.min(1, MOVE.accel * dt / speed)
        // face movement direction
        const targetRy = Math.atan2(this.vel.x, this.vel.z)
        let d = targetRy - this.ry
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        this.ry += d * Math.min(1, dt * 12)
      } else {
        const fric = Math.exp(-MOVE.friction * dt)
        this.vel.x *= fric; this.vel.z *= fric
      }
      // stamina
      if (canSprint) this.stamina = Math.max(0, this.stamina - MOVE.staminaDrain * dt / Math.max(0.5, arch.stats.staminaMul))
      else this.stamina = Math.min(this.maxStamina, this.stamina + MOVE.staminaRegen * dt)

      // ---- jump (double jump + coyote time + 0.12s jump buffer) ----
      // `oneShot === 'jump'` is a fresh keydown edge (input manager swallows auto-repeat
      // and fires only on the down transition), so holding Space never double-fires.
      if (oneShot === 'jump') this.jumpBufTimer = MOVE.jumpBuffer
      if (this.jumpBufTimer > 0) {
        if (this.grounded || this.coyoteTimer > 0) {
          // grounded jump (or coyote-window jump just after stepping off a ledge)
          this.jumpBufTimer = 0
          this.coyoteTimer = 0
          this.stamina = Math.max(0, this.stamina - PlayerController.JUMP_COST)
          this.vel.y = MOVE.jumpVel
          this.grounded = false
          this.jumpsUsed = 1
          this.onJump?.()
        } else if (this.jumpsUsed <= MOVE.maxAirJumps) {
          // mid-air second jump (double jump)
          this.jumpBufTimer = 0
          this.stamina = Math.max(0, this.stamina - PlayerController.DOUBLE_JUMP_COST)
          this.vel.y = MOVE.doubleJumpVel
          this.jumpsUsed++
          this.onDoubleJump?.()
        }
        // else: airborne with both jumps spent — buffer stays armed and
        // auto-jumps on the next landing (or coyote window).
      }
      // slide
      if (oneShot === 'slide' && this.grounded && this.stamina >= MOVE.slideCost) {
        this.stamina -= MOVE.slideCost
        this.state = 'sliding'
        this.slideTimer = MOVE.slideDuration
        const sp = Math.hypot(this.vel.x, this.vel.z)
        const minSp = MOVE.slideBoost * arch.stats.speedMul
        if (sp < minSp) {
          const fx = sp > 0.1 ? this.vel.x / sp : Math.sin(this.ry)
          const fz = sp > 0.1 ? this.vel.z / sp : Math.cos(this.ry)
          this.vel.x = fx * minSp; this.vel.z = fz * minSp
        }
        this.onSlide?.()
      }
    }

    // gravity
    this.vel.y -= MOVE.gravity * dt

    const before = { x: this.pos.x, z: this.pos.z }
    const res = this.physics.moveActor(this.pos, this.vel, dt, MOVE.playerRadius, MOVE.playerHeight)
    this.grounded = res.grounded
    this.distance += Math.hypot(this.pos.x - before.x, this.pos.z - before.z)

    // vault/mantle landed on top of a low obstacle — treat as a fresh grounded contact
    if (res.vaulted) {
      this.jumpsUsed = 0
      this.coyoteTimer = MOVE.coyoteTime
      this.playAnim('jump', 0.25)
      this.onVault?.()
    }

    // coyote-time bookkeeping: refill while grounded, decay while airborne
    if (this.grounded) {
      this.jumpsUsed = 0
      this.coyoteTimer = MOVE.coyoteTime
    } else if (this.coyoteTimer > 0) {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt)
    }

    // hard landing damage
    if (res.landed && this.wasGrounded === false) {
      const fall = Math.abs(this.vel.y)
      this.onLand?.(res.landed)
      if (fall > 14 && this.state === 'normal') {
        this.damage(DAMAGE.fallDamageMin + (fall - 14) * 1.2, 'fall')
      }
    }
    this.wasGrounded = this.grounded

    // footsteps
    const hSpeed = Math.hypot(this.vel.x, this.vel.z)
    if (this.grounded && hSpeed > 1) {
      this.footPhase += dt * (hSpeed * 1.35)
      if (this.footPhase >= Math.PI) {
        this.footPhase -= Math.PI
        this.onFootstep?.(hSpeed > 6.5)
      }
    }
  }

  knockback(fromX: number, fromZ: number, power = 8) {
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ
    const d = Math.max(0.5, Math.hypot(dx, dz))
    this.vel.x += (dx / d) * power
    this.vel.z += (dz / d) * power
    this.vel.y = Math.max(this.vel.y, 3.4)
    this.grounded = false
  }

  damage(amount: number, _kind: string): boolean {
    if (this.state === 'dazed' || this.state === 'detained') return false
    this.health -= amount
    if (this.health <= 0) {
      this.health = 0
      this.state = 'dazed'
      this.dazedTimer = DAMAGE.dazedDuration
      this.onDazed?.()
      return true // became dazed
    }
    return false
  }

  heal(amount: number) { this.health = Math.min(this.maxHealth, this.health + amount) }

  detain() {
    this.state = 'detained'
    this.vel.set(0, 0, 0)
  }

  release(x: number, z: number) {
    this.state = 'normal'
    this.health = Math.max(this.health, DAMAGE.dazedRecoverHealth)
    this.pos.set(x, this.physics.groundHeight(x, z, 2), z)
    this.vel.set(0, 0, 0)
  }

  teleport(x: number, z: number) {
    this.pos.set(x, this.physics.groundHeight(x, z, 2), z)
    this.vel.set(0, 0, 0)
  }

  render(dt: number) {
    let anim: AnimName = 'idle'
    const hSpeed = Math.hypot(this.vel.x, this.vel.z)
    if (this.animOverride && this.animOverrideTimer > 0) {
      anim = this.animOverride
      this.animOverrideTimer -= dt
    } else if (this.state === 'dazed') anim = 'dazed'
    else if (this.state === 'detained') anim = 'detained'
    else if (this.state === 'sliding') anim = 'slide'
    else if (!this.grounded) anim = 'jump'
    else if (hSpeed > 6.4) anim = 'run'
    else if (hSpeed > 0.6) anim = 'walk'
    this.rig.update(dt, anim, hSpeed)
    this.rig.group.position.copy(this.pos)
    this.rig.group.rotation.y = this.ry
  }

  playAnim(name: AnimName, duration = 0.4) {
    this.animOverride = name
    this.animOverrideTimer = duration
  }
}
