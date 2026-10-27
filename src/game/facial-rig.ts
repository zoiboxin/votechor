// VoteChor facial rig — runtime blink / gaze / expression / breathing layer
// for the professional skinned human GLBs (master prompt Phases 7–8).
//
// Drives the facial NODES baked into votechor-human-*.glb (LidTopL/R, BrowL/R,
// Jaw, PupilL/R, Chest). None of these have mixer channels, so this layer sets
// ABSOLUTE transforms every frame — no undo/redo needed, and it never fights
// the AnimationMixer (which owns Torso/limbs; Chest posture is exclusively ours).
//
// Behaviors:
//  • blink — randomized 2.2–5.5 s, ~12 % double-blinks, 80 ms close / 140 ms
//    open; squint (effort/land/slide) blends in additively; fatigue droops.
//  • gaze — small pupil saccades every 1.4–3.8 s, spring-eased; gaze returns
//    to center; no independent eye drift.
//  • expressions — LocoState → {browLift, browFurrow, jawOpen, squint} target,
//    spring-smoothed; subtle enough for gameplay (no cartoon exaggeration).
//  • breathing — Chest posture oscillation, rate rises with speed and fatigue
//    (wired to the LOCAL player's stamina; remotes derive from speed).
//
// Bodies without the facial nodes (classic rig, kid, protester) no-op safely.
import * as THREE from 'three'
import type { LocoState } from './anim'

export interface FacialState {
  loco: LocoState
  hSpeed: number
  grounded: boolean
  /** 0..1 — local player: 1 − stamina/max. Remotes: omitted (speed-derived). */
  fatigue?: number
}

interface ExprTarget { browLift: number; browFurrow: number; jawOpen: number; squint: number }

const EXPRESSIONS: Record<LocoState, ExprTarget> = {
  idle: { browLift: 0, browFurrow: 0, jawOpen: 0, squint: 0 },
  walk: { browLift: 0, browFurrow: 0.1, jawOpen: 0.06, squint: 0.05 },
  run: { browLift: 0, browFurrow: 0.3, jawOpen: 0.18, squint: 0.18 },
  jump: { browLift: 0.7, browFurrow: 0, jawOpen: 0.4, squint: 0 },
  doubleJump: { browLift: 0.8, browFurrow: 0, jawOpen: 0.5, squint: 0 },
  fall: { browLift: 0.55, browFurrow: 0.05, jawOpen: 0.25, squint: 0.1 },
  land: { browLift: 0.05, browFurrow: 0.35, jawOpen: 0.12, squint: 0.55 },
  slide: { browLift: 0, browFurrow: 0.4, jawOpen: 0.16, squint: 0.35 },
  hit: { browLift: 0.1, browFurrow: 0.65, jawOpen: 0.55, squint: 0.9 },
  detained: { browLift: 0.45, browFurrow: 0.15, jawOpen: 0.05, squint: 0.3 },
  recover: { browLift: 0.1, browFurrow: 0.5, jawOpen: 0.3, squint: 0.45 },
  celebrate: { browLift: 0.6, browFurrow: 0, jawOpen: 0.5, squint: 0 },
  throw: { browLift: 0, browFurrow: 0.45, jawOpen: 0.12, squint: 0.28 },
  heal: { browLift: 0.3, browFurrow: 0, jawOpen: 0.38, squint: 0.45 },
  // task 105 — directional gaits share the run's exertion; combat one-shots read
  // determined; the KO holds a slack, closed-eyed face
  runLeft: { browLift: 0, browFurrow: 0.3, jawOpen: 0.18, squint: 0.18 },
  runRight: { browLift: 0, browFurrow: 0.3, jawOpen: 0.18, squint: 0.18 },
  runBack: { browLift: 0.2, browFurrow: 0.25, jawOpen: 0.14, squint: 0.12 },
  kick: { browLift: 0, browFurrow: 0.55, jawOpen: 0.35, squint: 0.4 },
  punch: { browLift: 0, browFurrow: 0.55, jawOpen: 0.3, squint: 0.45 },
  dead: { browLift: 0, browFurrow: 0.1, jawOpen: 0.15, squint: 1 },
}

const LID_OPEN = -1.2
const LID_CLOSED = -0.1

function spring(cur: number, vel: number, target: number, k: number, c: number, dt: number): [number, number] {
  vel += (-k * (cur - target) - c * vel) * dt
  cur += vel * dt
  return [cur, vel]
}

export class FacialRig {
  private chest: THREE.Object3D | null = null
  private chestBaseX = 0
  private lids: THREE.Object3D[] = []
  private brows: THREE.Object3D[] = []
  private browBase: { y: number; z: number }[] = []
  private jaw: THREE.Object3D | null = null
  private pupils: THREE.Object3D[] = []
  private pupilBase: { x: number; y: number }[] = []
  private hasFace = false

  // blink state
  private blinkTimer = 2
  private blinkPhase = 0 // 0 open → 1 closed
  private blinkVel = 0
  private doublePending = false
  // expression springs
  private browLift = 0; private browLiftV = 0
  private browFurrow = 0; private browFurrowV = 0
  private jawOpen = 0; private jawOpenV = 0
  private squint = 0; private squintV = 0
  // gaze
  private sacX = 0; private sacXV = 0
  private sacY = 0; private sacYV = 0
  private sacTX = 0; private sacTY = 0
  private sacTimer = 1.5
  // breathing
  private breathPhase = Math.random() * Math.PI * 2

