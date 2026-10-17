// VoteChor animation state machine — one source of truth for character states.
//
// pickLoco(ctx)  — PURE state selection from gameplay context (unit-tested).
// GLBAnimDriver  — plays the loaded GLB's AnimationClips with crossfade blending,
//                  fallback chains for animation-free/partial models, one-shot
//                  states, speed scaling, and LOD-throttled updates.
// mapToAnimName  — LocoState → network AnimName (what remotes + procedural rigs use).
//
// States (the full spec list): idle, walk, run, sprint(=run), jump, doubleJump,
// fall, land, slide, hit, detained, recover — plus celebrate/throw/heal emotes.
import * as THREE from 'three'
import type { AnimName } from './shared/types'

export type LocoState =
  | 'idle' | 'walk' | 'run' | 'jump' | 'doubleJump' | 'fall' | 'land'
  | 'slide' | 'hit' | 'detained' | 'recover' | 'celebrate' | 'throw' | 'heal'

export interface AnimContext {
  grounded: boolean
  vy: number // vertical velocity (m/s)
  hSpeed: number // horizontal speed (m/s)
  sliding: boolean
  dazed: boolean
  detained: boolean
  landTimer: number // >0 → landing absorb window
  recoverTimer: number // >0 → getup window after dazed/detained release
  jumpsUsed: number // 0 grounded · 1 after first jump · 2 after double jump
}

/**
 * Pure gameplay→animation state resolution. Priority order matters:
 * capture states beat impact states beat locomotion.
 */
export function pickLoco(ctx: AnimContext): LocoState {
  if (ctx.detained) return 'detained'
  if (ctx.dazed) return 'hit'
  if (ctx.landTimer > 0) return 'land'
  if (ctx.recoverTimer > 0) return 'recover'
  if (ctx.sliding) return 'slide'
  if (!ctx.grounded) {
    if (ctx.jumpsUsed >= 2 && ctx.vy > -3) return 'doubleJump'
    if (ctx.vy < -2.5) return 'fall'
    return 'jump'
  }
  if (ctx.hSpeed > 6.4) return 'run'
  if (ctx.hSpeed > 0.6) return 'walk'
  return 'idle'
}

/** LocoState → procedural rig / network AnimName. */
export function mapToAnimName(s: LocoState): AnimName {
  switch (s) {
    case 'doubleJump': return 'jump'
    case 'fall': return 'fall'
    case 'land': return 'land'
    case 'recover': return 'recover'
    case 'hit': return 'dazed'
    default: return s
  }
}

/** States that play once and hold (driver returns to locomotion when ctx changes). */
const ONE_SHOT: ReadonlySet<string> = new Set(['land', 'hit', 'recover', 'throw', 'heal', 'jump', 'doubleJump'])

/** Fallback chains — the driver plays the FIRST clip the model actually has. */
export const CLIP_FALLBACK: Record<LocoState, string[]> = {
  idle: ['idle'],
  walk: ['walk'],
  run: ['run'],
  jump: ['jump'],
  doubleJump: ['doubleJump', 'jump'],
  fall: ['fall', 'jump', 'idle'],
  land: ['land', 'recover', 'idle'],
  slide: ['slide'],
  hit: ['hit', 'dazed', 'idle'],
  detained: ['detained', 'idle'],
  recover: ['recover', 'idle'],
  celebrate: ['celebrate'],
  throw: ['throw'],
  heal: ['heal'],
}

