/**
 * VoteChor — "VC Kid" GLB character exporter (runs under bun, no DOM).
 *
 * Builds the runner kid from the brand story artwork (public/brand/_gen-story.png):
 * red cap, amber tee, blue jeans, red-and-white sneakers, navy backpack — with
 * far richer detailing than the base cast (layered cartoon eyes with highlights,
 * brows, grin, ears, nose, hair fringe, cap dome+brim+button, sleeve/jean cuffs,
 * multi-part sneakers with laces) and full PBR materials.
 *
 * Rig contract is IDENTICAL to scripts/export-character-glb.ts so the game's
 * GLBAnimDriver / applyAvatarLook can consume it unchanged:
 *
 *   VoteChorKid (root, origin at feet)
 *   └─ Hips
 *      ├─ Torso ── Head(+face) · ArmL · ArmR
 *      ├─ LegL
 *      └─ LegR
 *
 * 13 node-TRS clips: idle · walk · run · jump · fall · land · slide · hit ·
 * detained · recover · celebrate · throw · heal
 *
 * Output: public/models/votechor-kid.glb
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

// ---------- palette (sampled from public/brand/_gen-story.png) ----------
// cap red  #d8352c · tee amber #f2a541 (brand) · denim #3e6b9e · cuff #5a83b3
// skin #b97a52 · hair #201512 · backpack navy #2c3a55 · sole #efece2
const C = {
  cap: 0xd8352c,
  capDark: 0xb02a24,
  tee: 0xf2a541,
  teeDark: 0xd88f2e,
  denim: 0x3e6b9e,
  denimLight: 0x5a83b3,
  skin: 0xb97a52,
  hair: 0x201512,
  pack: 0x2c3a55,
  packLight: 0x3a4c6e,
  sole: 0xefece2,
  shoe: 0xcf3230,
  eyeWhite: 0xf5f2ea,
  pupil: 0x241812,
  mouth: 0x5f2a24,
  teeth: 0xf7f4ec,
}

// ---------- proportions (kid ~1.42m — young protagonist, engine-safe scale) ----------
const PROP = {
  hipY: 0.6,     // hip pivot height
  torsoH: 0.44,  // hips → neck
  torsoW: 0.32,
  torsoD: 0.19,
  armLen: 0.48,
  armW: 0.052,
  legLen: 0.6,   // hip pivot → floor
  legW: 0.062,
  headR: 0.162,
}

type Q = [number, number, number, number]
const quat = (x: number, y: number, z: number): Q => {
  const e = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z))
  return [e.x, e.y, e.z, e.w]
}
const qTrack = (node: string, times: number[], qs: Q[]) =>
  new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, qs.flat())
const pTrack = (node: string, times: number[], vs: [number, number, number][]) =>
  new THREE.VectorKeyframeTrack(`${node}.position`, times, vs.flat())
const qAnim = (node: string, poses: [number, number, number, number][], loop: boolean) => {
  const times = poses.map((p) => p[0])
  const qs = poses.map((p) => quat(p[1], p[2], p[3]))
  if (loop) { times.push(poses[0][0] + times[times.length - 1]); qs.push(qs[0]) }
  return qTrack(node, times, qs)
}
const bobAnim = (node: string, baseY: number, poses: [number, number][], loop: boolean) => {
  const times = poses.map((p) => p[0])
  const vs = poses.map((p) => [0, baseY + p[1], 0] as [number, number, number])
  if (loop) { times.push(poses[0][0] + times[times.length - 1]); vs.push(vs[0]) }
  return pTrack(node, times, vs)
}

// ---------- material factory (named, so tinting pipelines can find them) ----------
function makeMaterials() {
  return {
    skin: new THREE.MeshStandardMaterial({ color: C.skin, roughness: 0.55, metalness: 0.0 }),
    tee: new THREE.MeshStandardMaterial({ color: C.tee, roughness: 0.82, metalness: 0.0 }),
    teeDark: new THREE.MeshStandardMaterial({ color: C.teeDark, roughness: 0.85, metalness: 0.0 }),
    denim: new THREE.MeshStandardMaterial({ color: C.denim, roughness: 0.88, metalness: 0.0 }),
    denimLight: new THREE.MeshStandardMaterial({ color: C.denimLight, roughness: 0.9, metalness: 0.0 }),
    cap: new THREE.MeshStandardMaterial({ color: C.cap, roughness: 0.5, metalness: 0.02 }),
    capDark: new THREE.MeshStandardMaterial({ color: C.capDark, roughness: 0.55, metalness: 0.02 }),
    hair: new THREE.MeshStandardMaterial({ color: C.hair, roughness: 0.6, metalness: 0.0 }),
    pack: new THREE.MeshStandardMaterial({ color: C.pack, roughness: 0.7, metalness: 0.05 }),
    packLight: new THREE.MeshStandardMaterial({ color: C.packLight, roughness: 0.7, metalness: 0.05 }),
    sole: new THREE.MeshStandardMaterial({ color: C.sole, roughness: 0.92, metalness: 0.0 }),
    shoe: new THREE.MeshStandardMaterial({ color: C.shoe, roughness: 0.6, metalness: 0.02 }),
    eyeWhite: new THREE.MeshStandardMaterial({ color: C.eyeWhite, roughness: 0.22, metalness: 0.0 }),
    pupil: new THREE.MeshStandardMaterial({ color: C.pupil, roughness: 0.12, metalness: 0.0 }),
    teeth: new THREE.MeshStandardMaterial({ color: C.teeth, roughness: 0.3, metalness: 0.0 }),
    mouth: new THREE.MeshStandardMaterial({ color: C.mouth, roughness: 0.45, metalness: 0.0 }),
    white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.0 }),
  }
}
type Mats = ReturnType<typeof makeMaterials>

// ---------- tiny builder helpers ----------
const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
  const m = new THREE.Mesh(geo, mat)
  m.name = name
  return m
}
const box = (w: number, h: number, d: number, mat: THREE.Material, name: string) => mesh(new THREE.BoxGeometry(w, h, d), mat, name)
const sph = (r: number, mat: THREE.Material, name: string, seg = 12) => mesh(new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.75))), mat, name)
const cyl = (rt: number, rb: number, h: number, mat: THREE.Material, name: string, seg = 14) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, name)

// ---------- character builder ----------
// Helper: z of the head ellipsoid surface at height y (head local space), so
// face features sit PROUD of the skin instead of drowning inside it.
// Head = sphere r=headR, scaled (0.94, 1.0, 0.96), center at y = headR*0.92.
function faceZ(y: number): number {
  const cy = PROP.headR * 0.92
  const dy = (y - cy) / 1.0 // y-scale is 1.0
  const rr = Math.max(0.05, 1 - (dy * dy) / (1.0 * 1.0))
  return PROP.headR * 0.96 * Math.sqrt(rr)
}

function buildKid() {
  const M = makeMaterials()
  const root = new THREE.Group()
  root.name = 'VoteChorKid'
  const R = PROP.headR

  // === Hips (root motion node: y-bob lives here) ===
  const hips = new THREE.Group()
  hips.name = 'Hips'
  hips.position.y = PROP.hipY
  root.add(hips)

  // pelvis — rounded denim block the legs hang from
  const pelvis = box(0.26, 0.14, 0.17, M.denim, 'Pelvis')
  pelvis.position.y = -0.02
  hips.add(pelvis)

  // === Torso pivot ===
  const torsoPivot = new THREE.Group()
  torsoPivot.name = 'Torso'
  hips.add(torsoPivot)

  // tee body — tapered cylinder + shoulder cap + hem ring
  const tee = cyl(0.15, 0.125, 0.34, M.tee, 'TeeBody', 16)
  tee.position.y = 0.21
  torsoPivot.add(tee)
  const shoulders = sph(0.15, M.tee, 'Shoulders', 14)
  shoulders.scale.set(1.08, 0.5, 0.82)
  shoulders.position.y = 0.375
  torsoPivot.add(shoulders)
  const hem = cyl(0.132, 0.132, 0.035, M.teeDark, 'TeeHem', 16)
  hem.position.y = 0.045
  torsoPivot.add(hem)
  const collar = cyl(0.072, 0.082, 0.03, M.teeDark, 'Collar', 12)
  collar.position.y = 0.415
  torsoPivot.add(collar)
  // neck filler so the head never floats over an empty gap
  const neck = cyl(0.05, 0.055, 0.06, M.skin, 'Neck', 10)
  neck.position.y = 0.43
  torsoPivot.add(neck)
  // small protest badge sitting ON the tee surface
  const badge = cyl(0.022, 0.022, 0.008, M.white, 'ChestBadge', 10)
  badge.rotation.x = Math.PI / 2
  badge.position.set(0.055, 0.3, 0.14)
  torsoPivot.add(badge)

  // === Backpack (navy, on the back) ===
  const pack = box(0.24, 0.28, 0.11, M.pack, 'Backpack')
  pack.position.set(0, 0.2, -0.15)
  torsoPivot.add(pack)
  const packTop = cyl(0.055, 0.055, 0.22, M.packLight, 'PackRoll', 10)
  packTop.rotation.z = Math.PI / 2
  packTop.position.set(0, 0.35, -0.15)
  torsoPivot.add(packTop)
  const zipper = box(0.02, 0.24, 0.012, M.teeDark, 'PackZipper')
  zipper.position.set(0, 0.2, -0.208)
  torsoPivot.add(zipper)
  // straps hug the tee's front surface, upper chest only (backpack straps, not suspenders)
  for (const s of [-1, 1] as const) {
    const strap = box(0.034, 0.16, 0.014, M.packLight, s < 0 ? 'StrapL' : 'StrapR')
    strap.position.set(s * 0.068, 0.31, 0.148)
    strap.rotation.x = -0.05
    torsoPivot.add(strap)
  }

  // === Head (pivot at neck) ===
  const headPivot = new THREE.Group()
  headPivot.name = 'Head'
  headPivot.position.y = PROP.torsoH
  torsoPivot.add(headPivot)

  const head = sph(R, M.skin, 'HeadMesh', 20)
  head.position.y = R * 0.92
  head.scale.set(0.94, 1.0, 0.96)
  headPivot.add(head)

  // ears — at eye-line height, embedded halfway into the skull
  for (const s of [-1, 1] as const) {
    const ear = sph(0.036, M.skin, s < 0 ? 'EarL' : 'EarR', 8)
    ear.scale.set(0.45, 1.0, 0.75)
    ear.position.set(s * R * 0.9, R * 0.6, 0.005)
    headPivot.add(ear)
  }

  // nose — proud of the surface
  const nose = sph(0.024, M.skin, 'Nose', 8)
  nose.position.set(0, R * 0.42, R * 0.84)
  headPivot.add(nose)

  // layered cartoon eyes: sclera + pupil + specular highlight (all proud of face)
  for (const s of [-1, 1] as const) {
    const side = s < 0 ? 'L' : 'R'
    const sclera = sph(0.04, M.eyeWhite, `Eye${side}`, 12)
    sclera.scale.set(1, 1.12, 0.55)
    sclera.position.set(s * 0.054, R * 0.66, R * 0.9)
    headPivot.add(sclera)
    const pupil = sph(0.019, M.pupil, `Pupil${side}`, 8)
    pupil.position.set(s * 0.055, R * 0.67, R * 0.96)
    headPivot.add(pupil)
    const glint = sph(0.006, M.white, `Glint${side}`, 6)
    glint.position.set(s * 0.048, R * 0.72, R * 0.99)
    headPivot.add(glint)
  }

  // eyebrows — expressive, slightly angled, just above the eyes
  for (const s of [-1, 1] as const) {
    const brow = box(0.05, 0.012, 0.016, M.hair, s < 0 ? 'BrowL' : 'BrowR')
    brow.position.set(s * 0.055, R * 0.86, R * 0.94)
    brow.rotation.z = s * -0.12
    headPivot.add(brow)
  }

  // grin — dark smile with a white teeth strip framed inside it
  const mouth = box(0.085, 0.032, 0.014, M.mouth, 'Mouth')
  mouth.position.set(0, R * 0.22, R * 0.68)
  headPivot.add(mouth)
  const teeth = box(0.055, 0.014, 0.015, M.teeth, 'Teeth')
  teeth.position.set(0, R * 0.235, R * 0.685)
  headPivot.add(teeth)

  // hair — back volume pushed behind the face plane (no mask hack), fringe
  // tufts along the forehead, side tufts in front of the ears, nape tufts
  const hairBack = sph(R * 1.03, M.hair, 'HairBack', 16)
  hairBack.scale.set(0.98, 1.0, 0.9)
  hairBack.position.set(0, R * 1.0, -R * 0.04)
  headPivot.add(hairBack)
  for (let i = -2; i <= 2; i++) {
    const tuft = sph(0.034, M.hair, `Fringe${i + 2}`, 8)
    tuft.scale.set(1.15, 0.55, 0.7)
    tuft.position.set(i * 0.042, R * (1.02 - Math.abs(i) * 0.06), R * (0.72 - Math.abs(i) * 0.045))
    tuft.rotation.z = i * 0.18
    headPivot.add(tuft)
  }
  for (const s of [-1, 1] as const) {
    const tuft = sph(0.03, M.hair, s < 0 ? 'SideHairL' : 'SideHairR', 8)
    tuft.scale.set(0.55, 0.95, 1.05)
    tuft.position.set(s * R * 0.84, R * 0.86, R * 0.12)
    headPivot.add(tuft)
    const nape = sph(0.034, M.hair, s < 0 ? 'NapeL' : 'NapeR', 8)
    nape.scale.set(1.0, 0.7, 0.8)
    nape.position.set(s * R * 0.4, R * 0.44, -R * 0.68)
    headPivot.add(nape)
  }

  // === Cap — dome + brim + button + emblem, tilted back like the artwork ===
  const capGroup = new THREE.Group()
  capGroup.name = 'Cap'
  capGroup.position.y = R * 0.95
  capGroup.rotation.x = -0.12
  headPivot.add(capGroup)
  const capDome = new THREE.Mesh(new THREE.SphereGeometry(R * 1.08, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), M.cap)
  capDome.name = 'CapDome'
  capDome.position.y = R * 0.08
  capDome.scale.set(1.0, 0.95, 1.02)
  capGroup.add(capDome)
  const capRim = cyl(R * 1.06, R * 1.08, 0.026, M.capDark, 'CapRim', 18)
  capRim.position.y = R * 0.06
  capGroup.add(capRim)
  const brim = sph(0.14, M.cap, 'CapBrim', 14)
  brim.scale.set(1.16, 0.14, 0.78)
  brim.position.set(0, R * 0.02, R * 0.58)
  capGroup.add(brim)
  const button = sph(0.017, M.capDark, 'CapButton', 8)
  button.position.y = R * 1.06
  capGroup.add(button)
  const emblem = cyl(0.026, 0.026, 0.008, M.white, 'CapEmblem', 12)
  emblem.rotation.x = Math.PI / 2 - 0.55
  emblem.position.set(0, R * 0.55, R * 0.82)
  capGroup.add(emblem)

  // === Arms (pivot at shoulder; hang down; rotation.x negative = raise forward) ===
  const shoulderY = PROP.torsoH * 0.86
  const shoulderX = PROP.torsoW / 2 + 0.028
  const buildArm = (side: -1 | 1) => {
    const name = side < 0 ? 'ArmL' : 'ArmR'
    const pivot = new THREE.Group()
    pivot.name = name
    pivot.position.set(side * shoulderX, shoulderY, 0)
    torsoPivot.add(pivot)
    // skin upper+fore arm
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(PROP.armW, PROP.armLen - PROP.armW * 2.4, 4, 10), M.skin)
    arm.position.y = -PROP.armLen / 2 + 0.01
    arm.name = name + 'Mesh'
    pivot.add(arm)
    // short sleeve cuff
    const sleeve = cyl(PROP.armW * 1.35, PROP.armW * 1.45, 0.11, M.tee, name + 'Sleeve', 10)
    sleeve.position.y = -0.045
    pivot.add(sleeve)
    // mitten hand + thumb
    const hand = sph(PROP.armW * 1.32, M.skin, name + 'Hand', 10)
    hand.position.y = -PROP.armLen + 0.02
    pivot.add(hand)
    const thumb = sph(PROP.armW * 0.5, M.skin, name + 'Thumb', 6)
    thumb.position.set(side * -PROP.armW * 0.7, -PROP.armLen + 0.06, 0.02)
    pivot.add(thumb)
    return pivot
  }
  buildArm(-1)
  buildArm(1)

  // === Legs (pivot at hip joint; hang down) ===
  const hipX = PROP.torsoW * 0.24
  const buildLeg = (side: -1 | 1) => {
    const name = side < 0 ? 'LegL' : 'LegR'
    const pivot = new THREE.Group()
    pivot.name = name
    pivot.position.set(side * hipX, 0, 0)
    hips.add(pivot)
    // jean leg
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(PROP.legW, PROP.legLen - PROP.legW * 2.6 - 0.05, 4, 10), M.denim)
    leg.position.y = -PROP.legLen / 2 + 0.03
    leg.name = name + 'Mesh'
    pivot.add(leg)
    // rolled cuff
    const cuff = cyl(PROP.legW * 1.18, PROP.legW * 1.22, 0.055, M.denimLight, name + 'Cuff', 10)
    cuff.position.y = -PROP.legLen + 0.095
    pivot.add(cuff)
    // === sneaker: sole + upper + toecap + laces + heel tab ===
    const sole = box(0.125, 0.032, 0.215, M.sole, name + 'Sole')
    sole.position.set(0, -PROP.legLen + 0.016, 0.04)
    pivot.add(sole)
    const upper = box(0.108, 0.05, 0.18, M.shoe, name + 'Shoe')
    upper.position.set(0, -PROP.legLen + 0.055, 0.035)
    pivot.add(upper)
    const toecap = sph(0.052, M.sole, name + 'ToeCap', 10)
    toecap.scale.set(1.05, 0.55, 1.15)
    toecap.position.set(0, -PROP.legLen + 0.055, 0.105)
    pivot.add(toecap)
    for (let i = 0; i < 3; i++) {
      const lace = box(0.085, 0.008, 0.012, M.sole, name + `Lace${i}`)
      lace.position.set(0, -PROP.legLen + 0.068 + i * 0.022, 0.035 + i * 0.028)
      lace.rotation.x = -0.35
      pivot.add(lace)
    }
    const heel = box(0.06, 0.03, 0.02, M.shoe, name + 'HeelTab')
    heel.position.set(0, -PROP.legLen + 0.085, -0.058)
    pivot.add(heel)
    return pivot
  }
  buildLeg(-1)
  buildLeg(1)

  root.traverse((o) => { o.castShadow = false; o.receiveShadow = false })
  return root
}

// ---------- animation clips (kid energy: quicker cadence, extra bounce) ----------
function buildClips(): THREE.AnimationClip[] {
  const H = 'Hips', T = 'Torso', HD = 'Head', AL = 'ArmL', AR = 'ArmR', LL = 'LegL', LR = 'LegR'
  const clips: THREE.AnimationClip[] = []

  // idle — bouncy breathing, head looks around (4s loop)
  clips.push(new THREE.AnimationClip('idle', 4, [
    qAnim(T, [[0, 0.03, 0, 0], [2, 0.06, 0, 0], [4, 0.03, 0, 0]], false),
    qAnim(HD, [[0, 0, 0, 0], [1.3, 0.05, 0.1, 0], [2.6, -0.03, -0.09, 0], [4, 0, 0, 0]], false),
    qAnim(AL, [[0, 0.08, 0, 0.05], [2, 0.14, 0, 0.09], [4, 0.08, 0, 0.05]], false),
    qAnim(AR, [[0, 0.08, 0, -0.05], [2, 0.14, 0, -0.09], [4, 0.08, 0, -0.05]], false),
    bobAnim(H, PROP.hipY, [[0, 0], [1, 0.016], [2, 0], [3, 0.016], [4, 0]], false),
  ]))

  // walk — quick kid stride (0.8s loop)
  clips.push(new THREE.AnimationClip('walk', 0.8, [
    qAnim(T, [[0, 0.09, 0, 0], [0.2, 0.11, 0, 0.06], [0.4, 0.09, 0, 0], [0.6, 0.11, 0, -0.06], [0.8, 0.09, 0, 0]], false),
    qAnim(HD, [[0, -0.04, 0, 0], [0.4, -0.04, 0, 0]], false),
    qAnim(LL, [[0, 0.6, 0, 0], [0.4, -0.6, 0, 0], [0.8, 0.6, 0, 0]], false),
    qAnim(LR, [[0, -0.6, 0, 0], [0.4, 0.6, 0, 0], [0.8, -0.6, 0, 0]], false),
    qAnim(AL, [[0, -0.6, 0, 0], [0.4, 0.6, 0, 0], [0.8, -0.6, 0, 0]], false),
    qAnim(AR, [[0, 0.6, 0, 0], [0.4, -0.6, 0, 0], [0.8, 0.6, 0, 0]], false),
    bobAnim(H, PROP.hipY, [[0, 0], [0.2, 0.035], [0.4, 0], [0.6, 0.035], [0.8, 0]], false),
  ]))

  // run — long fast stride + forward lean (0.55s loop)
  clips.push(new THREE.AnimationClip('run', 0.55, [
    qAnim(T, [[0, 0.26, 0, 0], [0.14, 0.29, 0, 0.09], [0.275, 0.26, 0, 0], [0.41, 0.29, 0, -0.09], [0.55, 0.26, 0, 0]], false),
    qAnim(HD, [[0, -0.14, 0, 0], [0.55, -0.14, 0, 0]], false),
    qAnim(LL, [[0, 1.0, 0, 0], [0.275, -0.9, 0, 0], [0.55, 1.0, 0, 0]], false),
    qAnim(LR, [[0, -0.9, 0, 0], [0.275, 1.0, 0, 0], [0.55, -0.9, 0, 0]], false),
    qAnim(AL, [[0, -1.05, 0, 0], [0.14, -0.4, 0, 0], [0.275, 0.85, 0, 0], [0.41, -0.4, 0, 0], [0.55, -1.05, 0, 0]], false),
    qAnim(AR, [[0, 0.85, 0, 0], [0.14, -0.4, 0, 0], [0.275, -1.05, 0, 0], [0.41, -0.4, 0, 0], [0.55, 0.85, 0, 0]], false),
    bobAnim(H, PROP.hipY, [[0, 0], [0.14, 0.07], [0.275, 0], [0.41, 0.07], [0.55, 0]], false),
  ]))

  // jump — crouch → launch → apex hold (0.85s once)
  clips.push(new THREE.AnimationClip('jump', 0.85, [
    qAnim(T, [[0, 0, 0, 0], [0.18, 0.32, 0, 0], [0.4, 0.06, 0, 0], [0.85, 0.12, 0, 0]], false),
    qAnim(LL, [[0, 0, 0, 0], [0.18, -0.85, 0, 0], [0.4, -0.5, 0, 0], [0.85, -0.55, 0, 0]], false),
    qAnim(LR, [[0, 0, 0, 0], [0.18, -0.55, 0, 0], [0.4, 0.35, 0, 0], [0.85, 0.3, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.18, 0.55, 0, 0], [0.5, -2.7, 0, 0], [0.85, -2.7, 0, 0]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.18, 0.55, 0, 0], [0.5, -2.7, 0, 0], [0.85, -2.7, 0, 0]], false),
    bobAnim(H, PROP.hipY, [[0, 0], [0.18, -0.15], [0.4, 0.06], [0.85, 0.06]], false),
  ]))

  // fall — airborne flail (1.2s loop)
  clips.push(new THREE.AnimationClip('fall', 1.2, [
    qAnim(T, [[0, -0.14, 0, 0], [0.6, -0.2, 0, 0.07], [1.2, -0.14, 0, 0]], false),
    qAnim(HD, [[0, -0.28, 0, 0], [1.2, -0.28, 0, 0]], false),
    qAnim(AL, [[0, -2.35, 0, 0.35], [0.3, -2.75, 0, 0.55], [0.6, -2.35, 0, 0.35], [0.9, -2.75, 0, 0.55], [1.2, -2.35, 0, 0.35]], false),
    qAnim(AR, [[0, -2.35, 0, -0.35], [0.3, -2.75, 0, -0.55], [0.6, -2.35, 0, -0.35], [0.9, -2.75, 0, -0.55], [1.2, -2.35, 0, -0.35]], false),
    qAnim(LL, [[0, -0.4, 0, 0], [0.6, -0.12, 0, 0], [1.2, -0.4, 0, 0]], false),
    qAnim(LR, [[0, 0.3, 0, 0], [0.6, 0.08, 0, 0], [1.2, 0.3, 0, 0]], false),
  ]))

  // land — deep absorb crouch → rise (0.5s once)
  clips.push(new THREE.AnimationClip('land', 0.5, [
    qAnim(T, [[0, 0.45, 0, 0], [0.5, 0.05, 0, 0]], false),
    qAnim(LL, [[0, -1.05, 0, 0], [0.5, -0.05, 0, 0]], false),
    qAnim(LR, [[0, -0.95, 0, 0], [0.5, -0.05, 0, 0]], false),
    qAnim(AL, [[0, -1.35, 0, 0.45], [0.5, 0.05, 0, 0]], false),
    qAnim(AR, [[0, -1.35, 0, -0.45], [0.5, 0.05, 0, 0]], false),
    bobAnim(H, PROP.hipY, [[0, -0.26], [0.5, 0]], false),
  ]))

  // slide — ground slide pose (0.8s loop)
  clips.push(new THREE.AnimationClip('slide', 0.8, [
    qAnim(T, [[0, -1.15, 0, 0], [0.4, -1.1, 0, 0.05], [0.8, -1.15, 0, 0]], false),
    qAnim(HD, [[0, 0.45, 0, 0], [0.8, 0.45, 0, 0]], false),
    qAnim(LL, [[0, 0.45, 0, 0], [0.8, 0.45, 0, 0]], false),
    qAnim(LR, [[0, -0.18, 0, 0], [0.8, -0.18, 0, 0]], false),
    qAnim(AL, [[0, -2.95, 0, 0.25], [0.8, -2.95, 0, 0.25]], false),
    qAnim(AR, [[0, -2.75, 0, -0.25], [0.8, -2.75, 0, -0.25]], false),
    bobAnim(H, PROP.hipY * 0.62, [[0, 0], [0.8, 0]], false),
  ]))

  // hit — stagger (0.6s once)
  clips.push(new THREE.AnimationClip('hit', 0.6, [
    qAnim(T, [[0, 0, 0, 0], [0.15, -0.6, 0, 0.12], [0.6, -0.32, 0, 0]], false),
    qAnim(HD, [[0, 0, 0, 0], [0.2, -0.35, 0.22, 0], [0.45, -0.18, -0.16, 0], [0.6, -0.22, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.2, -1.45, 0, 0.75], [0.6, -0.65, 0, 0.42]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.2, -1.45, 0, -0.75], [0.6, -0.65, 0, -0.42]], false),
    qAnim(LL, [[0, 0, 0, 0], [0.2, 0.38, 0, 0], [0.6, 0.22, 0, 0]], false),
    qAnim(LR, [[0, 0, 0, 0], [0.2, -0.32, 0, 0], [0.6, -0.16, 0, 0]], false),
    bobAnim(H, PROP.hipY, [[0, 0], [0.2, -0.09], [0.6, -0.02]], false),
  ]))

  // detained — hands behind back, head bowed (2.2s loop)
  clips.push(new THREE.AnimationClip('detained', 2.2, [
    qAnim(T, [[0, 0.14, 0, 0], [1.1, 0.16, 0, 0], [2.2, 0.14, 0, 0]], false),
    qAnim(HD, [[0, 0.38, 0, 0], [0.7, 0.46, 0.09, 0], [1.6, 0.42, -0.09, 0], [2.2, 0.38, 0, 0]], false),
    qAnim(AL, [[0, 0.6, 0, 0.55], [2.2, 0.6, 0, 0.55]], false),
    qAnim(AR, [[0, 0.6, 0, -0.55], [2.2, 0.6, 0, -0.55]], false),
    qAnim(LL, [[0, 0.06, 0, 0], [2.2, 0.06, 0, 0]], false),
    qAnim(LR, [[0, -0.06, 0, 0], [2.2, -0.06, 0, 0]], false),
  ]))

  // recover — get up from crouch (0.9s once)
  clips.push(new THREE.AnimationClip('recover', 0.9, [
    qAnim(T, [[0, 0.52, 0, 0], [0.55, 0.14, 0, 0], [0.9, 0.04, 0, 0]], false),
    qAnim(HD, [[0, 0.32, 0, 0], [0.9, 0, 0, 0]], false),
    qAnim(LL, [[0, -1.15, 0, 0], [0.55, -0.32, 0, 0], [0.9, 0, 0, 0]], false),
    qAnim(LR, [[0, -1.05, 0, 0], [0.55, -0.27, 0, 0], [0.9, 0, 0, 0]], false),
    qAnim(AL, [[0, -0.85, 0, 0.32], [0.9, 0.06, 0, 0]], false),
    qAnim(AR, [[0, -0.85, 0, -0.32], [0.9, 0.06, 0, 0]], false),
    bobAnim(H, PROP.hipY, [[0, -0.3], [0.55, -0.06], [0.9, 0]], false),
  ]))

  // celebrate — fists up hop (1.5s loop)
  clips.push(new THREE.AnimationClip('celebrate', 1.5, [
    qAnim(T, [[0, -0.08, 0, 0], [0.75, 0, 0, 0], [1.5, -0.08, 0, 0]], false),
    qAnim(HD, [[0, -0.18, 0, 0], [1.5, -0.18, 0, 0]], false),
    qAnim(AL, [[0, -2.95, 0, 0.35], [0.75, -2.65, 0, 0.5], [1.5, -2.95, 0, 0.35]], false),
    qAnim(AR, [[0, -2.95, 0, -0.35], [0.75, -2.65, 0, -0.5], [1.5, -2.95, 0, -0.35]], false),
    bobAnim(H, PROP.hipY, [[0, 0], [0.35, 0.15], [0.75, 0], [1.1, 0.15], [1.5, 0]], false),
  ]))

  // throw — windup → release (0.7s once)
  clips.push(new THREE.AnimationClip('throw', 0.7, [
    qAnim(T, [[0, 0, 0, 0], [0.2, 0.2, 0, -0.28], [0.42, 0.3, 0, 0.2], [0.7, 0.06, 0, 0]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.2, 1.05, 0, 0], [0.42, -2.45, 0, 0], [0.7, -1.25, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.42, 0.45, 0, 0], [0.7, 0, 0, 0]], false),
    bobAnim(H, PROP.hipY, [[0, 0], [0.42, 0.035], [0.7, 0]], false),
  ]))

  // heal — drink/embrace pose (1.0s once)
  clips.push(new THREE.AnimationClip('heal', 1.0, [
    qAnim(T, [[0, 0, 0, 0], [0.35, -0.09, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(HD, [[0, 0, 0, 0], [0.35, 0.12, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.3, -1.75, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.3, -1.75, 0, 0], [1.0, 0, 0, 0]], false),
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
        console.log(`OK ${out} — ${(buf.byteLength / 1024).toFixed(1)} KB, ${clips.length} clips`)
        resolve()
      },
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
      { binary: true, animations: clips },
    )
  })
}

const kid = buildKid()
const clips = buildClips()

const t0 = Date.now()
const timer = setInterval(() => {
  if (Date.now() - t0 > 15000) { console.error('TIMEOUT'); process.exit(1) }
}, 100)

exportGlb(kid, clips, 'public/models/votechor-kid.glb')
  .then(() => { clearInterval(timer); console.log('DONE'); process.exit(0) })
  .catch((e) => { console.error('FAIL', e); process.exit(1) })
