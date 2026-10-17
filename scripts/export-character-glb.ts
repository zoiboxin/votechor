/**
 * VoteChor — GLB character asset exporter (runs under bun, no DOM).
 *
 * Builds the "High-Fi" third-party character used by the in-game GLB asset
 * pipeline (src/game/glb.ts): a low-poly PBR humanoid whose proportions match
 * the classic procedural rigs, plus 13 node-TRS animation clips:
 *
 *   idle · walk · run · jump · fall · land · slide · hit · detained ·
 *   recover · celebrate · throw · heal
 *
 * Node hierarchy (pivot nodes named — animation tracks target these):
 *   VoteChorCharacter (root, origin at feet)
 *   └─ Hips
 *      ├─ Torso ── Head(+eyes) · ArmL · ArmR
 *      ├─ LegL
 *      └─ LegR
 *
 * Output: public/models/votechor-male.glb · votechor-female.glb
 */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { writeFileSync } from 'node:fs'

// bun has Blob but no FileReader — GLTFExporter needs readAsArrayBuffer + onloadend
class FileReaderShim {
  result: ArrayBuffer | null = null
  onload: ((ev?: unknown) => void) | null = null
  onloadend: ((ev?: unknown) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  readAsArrayBuffer(blob: Blob) {
    blob.arrayBuffer().then(
      (ab) => { this.result = ab; this.onload?.({ target: this }); this.onloadend?.({ target: this }) },
      (e) => { this.onerror?.(e); this.onloadend?.(e) },
    )
  }
}
;(globalThis as unknown as { FileReader: unknown }).FileReader = FileReaderShim

// ---------- palette (mirrors the procedural rig archetypes) ----------
interface Palette { shirt: number; pants: number; skin: number; accent: number; hair: number; shoe: number }
const MALE_PALETTE: Palette = { shirt: 0xc4593a, pants: 0x3d4f43, skin: 0xc98d5f, accent: 0xf2c14e, hair: 0x241d16, shoe: 0x4a3a2c }
const FEMALE_PALETTE: Palette = { shirt: 0xb34a78, pants: 0x4a3d55, skin: 0xd49a6c, accent: 0xf2c14e, hair: 0x1c1611, shoe: 0x503f31 }

interface Proportions {
  hipY: number; torsoW: number; torsoH: number; torsoD: number
  armLen: number; armW: number; legLen: number; legW: number
  headR: number
}
const MALE_PROP: Proportions = { hipY: 0.94, torsoW: 0.4, torsoH: 0.52, torsoD: 0.24, armLen: 0.62, armW: 0.09, legLen: 0.9, legW: 0.12, headR: 0.155 }
const FEMALE_PROP: Proportions = { hipY: 0.9, torsoW: 0.34, torsoH: 0.5, torsoD: 0.22, armLen: 0.58, armW: 0.08, legLen: 0.86, legW: 0.105, headR: 0.15 }

// ---------- keyframe helpers ----------
type Q = [number, number, number, number]
const quat = (x: number, y: number, z: number): Q => {
  const e = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z))
  return [e.x, e.y, e.z, e.w]
}
const qTrack = (node: string, times: number[], qs: Q[]) =>
  new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, qs.flat())
const pTrack = (node: string, times: number[], vs: [number, number, number][]) =>
  new THREE.VectorKeyframeTrack(`${node}.position`, times, vs.flat())

// sample an euler-pose timeline into a quaternion track
// poses: [t, x, y, z] (radians) — first pose is repeated at the end for loops
const qAnim = (node: string, poses: [number, number, number, number][], loop: boolean) => {
  const times = poses.map((p) => p[0])
  const qs = poses.map((p) => quat(p[1], p[2], p[3]))
  if (loop) { times.push(poses[0][0] + times[times.length - 1]); qs.push(qs[0]) }
  return qTrack(node, times, qs)
}
// hips y-bob timeline (positions relative to base hipY)
const bobAnim = (node: string, baseY: number, poses: [number, number][], loop: boolean) => {
  const times = poses.map((p) => p[0])
  const vs = poses.map((p) => [0, baseY + p[1], 0] as [number, number, number])
  if (loop) { times.push(poses[0][0] + times[times.length - 1]); vs.push(vs[0]) }
  return pTrack(node, times, vs)
}