/**
 * Procedural locomotion fallback for CLIP-LESS GLB characters (e.g. the textured
 * promptplay avatar whose limbs are fused into one mesh — no skeleton, no clips).
 * GLBAnimDriver resolves no clips for such models, so without this the body would
 * glide frozen in its baked pose. Five cheap layers sell the motion (v52):
 *   1. ARM SWING — a vertex-shader sagittal rotation of the arm region
 *      (|x| > 0.21, safely above the shirt hem at 0.209) around the shoulder line
 *      (y = 1.547), driven by a phase/amp uniform pair. Patches AvatarBody +
 *      outfit_top so sleeves follow the skin arms; normals rotate too.
 *   2. LEG SWING — same technique on the leg region (y < hip line 0.95 weighted,
 *      |x| < 0.24..0.30 gate so the low-hanging A-pose hands never join in) around
 *      the hip line, in OPPOSITE phase to the same-side arm — a real contralateral
 *      gait. Patches AvatarBody + outfit_bottom + outfit_shoes (per-mesh role —
 *      the shoe/pant meshes must never receive the arm transform: their vertices
 *      sit ~1.4 m below the shoulder pivot and would fly across the room).
 *   3. AIR POSE — a smoothed uAir uniform tucks both legs back (heels up) and
 *      abducts the arms outward around Z, so jumps read as jumps, plus a vy-driven
 *      body pitch (lean back rising, lean forward falling) and a held front-flip
 *      for the double jump (triggerFlip, mirroring the procedural rig flourish).
 *   4. BOB + LEAN — vertical bounce at step frequency and forward pitch while
 *      moving (YXZ order keeps these local to the facing yaw set by the caller).
 *   5. FEEL — damped-spring landing dip on the airborne→grounded transition and a
 *      slow breathing sway/bob when idle so the character never statues.
 *
 * v53: apply() takes opts.baseY and writes position.y ABSOLUTELY (baseY + bob −
 * dip). The bob term is |sin| ≥ 0, so the old incremental += accumulated an
 * upward drift on any caller that does not re-copy position each frame — the
 * wardrobe preview visibly floated its character up off the pedestal and out
 * of frame (user-reported v52 bug).
 * The arm-region constants mirror scripts/fix-avatar-pose.ts, which baked the
 * T-pose into an A-pose (pivot ±0.215/1.547, hands at ±0.37); leg constants come
 * from scripts/measure-avatar.ts (pants |x| ≤ 0.20, waistband top 1.146, feet y 0).
 */
export class GlbLocoFallback {
  private static readonly ARM_X = 0.21
  private static readonly SHOULDER_Y = 1.547
  private static readonly HIP_Y = 0.95
  private phase = 0
  private amp = 0
  private air = 0 // smoothed 0..1 air-pose blend
  private dip = 0 // landing crouch offset (metres, ≥0)
  private dipV = 0 // dip spring velocity
  private prevGrounded = true
  private flipT = 0 // remaining seconds of the double-jump flip (0 = off)
  private uPhase = { value: 0 }
  private uSwing = { value: 0 }
  private uAir = { value: 0 }
  private patched = false

