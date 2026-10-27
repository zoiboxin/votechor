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

/** Fallback chains — the driver plays the FIRST clip the model actually has.
 *  Clip names are LOWERCASE by convention: GLBAssetManager.instantiate() lowercases
 *  every loaded clip name, so imported packs (e.g. the Adventurer's 'Idle'/'Walk')
 *  resolve through the same chains as the in-house exports. Extra tails only ever
 *  fire on models that carry those clips — in-house assets resolve earlier entries. */
export const CLIP_FALLBACK: Record<LocoState, string[]> = {
  idle: ['idle'],
  walk: ['walk'],
  run: ['run'],
  jump: ['jump'],
  doubleJump: ['doublejump', 'jump', 'roll'],
  fall: ['fall', 'jump', 'idle'],
  land: ['land', 'recover', 'idle'],
  slide: ['slide'],
  hit: ['hit', 'dazed', 'hitrecieve', 'hitrecieve_2'],
  detained: ['detained', 'idle'],
  recover: ['recover', 'idle'],
  celebrate: ['celebrate', 'wave'],
  throw: ['throw'],
  heal: ['heal'],
}

/** Clip timeScale calibration: design speeds the exported clips were authored for. */
const WALK_DESIGN_SPEED = 4.4
const RUN_DESIGN_SPEED = 7.6

/**
 * Destination-driven crossfade table (UE animation-system practice): each entry
 * is the blend time used when FADING INTO that state. Locomotion blends are
 * longer & smooth; air/impact transitions are short so jumps, falls and hits
 * read instantly; capture/emote states ease gently. Seconds.
 */
const FADE_INTO: Record<LocoState, number> = {
  idle: 0.2,
  walk: 0.15,
  run: 0.15,
  jump: 0.1,
  doubleJump: 0.1,
  fall: 0.08,
  land: 0.05,
  slide: 0.1,
  hit: 0.08,
  detained: 0.25,
  recover: 0.2,
  celebrate: 0.25,
  throw: 0.12,
  heal: 0.25,
}

/** Cycling gait states whose stride phase should hand over seamlessly. */
const CYCLING: ReadonlySet<string> = new Set(['walk', 'run'])

export class GLBAnimDriver {
  private current: THREE.AnimationAction | null = null
  private currentState: LocoState | null = null
  private currentClipName: string | null = null
  private lodAccum = 0
  /** Smoothed stride rate actually applied to the active action. */
  private timeScale = 1
  /** Target stride rate from the latest play() — approached critically-damped. */
  private timeScaleTarget = 1
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
  play(state: LocoState, ctx: AnimContext, fade?: number) {
    const clipName = this.resolveClip(state) ?? this.resolveClip('idle')
    if (!clipName) return
    const next = this.mixer.clipAction(this.clips.get(clipName)!)
    if (!next) return

    // retime locomotion toward actual speed — stored as a TARGET and approached
    // smoothly in update() so speed changes (boost pickups, landings) never pop
    // the stride rate. The smoothed value is applied to the new action below.
    if (state === 'walk') this.timeScaleTarget = THREE.MathUtils.clamp(ctx.hSpeed / WALK_DESIGN_SPEED, 0.72, 1.6)
    else if (state === 'run') this.timeScaleTarget = THREE.MathUtils.clamp(ctx.hSpeed / RUN_DESIGN_SPEED, 0.8, 1.45)
    else this.timeScaleTarget = 1

    if (this.currentState === state && this.current === next) {
      // same state → keep whatever is playing (looping clips continue,
      // one-shots stay clamped at their end pose until the state changes)
      return
    }

    const dur = fade ?? FADE_INTO[state] ?? 0.16
    const once = ONE_SHOT.has(state)
    if (once) next.setLoop(THREE.LoopOnce, 1)
    next.clampWhenFinished = once
    next.reset()
    // stride-phase handover (UE blend-space practice): walk↔run are the same
    // gait at different cadences — starting the incoming clip at t=0 re-plants
    // the foot mid-swing (the classic clip-transition foot skip). Carry the
    // normalized cycle phase across instead.
    if (this.current && this.current !== next && CYCLING.has(state) && this.currentState && CYCLING.has(this.currentState)) {
      const from = this.current.getClip().duration
      const to = next.getClip().duration
      if (from > 0.001 && to > 0.001) next.time = ((this.current.time % from) / from) * to
    }
    next.setEffectiveTimeScale(this.timeScale)
    if (this.current && this.current !== next) {
      next.crossFadeFrom(this.current, dur, false)
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
    this.timeScale = 1
    this.timeScaleTarget = 1
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
    // critically-damped stride-rate approach (≈0.2s to settle, no overshoot):
    // speed ups/downs read as acceleration, not a step-rate glitch
    if (Math.abs(this.timeScale - this.timeScaleTarget) > 0.001) {
      this.timeScale += (this.timeScaleTarget - this.timeScale) * Math.min(1, dt * 9)
      this.current?.setEffectiveTimeScale(this.timeScale)
    }
    this.mixer.update(dt)
  }

  dispose() {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.mixer.getRoot() as THREE.Object3D)
  }
}