// ---------- character builder ----------
function buildCharacter(pal: Palette, prop: Proportions) {
  const root = new THREE.Group()
  root.name = 'VoteChorCharacter'

  const skinMat = new THREE.MeshStandardMaterial({ color: pal.skin, roughness: 0.62, metalness: 0.02 })
  const shirtMat = new THREE.MeshStandardMaterial({ color: pal.shirt, roughness: 0.74, metalness: 0.0 })
  const pantsMat = new THREE.MeshStandardMaterial({ color: pal.pants, roughness: 0.8, metalness: 0.0 })
  const shoeMat = new THREE.MeshStandardMaterial({ color: pal.shoe, roughness: 0.85, metalness: 0.0 })
  const hairMat = new THREE.MeshStandardMaterial({ color: pal.hair, roughness: 0.55, metalness: 0.0 })
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1d1611, roughness: 0.3, metalness: 0.0 })
  const accentMat = new THREE.MeshStandardMaterial({ color: pal.accent, roughness: 0.6, metalness: 0.05 })

  // --- Hips (root motion node: y-bob lives here) ---
  const hips = new THREE.Group()
  hips.name = 'Hips'
  hips.position.y = prop.hipY
  root.add(hips)

  // --- Torso ---
  const torsoPivot = new THREE.Group()
  torsoPivot.name = 'Torso'
  hips.add(torsoPivot)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(prop.torsoW, prop.torsoH, prop.torsoD, 1, 1, 1), shirtMat)
  torso.position.y = prop.torsoH / 2
  torso.name = 'TorsoMesh'
  torsoPivot.add(torso)
  // accent sash — the protest identity stripe
  const sash = new THREE.Mesh(new THREE.BoxGeometry(prop.torsoW * 1.06, 0.075, prop.torsoD * 1.06), accentMat)
  sash.position.y = prop.torsoH * 0.62
  sash.rotation.z = 0.35
  sash.name = 'Sash'
  torsoPivot.add(sash)

  // --- Head (pivot at neck) ---
  const neckY = prop.torsoH
  const headPivot = new THREE.Group()
  headPivot.name = 'Head'
  headPivot.position.y = neckY
  torsoPivot.add(headPivot)
  const head = new THREE.Mesh(new THREE.SphereGeometry(prop.headR, 14, 10), skinMat)
  head.position.y = prop.headR * 0.92
  head.scale.set(0.92, 1.06, 0.98)
  head.name = 'HeadMesh'
  headPivot.add(head)
  // hair cap (hemisphere-ish scaled sphere) + tiny ponytail stub for the female look
  const hair = new THREE.Mesh(new THREE.SphereGeometry(prop.headR * 1.05, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat)
  hair.position.y = prop.headR * 0.95
  hair.name = 'Hair'
  headPivot.add(hair)
  if (pal === FEMALE_PALETTE) {
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(prop.headR * 0.22, prop.headR * 0.9, 3, 8), hairMat)
    tail.position.set(0, prop.headR * 0.55, -prop.headR * 1.15)
    tail.rotation.x = 0.5
    tail.name = 'Ponytail'
    headPivot.add(tail)
  }
  // eyes — small dark spheres, proud of the face
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(prop.headR * 0.11, 8, 6), eyeMat)
    eye.position.set(s * prop.headR * 0.36, prop.headR * 0.98, prop.headR * 0.78)
    eye.name = s < 0 ? 'EyeL' : 'EyeR'
    headPivot.add(eye)
  }

  // --- Arms (pivot at shoulder, hang down; rotation.x negative = raise forward) ---
  const shoulderY = prop.torsoH * 0.88
  const shoulderX = prop.torsoW / 2 + prop.armW * 0.75
  const buildArm = (side: -1 | 1, name: string) => {
    const pivot = new THREE.Group()
    pivot.name = name
    pivot.position.set(side * shoulderX, shoulderY, 0)
    torsoPivot.add(pivot)
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(prop.armW, prop.armLen - prop.armW * 2, 3, 8), shirtMat)
    upper.position.y = -prop.armLen / 2
    upper.name = name + 'Mesh'
    pivot.add(upper)
    const hand = new THREE.Mesh(new THREE.SphereGeometry(prop.armW * 1.25, 8, 6), skinMat)
    hand.position.y = -prop.armLen
    hand.name = name + 'Hand'
    pivot.add(hand)
    return pivot
  }
  buildArm(-1, 'ArmL')
  buildArm(1, 'ArmR')

  // --- Legs (pivot at hip joint; hang down) ---
  const hipX = prop.torsoW * 0.22
  const buildLeg = (side: -1 | 1, name: string) => {
    const pivot = new THREE.Group()
    pivot.name = name
    pivot.position.set(side * hipX, 0, 0)
    hips.add(pivot)
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(prop.legW, prop.legLen - prop.legW * 2, 3, 8), pantsMat)
    leg.position.y = -prop.legLen / 2
    leg.name = name + 'Mesh'
    pivot.add(leg)
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(prop.legW * 2.1, prop.legW * 0.95, prop.legW * 3.1), shoeMat)
    shoe.position.set(0, -prop.legLen, prop.legW * 0.7)
    shoe.name = name + 'Shoe'
    pivot.add(shoe)
    return pivot
  }
  buildLeg(-1, 'LegL')
  buildLeg(1, 'LegR')

  root.traverse((o) => { o.castShadow = false; o.receiveShadow = false })
  return { root, prop }
}