  /** Patch body/clothing materials with the arm+leg vertex transforms (idempotent). */
  patch(group: THREE.Object3D) {
    if (this.patched) return
    this.patched = true
    const armX = GlbLocoFallback.ARM_X.toFixed(3)
    const shoulderY = GlbLocoFallback.SHOULDER_Y.toFixed(3)
    const hipY = GlbLocoFallback.HIP_Y.toFixed(3)
    // per-mesh role: the fused body does arms AND legs; each clothing layer only
    // follows the region it actually covers (shoes/pants are far below the
    // shoulder pivot — an arm transform there would fling them across the map)
    const roleOf = (name: string): 'both' | 'arms' | 'legs' | null => {
      if (/^AvatarBody$/i.test(name)) return 'both'
      if (/^outfit_top$/i.test(name)) return 'arms'
      if (/^outfit_bottom$/i.test(name) || /^outfit_shoes$/i.test(name)) return 'legs'
      return null
    }
    group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || typeof mesh.name !== 'string') return
      const role = roleOf(mesh.name)
      if (!role) return
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined
      if (!mat || !(mat as THREE.Material).isMaterial) return
      const clone = mat.clone() // per-instance uniforms (the cached asset keeps its originals)
      // CRITICAL: three caches programs by (parameters + onBeforeCompile.toString()).
      // Every mesh's onBeforeCompile has IDENTICAL source (role is captured at runtime),
      // so without a per-role cache key ALL patched meshes share ONE program — e.g. the
      // shoes would run AvatarBody's compiled code and their outer toes (|x| up to 0.26
      // passes the arm gate) get flung sideways by the arm air-abduction at the shoulder
      // pivot (measured v52 QA bug: legs splaying into a wide V on every jump).
      clone.customProgramCacheKey = () => `vc-loco-${role}`
      clone.onBeforeCompile = (shader) => {
        shader.uniforms.uPhase = this.uPhase
        shader.uniforms.uSwing = this.uSwing
        shader.uniforms.uAir = this.uAir
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uPhase;\nuniform float uSwing;\nuniform float uAir;')
        if (role === 'both' || role === 'arms') {
          shader.vertexShader = shader.vertexShader
            .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{
  float awN = smoothstep(${armX}, ${(GlbLocoFallback.ARM_X + 0.05).toFixed(3)}, abs(position.x));
  if (awN > 0.001) {
    float sgnN = position.x >= 0.0 ? 1.0 : -1.0;
    float angN = sgnN * uSwing * sin(uPhase) * awN;
    float cN = cos(angN), sN = sin(angN);
    objectNormal = vec3(objectNormal.x, objectNormal.y * cN - objectNormal.z * sN, objectNormal.y * sN + objectNormal.z * cN);
    float angZN = sgnN * uAir * 0.55 * awN;
    float czN = cos(angZN), szN = sin(angZN);
    objectNormal = vec3(objectNormal.x * czN - objectNormal.y * szN, objectNormal.x * szN + objectNormal.y * czN, objectNormal.z);
  }
}`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float aw = smoothstep(${armX}, ${(GlbLocoFallback.ARM_X + 0.05).toFixed(3)}, abs(position.x));
  if (aw > 0.001) {
    float sgn = position.x >= 0.0 ? 1.0 : -1.0;
    float ang = sgn * uSwing * sin(uPhase) * aw;
    float c = cos(ang), s = sin(ang);
    float dy = position.y - ${shoulderY};
    transformed = vec3(position.x, ${shoulderY} + dy * c - position.z * s, dy * s + position.z * c);
    float angZ = sgn * uAir * 0.55 * aw;
    float cz = cos(angZ), sz = sin(angZ);
    float dx2 = transformed.x - sgn * ${armX};
    float dy2 = transformed.y - ${shoulderY};
    transformed.x = sgn * ${armX} + dx2 * cz - dy2 * sz;
    transformed.y = ${shoulderY} + dx2 * sz + dy2 * cz;
  }
}`)
        }
        if (role === 'both' || role === 'legs') {
          shader.vertexShader = shader.vertexShader
            .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{
  float lwN = (1.0 - smoothstep(0.92, 1.02, position.y)) * (1.0 - smoothstep(0.24, 0.30, abs(position.x)));
  if (lwN > 0.001) {
    float lsgnN = position.x >= 0.0 ? 1.0 : -1.0;
    float langN = -lsgnN * uSwing * sin(uPhase) * 0.55 * lwN - uAir * 0.65 * lwN;
    float lcN = cos(langN), lsN = sin(langN);
    objectNormal = vec3(objectNormal.x, objectNormal.y * lcN - objectNormal.z * lsN, objectNormal.y * lsN + objectNormal.z * lcN);
  }
}`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float lw = (1.0 - smoothstep(0.92, 1.02, position.y)) * (1.0 - smoothstep(0.24, 0.30, abs(position.x)));
  if (lw > 0.001) {
    float lsgn = position.x >= 0.0 ? 1.0 : -1.0;
    float lang = -lsgn * uSwing * sin(uPhase) * 0.55 * lw - uAir * 0.65 * lw;
    float lc = cos(lang), ls = sin(lang);
    float ldy = position.y - ${hipY};
    transformed = vec3(position.x, ${hipY} + ldy * lc - position.z * ls, ldy * ls + position.z * lc);
  }
}`)
        }
      }
      mesh.material = clone
    })
  }

  /** Double-jump flourish — a held front-flip of the whole model (0.5 s, eased). */
  triggerFlip() {
    this.flipT = 0.5
  }

  /**
   * Flip-only layer for RIGGED (clipped) models: apply()/its bob+lean layers are
   * skipped there (the mixer owns the pose), but the double-jump 360° flip must
   * still ride on top of the clip animation. No-op unless a flip is active.
   */
  applyFlipOnly(group: THREE.Group, dt: number) {
    if (this.flipT <= 0) return
    this.flipT = Math.max(0, this.flipT - dt)
    const t = 1 - this.flipT / 0.5
    const flip = t < 0.7 ? (t / 0.7) * Math.PI * 2 : Math.PI * 2
    group.rotation.order = 'YXZ'
    group.rotation.x = flip
  }

  /**
   * Advance the fallback and apply bob/lean/dip/flip to the instance group. Call
   * AFTER the per-frame rotation copy.
   *
   * POSITION CONTRACT (v53 bug fix): `opts.baseY` is the caller's base/ground Y.
   * When given, the vertical offset is applied ABSOLUTELY — position.y = baseY +
   * bob − dip — so repeated calls are IDEMPOTENT even for callers that never
   * re-copy position (the wardrobe preview). The bob term is |sin| ≥ 0 every
   * frame, so the legacy incremental `group.position.y +=` path silently
   * ACCUMULATES an upward drift on such callers (v52 bug: the wardrobe preview
   * character slowly slid up off the pedestal and vanished — measured +0.006 m
   * worst-case per frame at 60 Hz ≈ +0.2 m/s). All call sites now pass baseY;
   * the += fallback remains only for hypothetical callers that re-copy
   * position.y each frame.
   *
   * `opts.vy` (m/s) shapes the airborne pitch; omit for distant remotes.
   */
  apply(group: THREE.Group, dt: number, hSpeed: number, grounded: boolean, opts?: { vy?: number; baseY?: number }) {
    const vy = opts?.vy ?? 0
    // locomotion amplitude: 0 idle → 1 at a run; a slight air carry keeps the
    // swing from dead-freezing the instant the feet leave the ground
    const target = grounded ? THREE.MathUtils.clamp((hSpeed - 0.3) / 5.5, 0, 1) : 0.2
    this.amp += (target - this.amp) * Math.min(1, dt * 6)
    this.phase += dt * (1.2 + hSpeed * 1.35)
    // air blend + uniforms (idle breathing keeps a whisper of sway so no statues)
    this.air += ((grounded ? 0 : 1) - this.air) * Math.min(1, dt * 7)
    this.uPhase.value = this.phase
    this.uSwing.value = 0.55 * this.amp + 0.032 * (1 - this.amp)
    this.uAir.value = this.air
    // landing dip: one-sided damped spring, kicked on the airborne→grounded edge
    if (grounded && !this.prevGrounded) this.dipV -= 0.55
    this.prevGrounded = grounded
    if (this.dip !== 0 || this.dipV !== 0) {
      this.dipV += (-this.dip * 90 - this.dipV * 9) * dt
      this.dip = Math.max(0, this.dip + this.dipV * dt)
      if (this.dip < 0.0005 && this.dipV <= 0) { this.dip = 0; this.dipV = 0 }
    }
    // bob: two footfalls per cycle; idle adds a slow breathing bob
    const bob = Math.abs(Math.sin(this.phase)) * 0.045 * this.amp +
      Math.abs(Math.sin(this.phase * 0.9)) * 0.006 * (1 - this.amp) * (grounded ? 1 : 0)
    const offY = bob - this.dip
    if (opts?.baseY !== undefined) group.position.y = opts.baseY + offY // absolute + idempotent
    else group.position.y += offY // legacy incremental path (caller must re-copy y each frame)
    // lean while moving + airborne pitch (lean back rising, forward falling)
    const pitch = 0.1 * this.amp + THREE.MathUtils.clamp(-vy * 0.012, -0.08, 0.1) * this.air
    // double-jump flip: 0→2π eased over the first 70%, then hold (mirrors rig.flip)
    let flip = 0
    if (this.flipT > 0) {
      this.flipT = Math.max(0, this.flipT - dt)
      const t = 1 - this.flipT / 0.5
      flip = t < 0.7 ? (t / 0.7) * Math.PI * 2 : Math.PI * 2
    }
    group.rotation.order = 'YXZ'
    group.rotation.x = pitch + flip
  }

  dispose() {
    // uniform objects die with the cloned materials — nothing to free here
  }
}

