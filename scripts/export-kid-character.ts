/**
 * VoteChor — "VC Kid" GLB character exporter v3 (runs under bun, no DOM).
 *
 * v3 redesign (user feedback: "face body eyes mouth shoulders make walk like
 * normal — use more physics logics so it looks realistic even if cartoon"):
 *  - TWO-SEGMENT LIMBS: real KneeL/KneeR + ElbowL/ElbowR joints (v1/v2 swung
 *    rigid capsules around one pivot — the "penguin walk"). Node names match
 *    the skinned male rig's joint convention.
 *  - BIOMECHANICAL GAIT: walk/run are generated from a phase-driven gait
 *    model (contact → loading response → mid-stance → terminal → swing) with
 *    knee-flexion curves, arm counterswing, elbow pump, pelvic bob @2× stride
 *    frequency, pelvic roll, torso counter-yaw and head gaze stabilization.
 *  - FACE v3: flat-lens eyes upgraded with upper lash lines, two-tone iris,
 *    double glints, rosy cheek blush discs, compact open smile with tongue
 *    hint (keeps v2's verified surface-placement math faceZ(y,x)).
 *  - BODY v3: deltoid shoulder caps so arms grow from round shoulders, knee
 *    patches on the jeans, backpack water bottle.
 *
 * Builds the runner kid from the brand story artwork (public/brand/_gen-story.png):
 * red cap, amber tee, blue jeans, red-and-white sneakers, navy backpack.
 *
 * Rig contract (game-compatible — the 7 nodes GLBAnimDriver/applyAvatarLook
 * rely on are unchanged; the joints are additive children):
 *
 *   VoteChorKid (root, origin at feet)
 *   └─ Hips
 *      ├─ Torso ── Head(+face+cap) · ArmL→ElbowL · ArmR→ElbowR
 *      ├─ LegL → KneeL
 *      └─ LegR → KneeR
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
const C = {
  cap: 0xd8352c,
  capDark: 0xb02a24,
  tee: 0xf2a541,
  teeDark: 0xd88f2e,
  denim: 0x3e6b9e,
  denimLight: 0x5a83b3,
  skin: 0xb97a52,
  blush: 0xc9855f,
  tongue: 0xb0574e,
  hair: 0x241812,
  pack: 0x2c3a55,
  packLight: 0x3a4c6e,
  sole: 0xefece2,
  shoe: 0xcf3230,
  eyeWhite: 0xf7f4ec,
  iris: 0x3d2317,
  irisCore: 0x5a3a22,
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
  // v3 limb segmentation
  thighLen: 0.27,   // hip → knee pivot
  calfLen: 0.25,    // knee → ankle (0.27 + 0.25 = legLen: soles land on y=0)
  upperLen: 0.22,   // shoulder → elbow pivot
  foreLen: 0.18,    // elbow → wrist (0.22 + 0.18 = armLen)
}
// sanity: segments must sum to the classic lengths so footfall math holds
if (Math.abs(PROP.thighLen + PROP.calfLen - PROP.legLen) > 1e-6) throw new Error('leg segments != legLen')
if (Math.abs(PROP.upperLen + PROP.foreLen - PROP.armLen) > 1e-6) throw new Error('arm segments != armLen')

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
    blush: new THREE.MeshStandardMaterial({ color: C.blush, roughness: 0.65, metalness: 0.0 }),
    tongue: new THREE.MeshStandardMaterial({ color: C.tongue, roughness: 0.45, metalness: 0.0 }),
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
    irisCore: new THREE.MeshStandardMaterial({ color: C.irisCore, roughness: 0.22, metalness: 0.0 }),
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

  // === Hips (root motion node: y-bob + yaw/roll live here) ===
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
  // small protest badge — low-left chest, clear of the backpack straps
  const badge = cyl(0.022, 0.022, 0.008, M.white, 'ChestBadge', 10)
  badge.rotation.x = Math.PI / 2
  badge.position.set(-0.062, 0.24, 0.148)
  torsoPivot.add(badge)

  // === Backpack (navy, on the back) + water bottle ===
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
  const bottle = cyl(0.024, 0.024, 0.075, M.white, 'PackBottle', 10)
  bottle.position.set(0.128, 0.14, -0.185)
  torsoPivot.add(bottle)
  const bottleCap = cyl(0.013, 0.013, 0.02, M.cap, 'PackBottleCap', 8)
  bottleCap.position.set(0.128, 0.186, -0.185)
  torsoPivot.add(bottleCap)
  // straps: slim bands over the shoulder and down the UPPER chest only —
  // full-length front straps read as suspenders (user complaint)
  for (const s of [-1, 1] as const) {
    const front = box(0.024, 0.11, 0.013, M.packLight, s < 0 ? 'StrapL' : 'StrapR')
    front.position.set(s * 0.082, 0.37, 0.144)
    front.rotation.x = -0.04
    torsoPivot.add(front)
    const over = box(0.024, 0.012, 0.07, M.packLight, s < 0 ? 'StrapOverL' : 'StrapOverR')
    over.position.set(s * 0.082, 0.425, 0.004)
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

  // === eyes — flat cartoon lens: outline + white lens + two-tone iris +
  // pupil + double glints + upper lash line (v3) ===
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
    // BIG two-tone brown iris — dark ring + warm core (more depth than v2)
    const iris = sph(0.031, M.iris, `Iris${side}`, 12)
    iris.scale.set(1.0, 1.0, 0.45)
    iris.position.set(ex, eyeY - 0.002, zSurf + 0.006)
    headPivot.add(iris)
    const irisCore = sph(0.024, M.irisCore, `IrisCore${side}`, 10)
    irisCore.scale.set(1.0, 1.0, 0.5)
    irisCore.position.set(ex, eyeY - 0.002, zSurf + 0.011)
    headPivot.add(irisCore)
    const pupil = sph(0.0165, M.pupil, `Pupil${side}`, 10)
    pupil.position.set(ex, eyeY - 0.002, zSurf + 0.017)
    headPivot.add(pupil)
    // main glint (upper-left) + tiny secondary glint (lower-right)
    const glint = sph(0.0085, M.white, `Glint${side}`, 6)
    glint.position.set(ex - s * 0.011, eyeY + 0.016, zSurf + 0.024)
    headPivot.add(glint)
    const glint2 = sph(0.004, M.white, `Glint2${side}`, 6)
    glint2.position.set(ex + s * 0.009, eyeY - 0.012, zSurf + 0.023)
    headPivot.add(glint2)
    // upper lash line — a slim dark capsule crowning the lens, FRIENDLY tilt
    // (v3-r1's inward-down tilt merged with the brows into an angry bar)
    const lash = new THREE.Mesh(new THREE.CapsuleGeometry(0.005, 0.05, 3, 8), M.eyeOutline)
    lash.name = `Lash${side}`
    lash.rotation.z = Math.PI / 2 - s * 0.1
    lash.position.set(ex, eyeY + 0.033, zSurf + 0.004)
    headPivot.add(lash)
  }

  // eyebrows — thin rounded capsules, HIGH above the lashes with a clear gap
  const browY = cy + R * 0.4
  for (const s of [-1, 1] as const) {
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.0082, 0.034, 3, 8), M.hair)
    brow.name = s < 0 ? 'BrowL' : 'BrowR'
    brow.rotation.z = Math.PI / 2 + s * 0.1
    brow.position.set(s * R * 0.35, browY, faceZ(browY, s * R * 0.35) + 0.004)
    headPivot.add(brow)
  }

  // rosy cheek blush discs (v3) — small + flat tint patches, NOT jowls
  const cheekY = cy - R * 0.16
  for (const s of [-1, 1] as const) {
    const cheek = sph(0.017, M.blush, s < 0 ? 'CheekL' : 'CheekR', 10)
    cheek.scale.set(1.2, 0.72, 0.22)
    cheek.position.set(s * R * 0.5, cheekY, faceZ(cheekY, s * R * 0.5) + 0.002)
    headPivot.add(cheek)
  }

  // === mouth — compact open smile: small dark mouth + white upper-teeth
  // strip + tiny tongue hint (v3) ===
  const mouthY = cy - R * 0.28
  const mouthFill = sph(0.04, M.mouth, 'MouthFill', 14)
  mouthFill.scale.set(1.08, 0.52, 0.32)
  mouthFill.position.set(0, mouthY, faceZ(mouthY) + 0.004)
  headPivot.add(mouthFill)
  const teeth = box(0.048, 0.013, 0.01, M.teeth, 'Teeth')
  teeth.position.set(0, mouthY + 0.014, faceZ(mouthY) + 0.012)
  headPivot.add(teeth)
  const tongue = sph(0.017, M.tongue, 'Tongue', 8)
  tongue.scale.set(1.1, 0.55, 0.6)
  tongue.position.set(0, mouthY - 0.012, faceZ(mouthY - 0.012) + 0.007)
  headPivot.add(tongue)
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
  for (let i = -1; i <= 1; i++) {
    const tuft = sph(0.036, M.hair, `Fringe${i + 1}`, 8)
    tuft.scale.set(1.2, 0.58, 0.7)
    tuft.position.set(i * 0.052, fringeY, faceZ(fringeY) - 0.02)
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
  // round white badge on the FRONT BAND (vertical, facing forward) with a red
  // V — v3-r1's tilted disc + floating V strokes read as a sad face
  const emblem = cyl(0.017, 0.017, 0.006, M.white, 'CapEmblem', 14)
  emblem.rotation.x = Math.PI / 2
  emblem.position.set(0, 0.002, rimR - 0.002)
  capGroup.add(emblem)
  for (const s of [-1, 1] as const) {
    const v = box(0.0045, 0.014, 0.004, M.cap, s < 0 ? 'EmblemVL' : 'EmblemVR')
    v.rotation.z = s * 0.42
    v.position.set(s * 0.0048, 0.001, rimR + 0.001)
    capGroup.add(v)
  }

  // === Arms v3 — shoulder pivot → upper arm → ELBOW pivot → forearm+hand.
  // rotation.x negative = raise forward; elbow bends FORWARD (negative x). ===
  const shoulderY = PROP.torsoH * 0.84
  const shoulderX = PROP.torsoW / 2 + 0.014
  const buildArm = (side: -1 | 1) => {
    const name = side < 0 ? 'ArmL' : 'ArmR'
    const pivot = new THREE.Group()
    pivot.name = name
    pivot.position.set(side * shoulderX, shoulderY, 0)
    torsoPivot.add(pivot)
    // deltoid cap (v3) — rounds the shoulder so the arm grows from fabric
    const delt = sph(PROP.armW * 1.42, M.tee, name + 'Deltoid', 10)
    delt.position.y = 0.004
    pivot.add(delt)
    // upper arm — slight outward splay baked into the MESH so the hands
    // clear the thighs even in the rest pose
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(PROP.armW * 0.92, PROP.upperLen - PROP.armW * 2.2, 4, 10), M.skin)
    upper.position.y = -PROP.upperLen / 2 + 0.01
    upper.rotation.z = side * -0.12
    upper.name = name + 'Mesh'
    pivot.add(upper)
    // short sleeve cuff hugging the SHOULDER end (v3-r2: a cuff at the elbow
    // read as a misplaced bracelet)
    const sleeve = cyl(PROP.armW * 1.24, PROP.armW * 1.34, 0.1, M.tee, name + 'Sleeve', 10)
    sleeve.position.y = -0.055
    sleeve.rotation.z = side * -0.09
    pivot.add(sleeve)
    // === elbow pivot ===
    const elbow = new THREE.Group()
    elbow.name = side < 0 ? 'ElbowL' : 'ElbowR'
    elbow.position.y = -PROP.upperLen
    pivot.add(elbow)
    // forearm
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(PROP.armW * 0.84, PROP.foreLen - PROP.armW * 2.0, 4, 10), M.skin)
    fore.position.y = -PROP.foreLen / 2 + 0.012
    fore.rotation.z = side * -0.04
    fore.name = name + 'ForeMesh'
    elbow.add(fore)
    // mitten hand + thumb (v3-r2: 1.3× read as giant balls — 1.15× fits)
    const hand = sph(PROP.armW * 1.15, M.skin, name + 'Hand', 10)
    hand.position.set(side * 0.014, -PROP.foreLen + 0.018, 0.008)
    elbow.add(hand)
    const thumb = sph(PROP.armW * 0.44, M.skin, name + 'Thumb', 6)
    thumb.position.set(side * -0.02, -PROP.foreLen + 0.05, 0.02)
    elbow.add(thumb)
    return pivot
  }
  buildArm(-1)
  buildArm(1)

  // === Legs v3 — hip pivot → thigh → KNEE pivot → calf + BIG sneaker.
  // rotation.x negative = leg forward; knee bends BACKWARD (positive x). ===
  const hipX = PROP.torsoW * 0.28
  const buildLeg = (side: -1 | 1) => {
    const name = side < 0 ? 'LegL' : 'LegR'
    const pivot = new THREE.Group()
    pivot.name = name
    pivot.position.set(side * hipX, 0, 0)
    hips.add(pivot)
    // thigh — slight inward lean at the top so the pelvis bridges cleanly.
    // Capsule TOTAL height (len + 2r) must reach the knee pivot — v3-r1 had a
    // visible gap with the knee patch floating in it.
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(PROP.legW * 1.02, PROP.thighLen - PROP.legW * 2.04, 4, 12), M.denim)
    thigh.position.y = -PROP.thighLen / 2
    thigh.rotation.z = side * 0.04
    thigh.name = name + 'Mesh'
    pivot.add(thigh)
    // === knee pivot ===
    const knee = new THREE.Group()
    knee.name = side < 0 ? 'KneeL' : 'KneeR'
    knee.position.y = -PROP.thighLen
    pivot.add(knee)
    // knee patch (v3) — lighter denim disc on the knee front, ON the joint
    const patch = sph(0.03, M.denimLight, name + 'KneePatch', 10)
    patch.scale.set(1.1, 1.1, 0.35)
    patch.position.set(0, 0, PROP.legW * 0.86)
    knee.add(patch)
    // calf — capsule total height reaches the sneaker
    const calf = new THREE.Mesh(new THREE.CapsuleGeometry(PROP.legW * 0.94, PROP.calfLen - PROP.legW * 1.88, 4, 12), M.denim)
    calf.position.y = -PROP.calfLen / 2 + 0.002
    calf.rotation.z = side * 0.02
    calf.name = name + 'CalfMesh'
    knee.add(calf)
    // rolled cuff
    const cuff = cyl(PROP.legW * 1.1, PROP.legW * 1.16, 0.05, M.denimLight, name + 'Cuff', 12)
    cuff.position.y = -PROP.calfLen + 0.1
    knee.add(cuff)
    // === sneaker: sole + upper + toecap + laces + heel tab (oversized, SS style)
    // all rigid on the knee pivot: y offsets shift by −thighLen vs v2 ===
    const sole = box(0.145, 0.036, 0.255, M.sole, name + 'Sole')
    sole.position.set(0, -PROP.calfLen + 0.018, 0.05)
    knee.add(sole)
    const upper = box(0.122, 0.062, 0.205, M.shoe, name + 'Shoe')
    upper.position.set(0, -PROP.calfLen + 0.062, 0.045)
    knee.add(upper)
    const toecap = sph(0.058, M.sole, name + 'ToeCap', 12)
    toecap.scale.set(1.02, 0.6, 1.15)
    toecap.position.set(0, -PROP.calfLen + 0.058, 0.125)
    knee.add(toecap)
    for (let i = 0; i < 3; i++) {
      const lace = box(0.098, 0.009, 0.013, M.sole, name + `Lace${i}`)
      lace.position.set(0, -PROP.calfLen + 0.078 + i * 0.024, 0.032 + i * 0.032)
      lace.rotation.x = -0.38
      knee.add(lace)
    }
    const heel = box(0.065, 0.034, 0.022, M.shoe, name + 'HeelTab')
    heel.position.set(0, -PROP.calfLen + 0.09, -0.062)
    knee.add(heel)
    return pivot
  }
  buildLeg(-1)
  buildLeg(1)

  root.traverse((o) => { o.castShadow = false; o.receiveShadow = false })
  return root
}

// =====================================================================
// BIOMECHANICAL GAIT GENERATOR (v3) — physics-flavored walk/run cycles.
//
// One gait cycle p∈[0,1) per leg, contact at p=0:
//   p 0.00–0.10  loading response  — knee absorption bump, hip drops
//   p 0.10–0.50  stance            — leg travels back, knee near-straight,
//                                    pelvis crests UP over the stance leg
//   p 0.50–1.00  swing             — knee flexes hard (peak ≈0.75), foot
//                                    clears, hip swings forward, pelvis dips
//
// Sign conventions (verified against the game engine): a limb hanging down
// −Y rotated about +X moves its end BACKWARD (−Z). So:
//   leg forward  = NEGATIVE rotation.x   ·  knee flexion = POSITIVE x
//   arm forward  = NEGATIVE rotation.x   ·  elbow flexion = NEGATIVE x
// Arms counter-swing against the SAME-side leg; torso counter-yaws against
// the pelvis; the head stabilizes (counter-yaw + counter-pitch) so the gaze
// stays level — the details that make a walk read as "normal".
// =====================================================================
interface GaitSpec {
  duration: number    // full cycle seconds (both steps)
  stride: number      // hip swing amplitude (rad)
  kneeSwing: number   // swing-phase knee flexion amplitude (rad)
  kneeBase: number    // resting knee flexion (kid crouch)
  armSwing: number    // arm swing amplitude (rad)
  elbowBase: number   // resting elbow flexion (rad)
  elbowSwing: number  // extra elbow pump at max forward reach (rad)
  bob: number         // pelvic vertical bob amplitude (m)
  lean: number        // torso forward pitch (rad)
  yaw: number         // torso counter-yaw amplitude (rad)
}

/** knee angle for one leg, given that leg's own phase (contact=0). */
function kneeAngle(p: number, s: GaitSpec): number {
  const swing = Math.max(0, Math.sin(Math.PI * ((p - 0.5) / 0.5))) ** 1.25 // 0→1→0 over swing
  const load = 0.3 * Math.exp(-(((p - 0.12) / 0.09) ** 2)) // loading-response bump
  return s.kneeBase + s.kneeSwing * swing + s.kneeSwing * 0.3 * load
}