// ---------- animation clips ----------
// Convention mirrors the procedural rig poses in character.ts so the two
// backends read as the same character. All loop clips end where they start.
function buildClips(prop: Proportions): THREE.AnimationClip[] {
  const H = 'Hips', T = 'Torso', HD = 'Head', AL = 'ArmL', AR = 'ArmR', LL = 'LegL', LR = 'LegR'
  const clips: THREE.AnimationClip[] = []

  // idle — breathing, gentle arm sway (4s loop)
  clips.push(new THREE.AnimationClip('idle', 4, [
    qAnim(T, [[0, 0.02, 0, 0], [2, 0.045, 0, 0], [4, 0.02, 0, 0]], false),
    qAnim(HD, [[0, 0, 0, 0], [1.3, 0.03, 0.06, 0], [2.6, -0.02, -0.05, 0], [4, 0, 0, 0]], false),
    qAnim(AL, [[0, 0.05, 0, 0.03], [2, 0.1, 0, 0.06], [4, 0.05, 0, 0.03]], false),
    qAnim(AR, [[0, 0.05, 0, -0.03], [2, 0.1, 0, -0.06], [4, 0.05, 0, -0.03]], false),
    bobAnim(H, prop.hipY, [[0, 0], [2, 0.012], [4, 0]], false),
  ]))

  // walk — stride cycle (1.05s loop)
  clips.push(new THREE.AnimationClip('walk', 1.05, [
    qAnim(T, [[0, 0.08, 0, 0], [0.26, 0.1, 0, 0.05], [0.525, 0.08, 0, 0], [0.79, 0.1, 0, -0.05], [1.05, 0.08, 0, 0]], false),
    qAnim(LL, [[0, 0.55, 0, 0], [0.525, -0.55, 0, 0], [1.05, 0.55, 0, 0]], false),
    qAnim(LR, [[0, -0.55, 0, 0], [0.525, 0.55, 0, 0], [1.05, -0.55, 0, 0]], false),
    qAnim(AL, [[0, -0.5, 0, 0], [0.525, 0.5, 0, 0], [1.05, -0.5, 0, 0]], false),
    qAnim(AR, [[0, 0.5, 0, 0], [0.525, -0.5, 0, 0], [1.05, 0.5, 0, 0]], false),
    bobAnim(H, prop.hipY, [[0, 0], [0.26, 0.03], [0.525, 0], [0.79, 0.03], [1.05, 0]], false),
  ]))

  // run — long fast stride + forward lean (0.66s loop)
  clips.push(new THREE.AnimationClip('run', 0.66, [
    qAnim(T, [[0, 0.22, 0, 0], [0.165, 0.25, 0, 0.08], [0.33, 0.22, 0, 0], [0.495, 0.25, 0, -0.08], [0.66, 0.22, 0, 0]], false),
    qAnim(LL, [[0, 0.95, 0, 0], [0.33, -0.85, 0, 0], [0.66, 0.95, 0, 0]], false),
    qAnim(LR, [[0, -0.85, 0, 0], [0.33, 0.95, 0, 0], [0.66, -0.85, 0, 0]], false),
    qAnim(AL, [[0, -0.95, 0, 0], [0.33, 0.75, 0, 0], [0.66, -0.95, 0, 0]], false),
    qAnim(AR, [[0, 0.75, 0, 0], [0.33, -0.95, 0, 0], [0.66, 0.75, 0, 0]], false),
    bobAnim(H, prop.hipY, [[0, 0], [0.165, 0.06], [0.33, 0], [0.495, 0.06], [0.66, 0]], false),
  ]))

  // jump — crouch → launch → apex hold (0.85s once)
  clips.push(new THREE.AnimationClip('jump', 0.85, [
    qAnim(T, [[0, 0, 0, 0], [0.18, 0.3, 0, 0], [0.4, 0.05, 0, 0], [0.85, 0.1, 0, 0]], false),
    qAnim(LL, [[0, 0, 0, 0], [0.18, -0.8, 0, 0], [0.4, -0.45, 0, 0], [0.85, -0.5, 0, 0]], false),
    qAnim(LR, [[0, 0, 0, 0], [0.18, -0.5, 0, 0], [0.4, 0.3, 0, 0], [0.85, 0.25, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.18, 0.5, 0, 0], [0.5, -2.6, 0, 0], [0.85, -2.6, 0, 0]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.18, 0.5, 0, 0], [0.5, -2.6, 0, 0], [0.85, -2.6, 0, 0]], false),
    bobAnim(H, prop.hipY, [[0, 0], [0.18, -0.14], [0.4, 0.05], [0.85, 0.05]], false),
  ]))

  // fall — airborne flail (1.2s loop)
  clips.push(new THREE.AnimationClip('fall', 1.2, [
    qAnim(T, [[0, -0.12, 0, 0], [0.6, -0.18, 0, 0.06], [1.2, -0.12, 0, 0]], false),
    qAnim(HD, [[0, -0.25, 0, 0], [1.2, -0.25, 0, 0]], false),
    qAnim(AL, [[0, -2.3, 0, 0.3], [0.3, -2.7, 0, 0.5], [0.6, -2.3, 0, 0.3], [0.9, -2.7, 0, 0.5], [1.2, -2.3, 0, 0.3]], false),
    qAnim(AR, [[0, -2.3, 0, -0.3], [0.3, -2.7, 0, -0.5], [0.6, -2.3, 0, -0.3], [0.9, -2.7, 0, -0.5], [1.2, -2.3, 0, -0.3]], false),
    qAnim(LL, [[0, -0.35, 0, 0], [0.6, -0.1, 0, 0], [1.2, -0.35, 0, 0]], false),
    qAnim(LR, [[0, 0.25, 0, 0], [0.6, 0.05, 0, 0], [1.2, 0.25, 0, 0]], false),
  ]))

  // land — deep absorb crouch → rise (0.5s once)
  clips.push(new THREE.AnimationClip('land', 0.5, [
    qAnim(T, [[0, 0.42, 0, 0], [0.5, 0.04, 0, 0]], false),
    qAnim(LL, [[0, -1.0, 0, 0], [0.5, -0.05, 0, 0]], false),
    qAnim(LR, [[0, -0.9, 0, 0], [0.5, -0.05, 0, 0]], false),
    qAnim(AL, [[0, -1.3, 0, 0.4], [0.5, 0.05, 0, 0]], false),
    qAnim(AR, [[0, -1.3, 0, -0.4], [0.5, 0.05, 0, -0]], false),
    bobAnim(H, prop.hipY, [[0, -0.3], [0.5, 0]], false),
  ]))

  // slide — ground slide pose (0.8s loop)
  clips.push(new THREE.AnimationClip('slide', 0.8, [
    qAnim(T, [[0, -1.1, 0, 0], [0.4, -1.05, 0, 0.04], [0.8, -1.1, 0, 0]], false),
    qAnim(HD, [[0, 0.4, 0, 0], [0.8, 0.4, 0, 0]], false),
    qAnim(LL, [[0, 0.4, 0, 0], [0.8, 0.4, 0, 0]], false),
    qAnim(LR, [[0, -0.15, 0, 0], [0.8, -0.15, 0, 0]], false),
    qAnim(AL, [[0, -2.9, 0, 0.2], [0.8, -2.9, 0, 0.2]], false),
    qAnim(AR, [[0, -2.7, 0, -0.2], [0.8, -2.7, 0, -0.2]], false),
    bobAnim(H, prop.hipY * 0.62, [[0, 0], [0.8, 0]], false),
  ]))

  // hit — stagger (0.6s once)
  clips.push(new THREE.AnimationClip('hit', 0.6, [
    qAnim(T, [[0, 0, 0, 0], [0.15, -0.55, 0, 0.1], [0.6, -0.3, 0, 0]], false),
    qAnim(HD, [[0, 0, 0, 0], [0.2, -0.3, 0.2, 0], [0.45, -0.15, -0.15, 0], [0.6, -0.2, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.2, -1.4, 0, 0.7], [0.6, -0.6, 0, 0.4]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.2, -1.4, 0, -0.7], [0.6, -0.6, 0, -0.4]], false),
    qAnim(LL, [[0, 0, 0, 0], [0.2, 0.35, 0, 0], [0.6, 0.2, 0, 0]], false),
    qAnim(LR, [[0, 0, 0, 0], [0.2, -0.3, 0, 0], [0.6, -0.15, 0, 0]], false),
    bobAnim(H, prop.hipY, [[0, 0], [0.2, -0.08], [0.6, -0.02]], false),
  ]))

  // detained — hands behind back, head bowed (2.2s loop)
  clips.push(new THREE.AnimationClip('detained', 2.2, [
    qAnim(T, [[0, 0.12, 0, 0], [1.1, 0.14, 0, 0], [2.2, 0.12, 0, 0]], false),
    qAnim(HD, [[0, 0.35, 0, 0], [0.7, 0.42, 0.08, 0], [1.6, 0.38, -0.08, 0], [2.2, 0.35, 0, 0]], false),
    qAnim(AL, [[0, 0.55, 0, 0.5], [2.2, 0.55, 0, 0.5]], false),
    qAnim(AR, [[0, 0.55, 0, -0.5], [2.2, 0.55, 0, -0.5]], false),
    qAnim(LL, [[0, 0.06, 0, 0], [2.2, 0.06, 0, 0]], false),
    qAnim(LR, [[0, -0.06, 0, 0], [2.2, -0.06, 0, 0]], false),
  ]))

  // recover — get up from crouch (0.9s once)
  clips.push(new THREE.AnimationClip('recover', 0.9, [
    qAnim(T, [[0, 0.5, 0, 0], [0.55, 0.12, 0, 0], [0.9, 0.03, 0, 0]], false),
    qAnim(HD, [[0, 0.3, 0, 0], [0.9, 0, 0, 0]], false),
    qAnim(LL, [[0, -1.1, 0, 0], [0.55, -0.3, 0, 0], [0.9, 0, 0, 0]], false),
    qAnim(LR, [[0, -1.0, 0, 0], [0.55, -0.25, 0, 0], [0.9, 0, 0, 0]], false),
    qAnim(AL, [[0, -0.8, 0, 0.3], [0.9, 0.05, 0, 0]], false),
    qAnim(AR, [[0, -0.8, 0, -0.3], [0.9, 0.05, 0, 0]], false),
    bobAnim(H, prop.hipY, [[0, -0.34], [0.55, -0.06], [0.9, 0]], false),
  ]))

  // celebrate — fists up hop (1.5s loop)
  clips.push(new THREE.AnimationClip('celebrate', 1.5, [
    qAnim(T, [[0, -0.06, 0, 0], [0.75, 0, 0, 0], [1.5, -0.06, 0, 0]], false),
    qAnim(HD, [[0, -0.15, 0, 0], [1.5, -0.15, 0, 0]], false),
    qAnim(AL, [[0, -2.9, 0, 0.3], [0.75, -2.6, 0, 0.45], [1.5, -2.9, 0, 0.3]], false),
    qAnim(AR, [[0, -2.9, 0, -0.3], [0.75, -2.6, 0, -0.45], [1.5, -2.9, 0, -0.3]], false),
    bobAnim(H, prop.hipY, [[0, 0], [0.35, 0.14], [0.75, 0], [1.1, 0.14], [1.5, 0]], false),
  ]))

  // throw — windup → release (0.7s once)
  clips.push(new THREE.AnimationClip('throw', 0.7, [
    qAnim(T, [[0, 0, 0, 0], [0.2, 0.18, 0, -0.25], [0.42, 0.28, 0, 0.18], [0.7, 0.05, 0, 0]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.2, 1.0, 0, 0], [0.42, -2.4, 0, 0], [0.7, -1.2, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.42, 0.4, 0, 0], [0.7, 0, 0, 0]], false),
    bobAnim(H, prop.hipY, [[0, 0], [0.42, 0.03], [0.7, 0]], false),
  ]))

  // heal — drink/embrace pose (1.0s once)
  clips.push(new THREE.AnimationClip('heal', 1.0, [
    qAnim(T, [[0, 0, 0, 0], [0.35, -0.08, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(HD, [[0, 0, 0, 0], [0.35, 0.1, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.3, -1.7, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.3, -1.7, 0, 0], [1.0, 0, 0, 0]], false),
  ]))

  return clips
}

// ---------- export ----------
function exportGlb(root: THREE.Object3D, clips: THREE.AnimationClip[], out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter()
    exporter.parse(
      root,
      (result) => {
        const buf = result as ArrayBuffer
        if (new DataView(buf).getUint32(0, true) !== 0x46546c67) { reject(new Error('not GLB')); return }
        writeFileSync(out, Buffer.from(buf))
        console.log(`✓ ${out} — ${(buf.byteLength / 1024).toFixed(1)} KB, ${clips.length} clips`)
        resolve()
      },
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
      { binary: true, animations: clips },
    )
  })
}

const male = buildCharacter(MALE_PALETTE, MALE_PROP)
const female = buildCharacter(FEMALE_PALETTE, FEMALE_PROP)
const maleClips = buildClips(MALE_PROP)
const femaleClips = buildClips(FEMALE_PROP)

const t0 = Date.now()
const timer = setInterval(() => {
  if (Date.now() - t0 > 15000) { console.error('TIMEOUT'); process.exit(1) }
}, 100)

Promise.all([
  exportGlb(male.root, maleClips, 'public/models/votechor-male.glb'),
  exportGlb(female.root, femaleClips, 'public/models/votechor-female.glb'),
]).then(() => { clearInterval(timer); console.log('DONE'); process.exit(0) })
  .catch((e) => { console.error('FAIL', e); process.exit(1) })
