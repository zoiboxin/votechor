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
 * glide frozen in its baked pose. Three cheap layers sell the motion:
 *   1. ARM SWING — a vertex-shader rotation of the arm region (|x| > 0.21, safely
 *      above the shirt hem at 0.209) around the shoulder line (y = 1.547), driven
 *      by a phase/amp uniform pair. Patches AvatarBody + outfit_top so sleeves
 *      follow the skin arms; normals are rotated too so lighting stays coherent.
 *   2. BOB — subtle vertical bounce of the whole group at step frequency.
 *   3. LEAN — slight forward pitch proportional to the swing (YXZ order keeps the
 *      lean local to the facing yaw that player.render / the remote loop set).
 * The arm-region constants mirror scripts/fix-avatar-pose.ts, which baked the
 * T-pose into an A-pose (pivot ±0.215/1.547, hands at ±0.37).
 */
export class GlbLocoFallback {
  private static readonly ARM_X = 0.21
  private static readonly SHOULDER_Y = 1.547
  private phase = 0
  private amp = 0
  private uPhase = { value: 0 }
  private uSwing = { value: 0 }
  private patched = false

  /** Patch the body/outfit materials with the arm-swing vertex transform (idempotent). */
  patch(group: THREE.Object3D) {
    if (this.patched) return
    this.patched = true
    const armX = GlbLocoFallback.ARM_X.toFixed(3)
    const shoulderY = GlbLocoFallback.SHOULDER_Y.toFixed(3)
    group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || typeof mesh.name !== 'string') return
      if (!/^(AvatarBody|outfit_top)$/i.test(mesh.name)) return
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined
      if (!mat || !(mat as THREE.Material).isMaterial) return
      const clone = mat.clone() // per-instance uniforms (the cached asset keeps its originals)
      clone.onBeforeCompile = (shader) => {
        shader.uniforms.uPhase = this.uPhase
        shader.uniforms.uSwing = this.uSwing
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uPhase;\nuniform float uSwing;')
          .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{
  float sgnN = position.x >= 0.0 ? 1.0 : -1.0;
  float angN = sgnN * uSwing * sin(uPhase);
  float cN = cos(angN), sN = sin(angN);
  objectNormal = vec3(objectNormal.x, objectNormal.y * cN - objectNormal.z * sN, objectNormal.y * sN + objectNormal.z * cN);
}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float aw = smoothstep(${armX}, ${(GlbLocoFallback.ARM_X + 0.05).toFixed(3)}, abs(position.x));
  if (aw > 0.001) {
    float sgn = position.x >= 0.0 ? 1.0 : -1.0;
    float ang = sgn * uSwing * sin(uPhase);
    float c = cos(ang), s = sin(ang);
    float dy = position.y - ${shoulderY};
    transformed = vec3(position.x, ${shoulderY} + dy * c - position.z * s, dy * s + position.z * c);
  }
}`)
      }
      mesh.material = clone
    })
  }

  /**
   * Advance the fallback and apply bob/lean to the instance group. Call AFTER the
   * per-frame position/rotation copy so the offsets ride on top (both call sites
   * re-copy position/rotation.y every frame, so nothing accumulates).
   */
  apply(group: THREE.Group, dt: number, hSpeed: number, grounded: boolean) {
    const target = grounded ? THREE.MathUtils.clamp((hSpeed - 0.3) / 5.5, 0, 1) : 0.2
    this.amp += (target - this.amp) * Math.min(1, dt * 6)
    this.phase += dt * (1.2 + hSpeed * 1.35)
    this.uPhase.value = this.phase
    this.uSwing.value = 0.55 * this.amp
    group.position.y += grounded ? Math.abs(Math.sin(this.phase)) * 0.045 * this.amp : 0
    group.rotation.order = 'YXZ'
    group.rotation.x = 0.1 * this.amp
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