function gaitClip(name: string, s: GaitSpec): THREE.AnimationClip {
  const N = 16 // samples/cycle — smooth under GLTF linear interpolation
  const H = 'Hips', T = 'Torso', HD = 'Head'
  const legL: [number, number, number, number][] = []
  const legR: [number, number, number, number][] = []
  const kneeL: [number, number, number, number][] = []
  const kneeR: [number, number, number, number][] = []
  const armL: [number, number, number, number][] = []
  const armR: [number, number, number, number][] = []
  const elbL: [number, number, number, number][] = []
  const elbR: [number, number, number, number][] = []
  const torso: [number, number, number, number][] = []
  const head: [number, number, number, number][] = []
  const hipsRot: [number, number, number, number][] = []
  const bob: [number, number][] = []
  for (let i = 0; i < N; i++) {
    const t = (i / N) * s.duration
    const p = i / N
    const w = 2 * Math.PI * p
    const c = Math.cos(w)
    const sn = Math.sin(w)
    // legs (LegR's cycle leads by half a cycle)
    legL.push([t, -s.stride * c, 0, 0])
    legR.push([t, s.stride * c, 0, 0])
    kneeL.push([t, kneeAngle(p, s), 0, 0])
    kneeR.push([t, kneeAngle((p + 0.5) % 1, s), 0, 0])
    // arms counter-swing + elbow pump + slight scissor z
    armL.push([t, s.armSwing * c, 0, 0.05 + 0.025 * sn])
    armR.push([t, -s.armSwing * c, 0, -0.05 + 0.025 * sn])
    elbL.push([t, -(s.elbowBase + s.elbowSwing * Math.max(0, -c) ** 1.4), 0, 0])
    elbR.push([t, -(s.elbowBase + s.elbowSwing * Math.max(0, c) ** 1.4), 0, 0])
    // torso: lean + counter-yaw + subtle breathing osc
    torso.push([t, s.lean + 0.02 * Math.sin(2 * w), s.yaw * sn, 0])
    // head: gaze stabilization — counters ~half the yaw + ~half the pitch
    head.push([t, -0.45 * s.lean + 0.018 * Math.sin(2 * w + 0.5), -0.65 * s.yaw * sn, 0])
    // pelvis: yaw counter + roll waddle
    hipsRot.push([t, 0, -0.5 * s.yaw * sn, 0.03 * c])
    // pelvic bob @2× stride: lowest at contacts (p=0/0.5), crest at passing
    bob.push([t, s.bob * (0.5 - 0.5 * Math.cos(2 * w)) - 0.004])
  }
  return new THREE.AnimationClip(name, s.duration, [
    qAnim(T, torso, true), qAnim(HD, head, true), qAnim(H, hipsRot, true),
    qAnim('LegL', legL, true), qAnim('LegR', legR, true),
    qAnim('KneeL', kneeL, true), qAnim('KneeR', kneeR, true),
    qAnim('ArmL', armL, true), qAnim('ArmR', armR, true),
    qAnim('ElbowL', elbL, true), qAnim('ElbowR', elbR, true),
    bobAnim(H, PROP.hipY, bob, true),
  ])
}

