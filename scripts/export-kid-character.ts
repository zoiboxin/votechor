/**
 * VoteChor — "VC Kid" GLB character exporter v2 (runs under bun, no DOM).
 *
 * v2 redesign (user feedback: v1 face looked googly/creepy, body lanky):
 *  - chibi Subway-Surfers proportions: BIG head (~2.8 heads tall), short
 *    chunky limbs, oversized sneakers
 *  - flat cartoon eyes: dark outline backing + white lens + LARGE brown iris
 *    + pupil + glint (no more bulging googly sclera)
 *  - proper open smile: dark mouth fill + white upper-teeth strip + smile arc
 *  - cap hugs the skull (rim sized to the head cross-section, slight back
 *    tilt, visible curved brim, V emblem)
 *  - backpack straps run OVER the shoulders (no more suspenders read)
 *  - rounded capsule brows, small ears, chunky fringe tufts under the rim
 *
 * Builds the runner kid from the brand story artwork (public/brand/_gen-story.png):
 * red cap, amber tee, blue jeans, red-and-white sneakers, navy backpack.
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
  hair: 0x241812,
  pack: 0x2c3a55,
  packLight: 0x3a4c6e,
  sole: 0xefece2,
  shoe: 0xcf3230,
  eyeWhite: 0xf7f4ec,
  iris: 0x3d2317,
  pupil: 0x1a100b,
  eyeOutline: 0x2a1a12,
  mouth: 0x4a201a,
  teeth: 0xf7f4ec,
}

// ---------- proportions (kid ~1.40m — chibi runner: big head, short limbs) ----------
const PROP = {
  hipY: 0.52,    // hip pivot height (= legLen: sole bottom lands on y=0)
  torsoH: 0.42,  // hips → neck pivot
  torsoW: 0.3,
  torsoD: 0.19,
  armLen: 0.4,   // short kid arms — hands end just below the hips
  armW: 0.056,
  legLen: 0.52,  // hip pivot → floor
  legW: 0.072,   // chunky kid legs (hipX 0.28*W keeps a gap between them)
  headR: 0.198,  // BIG cartoon head
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
    iris: new THREE.MeshStandardMaterial({ color: C.iris, roughness: 0.25, metalness: 0.0 }),
    eyeOutline: new THREE.MeshStandardMaterial({ color: C.eyeOutline, roughness: 0.4, metalness: 0.0 }),
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
// Helper: z of the head ellipsoid FRONT surface at (x, y) (head-pivot local
// space), so face features sit PROUD of the skin instead of drowning inside.
// Head = sphere r=headR scaled (0.98, 1.02, 0.95), center at y = R*0.85.
const HEAD_CY = 0.85
const HEAD_RX = 0.98
const HEAD_RY = 1.02
const HEAD_RZ = 0.95
function faceZ(y: number, x = 0): number {
  const dx = x / (PROP.headR * HEAD_RX)
  const dy = (y - PROP.headR * HEAD_CY) / (PROP.headR * HEAD_RY)
  const rr = Math.max(0.02, 1 - dx * dx - dy * dy)
  return PROP.headR * HEAD_RZ * Math.sqrt(rr)
}
// horizontal cross-section radius of the head at height y (for cap fit)
function headCrossR(y: number): number {
  const dy = (y - PROP.headR * HEAD_CY) / (PROP.headR * HEAD_RY)
  const rr = Math.max(0.02, 1 - dy * dy)
  return PROP.headR * HEAD_RX * Math.sqrt(rr)
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
  const tee = cyl(0.148, 0.126, 0.33, M.tee, 'TeeBody', 16)
  tee.position.y = 0.205
  torsoPivot.add(tee)
  const shoulders = sph(0.146, M.tee, 'Shoulders', 16)
  shoulders.scale.set(1.0, 0.44, 0.86)
  shoulders.position.y = 0.36
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
  badge.position.set(0.055, 0.29, 0.152)
  torsoPivot.add(badge)

  // === Backpack (navy, on the back) ===
  const pack = box(0.23, 0.27, 0.1, M.pack, 'Backpack')
  pack.position.set(0, 0.21, -0.185)
  torsoPivot.add(pack)
  const packTop = cyl(0.05, 0.05, 0.21, M.packLight, 'PackRoll', 10)
  packTop.rotation.z = Math.PI / 2
  packTop.position.set(0, 0.355, -0.185)
  torsoPivot.add(packTop)
  const zipper = box(0.02, 0.23, 0.012, M.teeDark, 'PackZipper')
  zipper.position.set(0, 0.21, -0.24)
  torsoPivot.add(zipper)
  // straps run over the shoulders and down the chest — reads as a backpack,
  // not suspenders
  for (const s of [-1, 1] as const) {
    const front = box(0.028, 0.15, 0.013, M.packLight, s < 0 ? 'StrapL' : 'StrapR')
    front.position.set(s * 0.074, 0.32, 0.146)
    front.rotation.x = -0.04
    torsoPivot.add(front)
    const over = box(0.028, 0.012, 0.07, M.packLight, s < 0 ? 'StrapOverL' : 'StrapOverR')
    over.position.set(s * 0.079, 0.425, 0.004)
    over.rotation.z = s * -0.28
    torsoPivot.add(over)
  }

  // === Head (pivot at neck) — BIG chibi skull ===
  const headPivot = new THREE.Group()
  headPivot.name = 'Head'
  headPivot.position.y = PROP.torsoH
  torsoPivot.add(headPivot)

  const cy = R * HEAD_CY
  const head = sph(R, M.skin, 'HeadMesh', 22)
  head.position.y = cy
  head.scale.set(HEAD_RX, HEAD_RY, HEAD_RZ)
  headPivot.add(head)

  // chin filler — rounds the jaw so the silhouette stays egg-cute
  const chin = sph(R * 0.3, M.skin, 'Chin', 10)
  chin.position.set(0, cy - R * 0.7, R * 0.28)
  headPivot.add(chin)

  // ears — small, tucked against the skull at eye-line
  for (const s of [-1, 1] as const) {
    const ear = sph(0.03, M.skin, s < 0 ? 'EarL' : 'EarR', 8)
    ear.scale.set(0.5, 1.0, 0.72)
    ear.position.set(s * R * HEAD_RX * 0.96, cy + R * 0.02, 0.005)
    headPivot.add(ear)
  }

  // nose — tiny button, proud of the surface
  const noseY = cy - R * 0.02
  const nose = sph(0.023, M.skin, 'Nose', 8)
  nose.position.set(0, noseY, faceZ(noseY) + 0.002)
  headPivot.add(nose)

  // === eyes — flat cartoon lens style: thin outline stroke + white lens +
  // BIG brown iris + pupil + glint (v1's bulging googly spheres are gone) ===
  const eyeY = cy + R * 0.1
  for (const s of [-1, 1] as const) {
    const side = s < 0 ? 'L' : 'R'
    const ex = s * R * 0.34
    const zSurf = faceZ(eyeY, ex)
    // dark outline backing — reads as a thin cartoon stroke around the eye
    const outline = sph(0.045, M.eyeOutline, `EyeOutline${side}`, 12)
    outline.scale.set(1.06, 1.12, 0.3)
    outline.position.set(ex, eyeY, zSurf - 0.024)
    headPivot.add(outline)
    // white lens
    const sclera = sph(0.042, M.eyeWhite, `Eye${side}`, 14)
    sclera.scale.set(1.0, 1.06, 0.32)
    sclera.position.set(ex, eyeY, zSurf - 0.012)
    headPivot.add(sclera)
    // BIG brown iris — fills most of the lens (Subway-Surfers look)
    const iris = sph(0.031, M.iris, `Iris${side}`, 12)
    iris.scale.set(1.0, 1.0, 0.45)
    iris.position.set(ex, eyeY - 0.002, zSurf + 0.006)
    headPivot.add(iris)
    const pupil = sph(0.0175, M.pupil, `Pupil${side}`, 10)
    pupil.position.set(ex, eyeY - 0.002, zSurf + 0.015)
    headPivot.add(pupil)
    const glint = sph(0.007, M.white, `Glint${side}`, 6)
    glint.position.set(ex - s * 0.01, eyeY + 0.015, zSurf + 0.022)
    headPivot.add(glint)
  }

  // eyebrows — rounded capsule brows, gentle cheerful tilt
  const browY = cy + R * 0.32
  for (const s of [-1, 1] as const) {
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, 0.032, 3, 8), M.hair)
    brow.name = s < 0 ? 'BrowL' : 'BrowR'
    brow.rotation.z = Math.PI / 2 + s * 0.1
    brow.position.set(s * R * 0.35, browY, faceZ(browY, s * R * 0.35) + 0.004)
    headPivot.add(brow)
  }

  // === mouth — compact open smile: small dark mouth + white upper-teeth
  // strip tucked INSIDE (v2's oversized fill read as a shocked gasp) ===
  const mouthY = cy - R * 0.28
  const mouthFill = sph(0.04, M.mouth, 'MouthFill', 14)
  mouthFill.scale.set(1.08, 0.52, 0.32)
  mouthFill.position.set(0, mouthY, faceZ(mouthY) + 0.004)
  headPivot.add(mouthFill)
  const teeth = box(0.048, 0.013, 0.01, M.teeth, 'Teeth')
  teeth.position.set(0, mouthY + 0.014, faceZ(mouthY) + 0.012)
  headPivot.add(teeth)
  // lower-lip hint — thin skin-tone arc cradling the mouth from below
  const lowerLip = sph(0.04, M.skin, 'LowerLip', 10)
  lowerLip.scale.set(1.12, 0.28, 0.32)
  lowerLip.position.set(0, mouthY - 0.022, faceZ(mouthY - 0.022) - 0.002)
  headPivot.add(lowerLip)

  // hair — back volume pushed behind the face plane, chunky fringe under the
  // cap rim, side tufts in front of the ears, nape tufts
  const hairBack = sph(R * 1.0, M.hair, 'HairBack', 18)
  hairBack.scale.set(0.96, 0.9, 0.92)
  hairBack.position.set(0, cy + R * 0.12, -R * 0.16)
  headPivot.add(hairBack)
  const fringeY = cy + R * 0.42
  for (let i = -2; i <= 2; i++) {
    const tuft = sph(0.04, M.hair, `Fringe${i + 2}`, 8)
    tuft.scale.set(1.2, 0.58, 0.7)
    tuft.position.set(i * 0.05, fringeY, faceZ(fringeY) - 0.014)
    tuft.rotation.z = i * 0.2
    headPivot.add(tuft)
  }
  for (const s of [-1, 1] as const) {
    const tuft = sph(0.03, M.hair, s < 0 ? 'SideHairL' : 'SideHairR', 8)
    tuft.scale.set(0.5, 0.85, 1.0)
    tuft.position.set(s * R * 0.9, cy + R * 0.3, R * 0.08)
    headPivot.add(tuft)
    const nape = sph(0.034, M.hair, s < 0 ? 'NapeL' : 'NapeR', 8)
    nape.scale.set(1.0, 0.7, 0.8)
    nape.position.set(s * R * 0.42, cy - R * 0.04, -R * 0.78)
    headPivot.add(nape)
  }

  // === Cap — rim hugs the skull cross-section, slight back tilt, visible
  // curved brim, squat dome + button + white emblem with a red V ===
  const rimY = cy + R * 0.5
  const capGroup = new THREE.Group()
  capGroup.name = 'Cap'
  capGroup.position.y = rimY
  capGroup.rotation.x = -0.07
  headPivot.add(capGroup)
  const rimR = headCrossR(rimY) + 0.009
  const capDome = new THREE.Mesh(new THREE.SphereGeometry(rimR + 0.002, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), M.cap)
  capDome.name = 'CapDome'
  capDome.position.y = 0.004
  capDome.scale.set(1.0, 0.8, 1.02)
  capGroup.add(capDome)
  const capRim = cyl(rimR - 0.003, rimR + 0.002, 0.026, M.capDark, 'CapRim', 20)
  capRim.position.y = 0.0
  capGroup.add(capRim)
  const brim = sph(0.145, M.cap, 'CapBrim', 16)
  brim.scale.set(1.34, 0.11, 1.02)
  brim.rotation.x = 0.16
  brim.position.set(0, -0.014, rimR * 0.85)
  capGroup.add(brim)
  const button = sph(0.015, M.capDark, 'CapButton', 8)
  button.position.y = (rimR + 0.002) * 0.8 + 0.004
  capGroup.add(button)
  const emblem = cyl(0.022, 0.022, 0.008, M.white, 'CapEmblem', 12)
  emblem.rotation.x = Math.PI / 2 - 0.7
  emblem.position.set(0, rimR * 0.34, rimR * 0.9)
  capGroup.add(emblem)
  // tiny red V on the emblem
  for (const s of [-1, 1] as const) {
    const v = box(0.005, 0.017, 0.004, M.cap, s < 0 ? 'EmblemVL' : 'EmblemVR')
    v.rotation.z = s * 0.45
    v.position.set(s * 0.006, rimR * 0.34 + 0.004, rimR * 0.9 + 0.005)
    v.rotateX(Math.PI / 2 - 0.7)
    capGroup.add(v)
  }

  // === Arms (pivot at shoulder; hang down; rotation.x negative = raise forward) ===
  const shoulderY = PROP.torsoH * 0.84
  const shoulderX = PROP.torsoW / 2 + 0.014
  const buildArm = (side: -1 | 1) => {
    const name = side < 0 ? 'ArmL' : 'ArmR'
    const pivot = new THREE.Group()
    pivot.name = name
    pivot.position.set(side * shoulderX, shoulderY, 0)
    torsoPivot.add(pivot)
    // skin upper+fore arm — slight outward splay baked into the MESH so the
    // hands clear the thighs even in the rest pose
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(PROP.armW, PROP.armLen - PROP.armW * 2.4, 4, 10), M.skin)
    arm.position.y = -PROP.armLen / 2 + 0.01
    arm.rotation.z = side * -0.12
    arm.name = name + 'Mesh'
    pivot.add(arm)
    // short sleeve cuff
    const sleeve = cyl(PROP.armW * 1.3, PROP.armW * 1.38, 0.11, M.tee, name + 'Sleeve', 10)
    sleeve.position.y = -0.05
    sleeve.rotation.z = side * -0.09
    pivot.add(sleeve)
    // mitten hand + thumb
    const hand = sph(PROP.armW * 1.32, M.skin, name + 'Hand', 10)
    hand.position.set(side * 0.018, -PROP.armLen + 0.018, 0.008)
    pivot.add(hand)
    const thumb = sph(PROP.armW * 0.5, M.skin, name + 'Thumb', 6)
    thumb.position.set(side * -0.024, -PROP.armLen + 0.058, 0.022)
    pivot.add(thumb)
    return pivot
  }
  buildArm(-1)
  buildArm(1)

  // === Legs (pivot at hip joint; hang down) — chunky jeans + BIG sneakers ===
  const hipX = PROP.torsoW * 0.28
  const buildLeg = (side: -1 | 1) => {
    const name = side < 0 ? 'LegL' : 'LegR'
    const pivot = new THREE.Group()
    pivot.name = name
    pivot.position.set(side * hipX, 0, 0)
    hips.add(pivot)
    // jean leg — slight inward lean at the top so the pelvis bridges cleanly
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(PROP.legW, PROP.legLen - PROP.legW * 2.6 - 0.06, 4, 12), M.denim)
    leg.position.y = -PROP.legLen / 2 + 0.03
    leg.rotation.z = side * 0.04
    leg.name = name + 'Mesh'
    pivot.add(leg)
    // rolled cuff
    const cuff = cyl(PROP.legW * 1.14, PROP.legW * 1.18, 0.05, M.denimLight, name + 'Cuff', 12)
    cuff.position.y = -PROP.legLen + 0.1
    pivot.add(cuff)
    // === sneaker: sole + upper + toecap + laces + heel tab (oversized, SS style) ===
    const sole = box(0.145, 0.036, 0.255, M.sole, name + 'Sole')
    sole.position.set(0, -PROP.legLen + 0.018, 0.05)
    pivot.add(sole)
    const upper = box(0.122, 0.062, 0.205, M.shoe, name + 'Shoe')
    upper.position.set(0, -PROP.legLen + 0.062, 0.045)
    pivot.add(upper)
    const toecap = sph(0.058, M.sole, name + 'ToeCap', 12)
    toecap.scale.set(1.02, 0.6, 1.15)
    toecap.position.set(0, -PROP.legLen + 0.058, 0.125)
    pivot.add(toecap)
    for (let i = 0; i < 3; i++) {
      const lace = box(0.098, 0.009, 0.013, M.sole, name + `Lace${i}`)
      lace.position.set(0, -PROP.legLen + 0.078 + i * 0.024, 0.032 + i * 0.032)
      lace.rotation.x = -0.38
      pivot.add(lace)
    }
    const heel = box(0.065, 0.034, 0.022, M.shoe, name + 'HeelTab')
    heel.position.set(0, -PROP.legLen + 0.09, -0.062)
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