/** Clip timeScale calibration: design speeds the exported clips were authored for. */
const WALK_DESIGN_SPEED = 4.4
const RUN_DESIGN_SPEED = 7.6

export class GLBAnimDriver {
  private current: THREE.AnimationAction | null = null
  private currentState: LocoState | null = null
  private currentClipName: string | null = null
  private lodAccum = 0
  /** Distance-driven LOD: >0 throttles mixer updates to ~15Hz (distant characters). */
  lodInterval = 0

  constructor(private mixer: THREE.AnimationMixer, private clips: Map<string, THREE.AnimationClip>) {}

  /** First available clip name for a state (null if the model has none of them). */
  resolveClip(state: LocoState): string | null {
    for (const name of CLIP_FALLBACK[state]) if (this.clips.has(name)) return name
    return null
  }

  /** Total distinct clips this model can actually play (for QA/debug). */
  get playableClips(): number { return this.clips.size }

  /**
   * Transition to a state. Same looping clip → keep playing (only retimes);
   * anything else → crossfade over `fade` seconds. Missing clips walk the
   * fallback chain; a model with no clips at all simply never animates.
   */
  play(state: LocoState, ctx: AnimContext, fade = 0.16) {
    const clipName = this.resolveClip(state) ?? this.resolveClip('idle')
    if (!clipName) return
    const next = this.mixer.clipAction(this.clips.get(clipName)!)
    if (!next) return

    // retime locomotion to actual speed
    let timeScale = 1
    if (state === 'walk') timeScale = THREE.MathUtils.clamp(ctx.hSpeed / WALK_DESIGN_SPEED, 0.72, 1.6)
    else if (state === 'run') timeScale = THREE.MathUtils.clamp(ctx.hSpeed / RUN_DESIGN_SPEED, 0.8, 1.45)
    next.setEffectiveTimeScale(timeScale)

    if (this.currentState === state && this.current === next) {
      // same state → keep whatever is playing (looping clips continue,
      // one-shots stay clamped at their end pose until the state changes)
      return
    }

    const once = ONE_SHOT.has(state)
    if (once) next.setLoop(THREE.LoopOnce, 1)
    next.clampWhenFinished = once
    next.reset()
    if (this.current && this.current !== next) {
      next.crossFadeFrom(this.current, fade, false)
    }
    next.play()
    this.current = next
    this.currentState = state
    this.currentClipName = clipName
  }

  /** Which clip is actually playing right now (QA/debug + tests). */
  get activeClipName(): string | null { return this.currentClipName }

  /** Instantly switch with no blend (spawn/teleport/respawn). */
  snap(state: LocoState) {
    this.current?.stop()
    this.current = null
    this.currentState = null
    this.play(state, { grounded: true, vy: 0, hSpeed: 0, sliding: false, dazed: false, detained: false, landTimer: 0, recoverTimer: 0, jumpsUsed: 0 }, 0)
  }

  /** Delta-time update with optional LOD throttling (distant rigs update at ~15Hz). */
  update(dt: number) {
    if (this.lodInterval > 0) {
      this.lodAccum += dt
      if (this.lodAccum < this.lodInterval) return
      dt = this.lodAccum
      this.lodAccum = 0
    }
    this.mixer.update(dt)
  }

  dispose() {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.mixer.getRoot() as THREE.Object3D)
  }
}