// ---------- animation clips (kid energy: quicker cadence, extra bounce) ----------
function buildClips(): THREE.AnimationClip[] {
  const H = 'Hips', T = 'Torso', HD = 'Head', AL = 'ArmL', AR = 'ArmR', LL = 'LegL', LR = 'LegR'
  const KL = 'KneeL', KR = 'KneeR', EL = 'ElbowL', ER = 'ElbowR'
  const clips: THREE.AnimationClip[] = []

  // walk — REAL bipedal gait (0.8s loop)
  clips.push(gaitClip('walk', {
    duration: 0.8, stride: 0.5, kneeSwing: 0.78, kneeBase: 0.12,
    armSwing: 0.42, elbowBase: 0.28, elbowSwing: 0.4,
    bob: 0.028, lean: 0.05, yaw: 0.08,
  }))

  // run — long fast stride, flight-y bob, pumping elbows (0.5s loop)
  clips.push(gaitClip('run', {
    duration: 0.5, stride: 0.88, kneeSwing: 1.35, kneeBase: 0.22,
    armSwing: 1.15, elbowBase: 0.85, elbowSwing: 0.75,
    bob: 0.062, lean: 0.24, yaw: 0.14,
  }))

  // idle — bouncy breathing, weight shift, relaxed elbows (4s loop)
  clips.push(new THREE.AnimationClip('idle', 4, [
    qAnim(T, [[0, 0.03, 0, 0], [2, 0.06, 0.03, 0], [4, 0.03, 0, 0]], false),
    qAnim(HD, [[0, 0, 0, 0], [1.3, 0.05, 0.1, 0], [2.6, -0.03, -0.09, 0], [4, 0, 0, 0]], false),
    qAnim(AL, [[0, 0.08, 0, 0.05], [2, 0.14, 0, 0.09], [4, 0.08, 0, 0.05]], false),
    qAnim(AR, [[0, 0.08, 0, -0.05], [2, 0.14, 0, -0.09], [4, 0.08, 0, -0.05]], false),
    qAnim(EL, [[0, -0.16, 0, 0], [2, -0.22, 0, 0], [4, -0.16, 0, 0]], false),
    qAnim(ER, [[0, -0.16, 0, 0], [2, -0.22, 0, 0], [4, -0.16, 0, 0]], false),
    qAnim(KL, [[0, 0.1, 0, 0], [4, 0.1, 0, 0]], false),
    qAnim(KR, [[0, 0.1, 0, 0], [4, 0.1, 0, 0]], false),
    bobAnim(H, PROP.hipY, [[0, 0], [1, 0.016], [2, 0], [3, 0.016], [4, 0]], false),
  ]))

  // jump — crouch (deep knees) → launch → apex tuck (0.85s once)
  clips.push(new THREE.AnimationClip('jump', 0.85, [
    qAnim(T, [[0, 0, 0, 0], [0.18, 0.32, 0, 0], [0.4, 0.06, 0, 0], [0.85, 0.12, 0, 0]], false),
    qAnim(KL, [[0, 0.12, 0, 0], [0.18, 1.5, 0, 0], [0.4, 0.5, 0, 0], [0.85, 0.9, 0, 0]], false),
    qAnim(KR, [[0, 0.12, 0, 0], [0.18, 1.2, 0, 0], [0.4, 0.75, 0, 0], [0.85, 0.85, 0, 0]], false),
    qAnim(LL, [[0, 0, 0, 0], [0.18, -0.85, 0, 0], [0.4, -0.5, 0, 0], [0.85, -0.55, 0, 0]], false),
    qAnim(LR, [[0, 0, 0, 0], [0.18, -0.55, 0, 0], [0.4, 0.35, 0, 0], [0.85, 0.3, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.18, 0.55, 0, 0], [0.5, -2.7, 0, 0], [0.85, -2.7, 0, 0]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.18, 0.55, 0, 0], [0.5, -2.7, 0, 0], [0.85, -2.7, 0, 0]], false),
    qAnim(EL, [[0, -0.16, 0, 0], [0.18, -0.5, 0, 0], [0.5, -0.12, 0, 0], [0.85, -0.12, 0, 0]], false),
    qAnim(ER, [[0, -0.16, 0, 0], [0.18, -0.5, 0, 0], [0.5, -0.12, 0, 0], [0.85, -0.12, 0, 0]], false),
    bobAnim(H, PROP.hipY, [[0, 0], [0.18, -0.17], [0.4, 0.06], [0.85, 0.06]], false),
  ]))

  // fall — airborne flail with pumping knees (1.2s loop)
  clips.push(new THREE.AnimationClip('fall', 1.2, [
    qAnim(T, [[0, -0.14, 0, 0], [0.6, -0.2, 0, 0.07], [1.2, -0.14, 0, 0]], false),
    qAnim(HD, [[0, -0.28, 0, 0], [1.2, -0.28, 0, 0]], false),
    qAnim(AL, [[0, -2.35, 0, 0.35], [0.3, -2.75, 0, 0.55], [0.6, -2.35, 0, 0.35], [0.9, -2.75, 0, 0.55], [1.2, -2.35, 0, 0.35]], false),
    qAnim(AR, [[0, -2.35, 0, -0.35], [0.3, -2.75, 0, -0.55], [0.6, -2.35, 0, -0.35], [0.9, -2.75, 0, -0.55], [1.2, -2.35, 0, -0.35]], false),
    qAnim(EL, [[0, -0.9, 0, 0], [0.6, -1.15, 0, 0], [1.2, -0.9, 0, 0]], false),
    qAnim(ER, [[0, -0.9, 0, 0], [0.6, -1.15, 0, 0], [1.2, -0.9, 0, 0]], false),
    qAnim(LL, [[0, -0.4, 0, 0], [0.6, -0.12, 0, 0], [1.2, -0.4, 0, 0]], false),
    qAnim(LR, [[0, 0.3, 0, 0], [0.6, 0.08, 0, 0], [1.2, 0.3, 0, 0]], false),
    qAnim(KL, [[0, 1.1, 0, 0], [0.6, 0.55, 0, 0], [1.2, 1.1, 0, 0]], false),
    qAnim(KR, [[0, 0.75, 0, 0], [0.6, 0.35, 0, 0], [1.2, 0.75, 0, 0]], false),
  ]))

  // land — deep absorb (knees fold) → rise (0.5s once)
  clips.push(new THREE.AnimationClip('land', 0.5, [
    qAnim(T, [[0, 0.45, 0, 0], [0.5, 0.05, 0, 0]], false),
    qAnim(KL, [[0, 1.7, 0, 0], [0.5, 0.12, 0, 0]], false),
    qAnim(KR, [[0, 1.6, 0, 0], [0.5, 0.12, 0, 0]], false),
    qAnim(LL, [[0, -1.05, 0, 0], [0.5, -0.05, 0, 0]], false),
    qAnim(LR, [[0, -0.95, 0, 0], [0.5, -0.05, 0, 0]], false),
    qAnim(AL, [[0, -1.35, 0, 0.45], [0.5, 0.05, 0, 0]], false),
    qAnim(AR, [[0, -1.35, 0, -0.45], [0.5, 0.05, 0, 0]], false),
    qAnim(EL, [[0, -0.55, 0, 0], [0.5, -0.14, 0, 0]], false),
    qAnim(ER, [[0, -0.55, 0, 0], [0.5, -0.14, 0, 0]], false),
    bobAnim(H, PROP.hipY, [[0, -0.26], [0.5, 0]], false),
  ]))

  // slide — ground slide pose, front leg extended, rear tucked (0.8s loop)
  clips.push(new THREE.AnimationClip('slide', 0.8, [
    qAnim(T, [[0, -1.15, 0, 0], [0.4, -1.1, 0, 0.05], [0.8, -1.15, 0, 0]], false),
    qAnim(HD, [[0, 0.45, 0, 0], [0.8, 0.45, 0, 0]], false),
    qAnim(LL, [[0, 0.45, 0, 0], [0.8, 0.45, 0, 0]], false),
    qAnim(KL, [[0, 0.18, 0, 0], [0.8, 0.18, 0, 0]], false),
    qAnim(LR, [[0, -0.18, 0, 0], [0.8, -0.18, 0, 0]], false),
    qAnim(KR, [[0, 0.95, 0, 0], [0.8, 0.95, 0, 0]], false),
    qAnim(AL, [[0, -2.95, 0, 0.25], [0.8, -2.95, 0, 0.25]], false),
    qAnim(EL, [[0, -0.35, 0, 0], [0.8, -0.35, 0, 0]], false),
    qAnim(AR, [[0, -2.75, 0, -0.25], [0.8, -2.75, 0, -0.25]], false),
    qAnim(ER, [[0, -0.4, 0, 0], [0.8, -0.4, 0, 0]], false),
    bobAnim(H, PROP.hipY * 0.62, [[0, 0], [0.8, 0]], false),
  ]))

  // hit — stagger, arms up defensively, knees buckle (0.6s once)
  clips.push(new THREE.AnimationClip('hit', 0.6, [
    qAnim(T, [[0, 0, 0, 0], [0.15, -0.6, 0, 0.12], [0.6, -0.32, 0, 0]], false),
    qAnim(HD, [[0, 0, 0, 0], [0.2, -0.35, 0.22, 0], [0.45, -0.18, -0.16, 0], [0.6, -0.22, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.2, -1.45, 0, 0.75], [0.6, -0.65, 0, 0.42]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.2, -1.45, 0, -0.75], [0.6, -0.65, 0, -0.42]], false),
    qAnim(EL, [[0, -0.16, 0, 0], [0.2, -1.1, 0, 0], [0.6, -0.6, 0, 0]], false),
    qAnim(ER, [[0, -0.16, 0, 0], [0.2, -1.1, 0, 0], [0.6, -0.6, 0, 0]], false),
    qAnim(LL, [[0, 0, 0, 0], [0.2, 0.38, 0, 0], [0.6, 0.22, 0, 0]], false),
    qAnim(LR, [[0, 0, 0, 0], [0.2, -0.32, 0, 0], [0.6, -0.16, 0, 0]], false),
    qAnim(KL, [[0, 0.12, 0, 0], [0.2, 0.9, 0, 0], [0.6, 0.55, 0, 0]], false),
    qAnim(KR, [[0, 0.12, 0, 0], [0.2, 0.7, 0, 0], [0.6, 0.45, 0, 0]], false),
    bobAnim(H, PROP.hipY, [[0, 0], [0.2, -0.1], [0.6, -0.02]], false),
  ]))

  // detained — hands behind back, head bowed (2.2s loop)
  clips.push(new THREE.AnimationClip('detained', 2.2, [
    qAnim(T, [[0, 0.14, 0, 0], [1.1, 0.16, 0, 0], [2.2, 0.14, 0, 0]], false),
    qAnim(HD, [[0, 0.38, 0, 0], [0.7, 0.46, 0.09, 0], [1.6, 0.42, -0.09, 0], [2.2, 0.38, 0, 0]], false),
    qAnim(AL, [[0, 0.6, 0, 0.55], [2.2, 0.6, 0, 0.55]], false),
    qAnim(AR, [[0, 0.6, 0, -0.55], [2.2, 0.6, 0, -0.55]], false),
    qAnim(EL, [[0, -0.25, 0, 0], [2.2, -0.25, 0, 0]], false),
    qAnim(ER, [[0, -0.25, 0, 0], [2.2, -0.25, 0, 0]], false),
    qAnim(KL, [[0, 0.18, 0, 0], [2.2, 0.18, 0, 0]], false),
    qAnim(KR, [[0, 0.14, 0, 0], [2.2, 0.14, 0, 0]], false),
    qAnim(LL, [[0, 0.06, 0, 0], [2.2, 0.06, 0, 0]], false),
    qAnim(LR, [[0, -0.06, 0, 0], [2.2, -0.06, 0, 0]], false),
  ]))

  // recover — get up from crouch (0.9s once)
  clips.push(new THREE.AnimationClip('recover', 0.9, [
    qAnim(T, [[0, 0.52, 0, 0], [0.55, 0.14, 0, 0], [0.9, 0.04, 0, 0]], false),
    qAnim(KL, [[0, 1.85, 0, 0], [0.55, 0.5, 0, 0], [0.9, 0.12, 0, 0]], false),
    qAnim(KR, [[0, 1.75, 0, 0], [0.55, 0.46, 0, 0], [0.9, 0.12, 0, 0]], false),
    qAnim(LL, [[0, -1.15, 0, 0], [0.55, -0.32, 0, 0], [0.9, 0, 0, 0]], false),
    qAnim(LR, [[0, -1.05, 0, 0], [0.55, -0.27, 0, 0], [0.9, 0, 0, 0]], false),
    qAnim(AL, [[0, -0.85, 0, 0.32], [0.9, 0.06, 0, 0]], false),
    qAnim(AR, [[0, -0.85, 0, -0.32], [0.9, 0.06, 0, 0]], false),
    qAnim(EL, [[0, -0.5, 0, 0], [0.9, -0.16, 0, 0]], false),
    qAnim(ER, [[0, -0.5, 0, 0], [0.9, -0.16, 0, 0]], false),
    bobAnim(H, PROP.hipY, [[0, -0.3], [0.55, -0.06], [0.9, 0]], false),
  ]))

  // celebrate — fists up hop with knee pumps (1.5s loop)
  clips.push(new THREE.AnimationClip('celebrate', 1.5, [
    qAnim(T, [[0, -0.08, 0, 0], [0.75, 0, 0, 0], [1.5, -0.08, 0, 0]], false),
    qAnim(HD, [[0, -0.18, 0, 0], [1.5, -0.18, 0, 0]], false),
    qAnim(AL, [[0, -2.95, 0, 0.35], [0.75, -2.65, 0, 0.5], [1.5, -2.95, 0, 0.35]], false),
    qAnim(AR, [[0, -2.95, 0, -0.35], [0.75, -2.65, 0, -0.5], [1.5, -2.95, 0, -0.35]], false),
    qAnim(EL, [[0, -0.2, 0, 0], [0.75, -0.42, 0, 0], [1.5, -0.2, 0, 0]], false),
    qAnim(ER, [[0, -0.2, 0, 0], [0.75, -0.42, 0, 0], [1.5, -0.2, 0, 0]], false),
    qAnim(KL, [[0, 0.14, 0, 0], [0.3, 0.85, 0, 0], [0.75, 0.1, 0, 0], [1.05, 0.85, 0, 0], [1.5, 0.14, 0, 0]], false),
    qAnim(KR, [[0, 0.14, 0, 0], [0.3, 0.85, 0, 0], [0.75, 0.1, 0, 0], [1.05, 0.85, 0, 0], [1.5, 0.14, 0, 0]], false),
    bobAnim(H, PROP.hipY, [[0, 0], [0.35, 0.15], [0.75, 0], [1.1, 0.15], [1.5, 0]], false),
  ]))

  // throw — elbow-cocked windup → whip release (0.7s once)
  clips.push(new THREE.AnimationClip('throw', 0.7, [
    qAnim(T, [[0, 0, 0, 0], [0.2, 0.2, 0, -0.28], [0.42, 0.3, 0, 0.2], [0.7, 0.06, 0, 0]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.2, 1.05, 0, 0], [0.42, -2.45, 0, 0], [0.7, -1.25, 0, 0]], false),
    qAnim(ER, [[0, -0.16, 0, 0], [0.2, -1.9, 0, 0], [0.42, -0.2, 0, 0], [0.7, -0.3, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.42, 0.45, 0, 0], [0.7, 0, 0, 0]], false),
    qAnim(EL, [[0, -0.16, 0, 0], [0.42, -0.45, 0, 0], [0.7, -0.16, 0, 0]], false),
    qAnim(KL, [[0, 0.12, 0, 0], [0.2, 0.4, 0, 0], [0.42, 0.3, 0, 0], [0.7, 0.14, 0, 0]], false),
    qAnim(KR, [[0, 0.12, 0, 0], [0.2, 0.35, 0, 0], [0.42, 0.55, 0, 0], [0.7, 0.18, 0, 0]], false),
    bobAnim(H, PROP.hipY, [[0, 0], [0.42, 0.035], [0.7, 0]], false),
  ]))

  // heal — drink: both elbows fold up to the face (1.0s once)
  clips.push(new THREE.AnimationClip('heal', 1.0, [
    qAnim(T, [[0, 0, 0, 0], [0.35, -0.09, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(HD, [[0, 0, 0, 0], [0.35, 0.12, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.3, -1.75, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.3, -1.75, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(EL, [[0, -0.16, 0, 0], [0.3, -1.05, 0, 0], [1.0, -0.16, 0, 0]], false),
    qAnim(ER, [[0, -0.16, 0, 0], [0.3, -1.05, 0, 0], [1.0, -0.16, 0, 0]], false),
    qAnim(KL, [[0, 0.12, 0, 0], [1.0, 0.12, 0, 0]], false),
    qAnim(KR, [[0, 0.12, 0, 0], [1.0, 0.12, 0, 0]], false),
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