  constructor(root: THREE.Object3D) {
    this.chest = root.getObjectByName('Chest') ?? null
    if (this.chest) this.chestBaseX = this.chest.rotation.x
    this.lids = (['LidTopL', 'LidTopR'].map((n) => root.getObjectByName(n)).filter(Boolean) as THREE.Object3D[])
    this.brows = (['BrowL', 'BrowR'].map((n) => root.getObjectByName(n)).filter(Boolean) as THREE.Object3D[])
    this.browBase = this.brows.map((b) => ({ y: b.position.y, z: b.rotation.z }))
    this.jaw = root.getObjectByName('Jaw') ?? null
    this.pupils = (['PupilL', 'PupilR'].map((n) => root.getObjectByName(n)).filter(Boolean) as THREE.Object3D[])
    this.pupilBase = this.pupils.map((p) => ({ x: p.position.x, y: p.position.y }))
    this.hasFace = this.lids.length === 2 && this.brows.length === 2 && !!this.jaw
  }

  get available(): boolean { return this.hasFace }

  update(dt: number, s: FacialState) {
    if (!this.hasFace) return
    dt = Math.min(Math.max(dt, 1e-4), 0.05)

    // ---- expression target from state ----
    const e = EXPRESSIONS[s.loco] ?? EXPRESSIONS.idle
    const fatigue = THREE.MathUtils.clamp(s.fatigue ?? Math.min(1, s.hSpeed / 9) * 0.35, 0, 1)
    ;[this.browLift, this.browLiftV] = spring(this.browLift, this.browLiftV, e.browLift, 42, 9, dt)
    ;[this.browFurrow, this.browFurrowV] = spring(this.browFurrow, this.browFurrowV, e.browFurrow, 42, 9, dt)
    ;[this.jawOpen, this.jawOpenV] = spring(this.jawOpen, this.jawOpenV, e.jawOpen + fatigue * 0.1, 36, 9, dt)
    ;[this.squint, this.squintV] = spring(this.squint, this.squintV, e.squint + fatigue * 0.2, 40, 10, dt)

    // ---- blink scheduler ----
    this.blinkTimer -= dt
    if (this.blinkTimer <= 0 && this.blinkPhase === 0) {
      this.blinkVel = 14 // fire close
      this.blinkTimer = 2.2 + Math.random() * 3.3
      this.doublePending = Math.random() < 0.12
    }
    // blinkPhase dynamics: fires closed fast, relaxes open, rebounds for double
    if (this.blinkPhase > 0 || this.blinkVel > 0) {
      this.blinkVel += (-this.blinkPhase * 90 - this.blinkVel * 11) * dt + 14 * dt * (this.blinkVel > 0 ? 1 : 0)
      this.blinkPhase += this.blinkVel * dt
      if (this.blinkPhase >= 1) {
        this.blinkPhase = 1
        this.blinkVel = -6.5 // open again
        if (this.doublePending) { this.doublePending = false }
      }
      if (this.blinkPhase <= 0) {
        this.blinkPhase = 0
        this.blinkVel = 0
        if (this.doublePending) this.blinkTimer = 0.16 // rebound blink
      }
    }
    const blinkAmt = Math.max(this.blinkPhase, Math.min(1, this.squint))
    const lidRot = THREE.MathUtils.lerp(LID_OPEN, LID_CLOSED, Math.min(1, blinkAmt + fatigue * 0.18))
    for (const lid of this.lids) lid.rotation.x = lidRot

    // ---- brows ----
    for (let i = 0; i < this.brows.length; i++) {
      const b = this.brows[i]
      const base = this.browBase[i]
      const sgn = i === 0 ? 1 : -1 // BrowL tilts +, BrowR mirrors
      b.position.y = base.y + this.browLift * 0.014 - this.browFurrow * 0.003
      b.rotation.z = base.z - sgn * this.browFurrow * 0.22 + sgn * this.browLift * 0.06
    }

    // ---- jaw / mouth ----
    if (this.jaw) this.jaw.rotation.x = this.jawOpen * 0.5

    // ---- gaze saccades ----
    this.sacTimer -= dt
    if (this.sacTimer <= 0) {
      this.sacTimer = 1.4 + Math.random() * 2.4
      const big = Math.random() < 0.75
      this.sacTX = big ? (Math.random() - 0.5) * 0.011 : 0
      this.sacTY = big ? (Math.random() - 0.5) * 0.005 : 0
    }
    ;[this.sacX, this.sacXV] = spring(this.sacX, this.sacXV, this.sacTX, 60, 12, dt)
    ;[this.sacY, this.sacYV] = spring(this.sacY, this.sacYV, this.sacTY, 60, 12, dt)
    for (let i = 0; i < this.pupils.length; i++) {
      const p = this.pupils[i]
      const base = this.pupilBase[i]
      p.position.x = base.x + this.sacX
      p.position.y = base.y + this.sacY
    }

    // ---- breathing (Chest posture — exclusively owned by this rig) ----
    const exertion = Math.min(1, s.hSpeed / 8)
    const rate = 0.26 + exertion * 0.3 + fatigue * 0.25
    const amp = 0.016 + exertion * 0.014 + fatigue * 0.012
    this.breathPhase += dt * rate * Math.PI * 2
    if (this.chest) this.chest.rotation.x = this.chestBaseX + Math.sin(this.breathPhase) * amp
  }

  /** Restore every driven transform to its construction-time value. */
  dispose() {
    for (const lid of this.lids) lid.rotation.x = LID_OPEN
    for (let i = 0; i < this.brows.length; i++) {
      this.brows[i].position.y = this.browBase[i].y
      this.brows[i].rotation.z = this.browBase[i].z
    }
    if (this.jaw) this.jaw.rotation.x = 0
    for (let i = 0; i < this.pupils.length; i++) {
      this.pupils[i].position.x = this.pupilBase[i].x
      this.pupils[i].position.y = this.pupilBase[i].y
    }
    if (this.chest) this.chest.rotation.x = this.chestBaseX
  }
}
