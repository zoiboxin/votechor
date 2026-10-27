// VoteChor player controller — acceleration, sprint stamina, jump, slide, damage, states.
import * as THREE from 'three'
import { CharacterRig } from './character'
import { MOVE, DAMAGE, archetypeById, WORLD_DISC } from './shared/constants'
import { policeUniformColors } from '../lib/cosmetics'
import { pickLoco, mapToAnimName, directionalRun } from './anim'
import type { GLBAnimDriver, LocoState } from './anim'
import type { GLBInstance } from './glb'
import { SecondaryMotion } from './secondary-motion'
import { FacialRig, type FacialState } from './facial-rig'
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
  sinceDamage = 999 // seconds since last hit (drives out-of-combat regen)
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
  // ---- animation state timers (drive land/recover states in the anim controller) ----
  landTimer = 0 // landing absorb window (longer after hard falls)
  recoverTimer = 0 // getup window after dazed/detained release
  // ---- fall-out-of-world recovery ----
  private lastSafe = { x: 0, z: 0 }
  private lastSafeAt = 0
  private wasGrounded = true
  private footPhase = 0
  onFootstep: ((running: boolean) => void) | null = null
  onLand: ((hard: boolean) => void) | null = null
  onJump: (() => void) | null = null
  onDoubleJump: (() => void) | null = null
  onVault: (() => void) | null = null
  onSlide: (() => void) | null = null
  onDazed: (() => void) | null = null
  onFallRecover: (() => void) | null = null
  /** Numeric-glitch sentinel fired when pos/vel stopped being finite (see applyInput). */
  onNanRecover: ((reason?: 'nan' | 'bounds') => void) | null = null
  // ---- High-Fi GLB rig (optional — procedural rig stays as the fallback) ----
  glb: { inst: GLBInstance; driver: GLBAnimDriver; sec: SecondaryMotion | null; facial: FacialRig | null } | null = null
  /** 0..1 exertion for the facial rig's breathing/blink (set by game.ts from stamina). */
  fatigue = 0
  /** Last resolved animation state, published to the network (works for BOTH backends). */
  netAnim: AnimName = 'idle'

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
      face?: string; build?: string; outfit?: string; footwear?: string; gear?: string; held?: string
      cosmetics?: { skinTone?: string }
      gender?: 'male' | 'female' // round 23: body silhouette + lips
      hair?: string              // round 23: hair style slot
      policeOutfit?: string      // round 23: POLICE_UNIFORMS key (police role only)
      policeHat?: string         // round 23: 'peak' | 'beret' | 'turban' | 'helmet' | 'none'
      npcType?: 'police' // police role: render the officer uniform + lathi instead of protest wear
    },
  ) {
    const arch = archetypeById(archetype)
    this.maxHealth = 100 + arch.stats.healthBonus
    this.health = this.maxHealth
    this.maxStamina = MOVE.staminaMax * arch.stats.staminaMul
    this.stamina = this.maxStamina
    const colors = { ...arch.colors }
    if (opts?.cosmetics?.skinTone) colors.skin = opts.cosmetics.skinTone
    // police role: officer uniform palette (round 23 — six dress styles) + lathi rig
    if (opts?.npcType === 'police') {
      const u = policeUniformColors(opts?.policeOutfit)
      colors.shirt = u.shirt
      colors.pants = u.pants
      colors.accent = u.accent
    }
    this.rig = new CharacterRig({
      archetype, name, colors,
      hat: opts?.hat, glasses: opts?.glasses, signText: opts?.signText,
      face: opts?.face, build: opts?.build, outfit: opts?.outfit, footwear: opts?.footwear, gear: opts?.gear, held: opts?.held,
      gender: opts?.gender, hair: opts?.hair,
      policeOutfit: opts?.policeOutfit, policeHat: opts?.policeHat,
      npcType: opts?.npcType,
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
    // ---- numeric-glitch sentinel (self-healing) ----
    // A single NaN in pos/vel permanently poisons the render: frustum culling with
    // a NaN camera/origin hides every world mesh (player reports "everything looks
    // blue" — only sky+fog remain), and it NEVER self-heals because every NaN
    // comparison is false (the pos.y < -6 fall recovery can not fire). Whatever
    // the upstream cause (a bad knockback, a rogue network value, a device glitch),
    // the poisoned state must not survive a physics tick.
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z + this.vel.x + this.vel.y + this.vel.z)) {
      const sx = Number.isFinite(this.lastSafe.x) ? this.lastSafe.x : 0
      const sz = Number.isFinite(this.lastSafe.z) ? this.lastSafe.z : -8
      this.pos.set(sx, this.physics.spawnHeight(sx, sz), sz)
      this.vel.set(0, 0, 0)
      this.jumpsUsed = 0
      this.coyoteTimer = 0
      this.jumpBufTimer = 0
      if (this.state === 'dazed') this.state = 'normal' // dazedTimer may be NaN too
      this.onNanRecover?.('nan')
    }

    // ---- world-bounds leash (self-healing) ----
    // A finite-but-absurd position (flung past the map edge by a physics edge
    // case) does NOT trip the NaN sentinel above, yet leaves every static mesh
    // beyond the 195 m cull radius — the same sky-only "blue world" report, but
    // permanent while the player stays out there.
    // v69 — ROUND world: anything outside the jungle disc (WORLD_DISC, + margin)
    // is pulled back to the last safe spot (disc-checked so a poisoned lastSafe
    // can't become the rescue point) with velocity zeroed.
    // v72 — the disc grew to r 650: leash = wall ring (r 658) + 6, safe = −2.
    const ldx = this.pos.x - WORLD_DISC.cx, ldz = this.pos.z - WORLD_DISC.cz
    if (ldx * ldx + ldz * ldz > 664 * 664) {
      const okSafe = Number.isFinite(this.lastSafe.x) && Number.isFinite(this.lastSafe.z) &&
        Math.hypot(this.lastSafe.x - WORLD_DISC.cx, this.lastSafe.z - WORLD_DISC.cz) < 656
      const sx = okSafe ? this.lastSafe.x : 0
      const sz = okSafe ? this.lastSafe.z : -8
      this.pos.set(sx, this.physics.spawnHeight(sx, sz), sz)
      this.vel.set(0, 0, 0)
      this.jumpsUsed = 0
      this.coyoteTimer = 0
      this.jumpBufTimer = 0
      this.onNanRecover?.('bounds')
    }

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

    // animation impact timers tick down regardless of state
    if (this.landTimer > 0) this.landTimer = Math.max(0, this.landTimer - dt)
    if (this.recoverTimer > 0) this.recoverTimer = Math.max(0, this.recoverTimer - dt)

    const slideNow = this.state === 'sliding'
    if (slideNow) {
      this.slideTimer -= dt
      const decel = Math.exp(-MOVE.slideFriction * dt)
      this.vel.x *= decel; this.vel.z *= decel
      if (this.slideTimer <= 0) {
        this.state = 'normal'
        // brief get-up window so the crouched slide pose rises smoothly instead
        // of snapping upright (pickLoco plays 'recover' — a short crouch-rise)
        this.recoverTimer = Math.max(this.recoverTimer, 0.14)
      }
    } else if (this.state === 'normal') {
      // camera-relative wish direction
      const sin = Math.sin(camYaw), cos = Math.cos(camYaw)
      const wishX = input.strafe * cos - input.forward * sin
      const wishZ = -input.strafe * sin - input.forward * cos
      const wishLen = Math.hypot(wishX, wishZ)
      const canSprint = input.sprint && this.stamina > 2 && wishLen > 0.1
      let speed = (canSprint ? MOVE.sprintSpeed : MOVE.walkSpeed) * arch.stats.speedMul
      if (speedBoostActive) speed *= 1.45
      // landing/getup recovery — brief slow-out so impacts read on the body
      if (this.landTimer > 0) speed *= 0.45
      else if (this.recoverTimer > 0) speed *= 0.6
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

    // landing: absorb anim window on every airborne→grounded transition (hard = longer)
    if (this.grounded && !this.wasGrounded) {
      const hard = res.landed
      this.landTimer = Math.max(this.landTimer, hard ? 0.5 : 0.2)
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

    // ---- fall-out-of-world recovery: never leave the player stuck under the map ----
    if (this.pos.y < -6) {
      this.teleport(this.lastSafe.x, this.lastSafe.z)
      this.landTimer = 0.4
      this.onFallRecover?.()
    } else if (this.grounded && this.state === 'normal') {
      // remember recent solid ground (0.4s cadence) as the fall-recovery point
      // (finite-guarded — a poisoned position must never become the rescue point)
      const now = performance.now()
      if (now - this.lastSafeAt > 400 && Number.isFinite(this.pos.x) && Number.isFinite(this.pos.z) &&
        Math.hypot(this.pos.x - WORLD_DISC.cx, this.pos.z - WORLD_DISC.cz) < WORLD_DISC.r) {
        this.lastSafeAt = now
        this.lastSafe.x = this.pos.x
        this.lastSafe.z = this.pos.z
      }
    }

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
    this.sinceDamage = 0
    if (this.health <= 0) {
      this.health = 0
      this.state = 'dazed'
      this.dazedTimer = DAMAGE.dazedDuration
      // task 105 — HP eaten to zero (zombie maul, police lathi, hard fall) plays
      // the model's Death clip (imported packs ship one) and holds the collapsed
      // pose through the whole KO window; models without a death clip fall back
      // to HitRecieve/dazed via CLIP_FALLBACK. The existing dazed → recover-at-50
      // loop is untouched — the character simply gets back up afterwards.
      this.animOverride = 'dead'
      this.animOverrideTimer = DAMAGE.dazedDuration + 0.5
      this.onDazed?.()
      return true // became dazed
    }
    return false
  }

  heal(amount: number) {
    if (amount > 0) this.health = Math.min(this.maxHealth, this.health + amount)
  }

  /** Slow out-of-combat regen — after DAMAGE.regenDelaySec without a hit, a gentle trickle.
   *  Food items are the real healing; this just stops early scrapes from lingering forever. */
  tickRegen(dt: number) {
    this.sinceDamage += dt
    if (this.state === 'normal' && this.health > 0 && this.health < this.maxHealth && this.sinceDamage >= DAMAGE.regenDelaySec) {
      this.health = Math.min(this.maxHealth, this.health + DAMAGE.regenPerSec * dt)
    }
  }

  detain() {
    this.state = 'detained'
    this.vel.set(0, 0, 0)
  }

  release(x: number, z: number) {
    this.state = 'normal'
    this.health = Math.max(this.health, DAMAGE.dazedRecoverHealth)
    this.pos.set(x, this.physics.spawnHeight(x, z), z)
    this.vel.set(0, 0, 0)
    this.recoverTimer = 0.8 // getup animation after being freed
    this.lastSafe.x = x; this.lastSafe.z = z
  }

  teleport(x: number, z: number) {
    this.pos.set(x, this.physics.spawnHeight(x, z), z)
    this.vel.set(0, 0, 0)
  }

  /** Attach the High-Fi GLB rig (hides the procedural body; both stay positioned). */
  attachGlb(inst: GLBInstance, driver: GLBAnimDriver, sec: SecondaryMotion | null = null, facial: FacialRig | null = null) {
    this.glb = { inst, driver, sec, facial }
    this.glb.driver.snap('idle')
    this.rig.group.visible = false
    inst.group.visible = true
  }

  /** Remove the GLB rig and fall back to the procedural body. */
  detachGlb() {
    if (!this.glb) return
    this.glb.sec?.dispose()
    this.glb.facial?.dispose()
    this.glb.driver.dispose()
    this.glb = null
    this.rig.group.visible = true
  }

  render(dt: number) {
    const hSpeed = Math.hypot(this.vel.x, this.vel.z)
    // ---- resolve the animation state via the shared state machine ----
    let loco = pickLoco({
      grounded: this.grounded,
      vy: this.vel.y,
      hSpeed,
      sliding: this.state === 'sliding',
      dazed: this.state === 'dazed',
      detained: this.state === 'detained',
      landTimer: this.landTimer,
      recoverTimer: this.recoverTimer,
      jumpsUsed: this.jumpsUsed,
    })
    // task 105 — directional run: while the smoothed heading catches up to a sharp
    // turn, the strafe/backward clips play the lean-in (UE blendspace feel); the
    // helper falls back to 'run' when the model has no directional clips.
    if (loco === 'run') loco = directionalRun(this.vel.x, this.vel.z, this.ry)
    // emote / forced one-shot override (celebrate, throw, heal, …)
    if (this.animOverride && this.animOverrideTimer > 0) {
      // legacy AnimName overrides map onto the closest LocoState so BOTH
      // backends stay safe ('dazed' → hit stagger, 'down' → detained hold)
      const o = this.animOverride
      loco = o === 'dazed' ? 'hit' : o === 'down' ? 'detained' : (o as LocoState)
      this.animOverrideTimer -= dt
    }
    this.netAnim = mapToAnimName(loco)

    if (this.glb) {
      // High-Fi backend: keyframed clips with crossfade blending
      this.glb.driver.play(loco, {
        grounded: this.grounded, vy: this.vel.y, hSpeed,
        sliding: this.state === 'sliding', dazed: this.state === 'dazed',
        detained: this.state === 'detained', landTimer: this.landTimer,
        recoverTimer: this.recoverTimer, jumpsUsed: this.jumpsUsed,
      })
      this.glb.driver.update(dt)
      this.glb.inst.group.position.copy(this.pos)
      this.glb.inst.group.rotation.y = this.ry
      // physics-flavored overlay (lean/bank/squash/gaze) on the keyed pose
      this.glb.sec?.update(dt, { hSpeed, vy: this.vel.y, grounded: this.grounded })
      // facial layer (blink/gaze/expressions/breath) — human GLBs only
      const facialState: FacialState = { loco, hSpeed, grounded: this.grounded, fatigue: this.fatigue }
      this.glb.facial?.update(dt, facialState)
    }
    // procedural backend always updates (it holds the name tag + is the fallback)
    this.rig.update(dt, this.netAnim, hSpeed)
    this.rig.group.position.copy(this.pos)
    this.rig.group.rotation.y = this.ry
  }

  playAnim(name: AnimName, duration = 0.4) {
    this.animOverride = name
    this.animOverrideTimer = duration
  }
}
