/**
 * VoteChor — PROFESSIONAL SKINNED HUMAN CHARACTER SYSTEM exporter (bun, no DOM).
 *
 * The master-prompt pipeline, implemented end to end:
 *   body mesh → skeleton → skin weights → clothing (+ weights) → body
 *   animations → facial rig → secondary-physics hooks → GLB export.
 *
 * One compatible humanoid framework, three age/gender variants sharing the SAME
 * skeleton + clip set (animations reuse across variants):
 *   male   ~1.96 m — matches the skinned hero's landmark measurements so the
 *                    wardrobe attachment pipeline (hair/hat/held/gear) fits as-is
 *   female ~1.72 m — matches the female puppet landmarks (Head y1.40, hands 0.76)
 *   child  ~1.26 m — AGE-APPROPRIATE proportions (big head 1:5.5, short limbs,
 *                    chunky torso) — NOT a scaled-down adult
 *
 * Skeleton (20 bones, engine contract names preserved):
 *   Hips → Torso → Chest → { ClavicleL → ArmL → ElbowL → HandL ,
 *                            ClavicleR → ArmR → ElbowR → HandR ,
 *                            Neck → Head (+facial nodes) }
 *        → { LegL → KneeL → FootL , LegR → KneeR → FootR }
 *   (Toe joints intentionally omitted — rigid feet with ankle foot-roll;
 *    documented as a remaining manual-rigging item.)
 *
 * Skinning: continuous lofted body meshes bound to the skeleton with smooth
 * distance-to-segment weights (max 4 influences, normalized). Limb lofts span
 * the joints (elbow/knee INSIDE one mesh) so weights blend across the joint —
 * no candy-wrapper snapping. Rigid parts (skull, hands, feet, pelvis, features)
 * are parented directly to their bones (they follow animation without skinning).
 *
 * Facial rig (node-based, no mixer channels — driven at runtime by
 * src/game/facial-rig.ts): LidTopL/R (blink shells), BrowL/R, Jaw (mouth open),
 * PupilL/R (gaze darts), Chest (breathing posture). All children of bones.
 *
 * Secondary-physics hooks: 'Ponytail' node (female) for the runtime spring.
 *
 * 14 clips (13 engine contract names + doubleJump via the driver's fallback
 * chain): idle walk run jump doubleJump fall land slide hit detained recover
 * celebrate throw heal. Gait clips are generated from a phase-driven
 * biomechanical model with foot-roll (heel strike → toe-off).
 *
 * Output: public/models/votechor-human-{male,female,child}.glb
 */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { writeFileSync } from 'node:fs'

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

// ============================================================================
// 1. VARIANT PROPORTIONS
// ============================================================================
type Gender = 'male' | 'female' | 'child'

interface Prop {
  hipY: number
  thighLen: number   // hip joint → knee joint
  calfLen: number    // knee → ankle
  footH: number      // ankle → sole
  torsoTop: number   // hips → neck base (world delta)
  spineY: number     // Torso bone above Hips
  chestY: number     // Chest bone above Hips
  shoulderY: number  // world y of shoulder joint
  shoulderX: number
  hipX: number
  upperLen: number   // shoulder → elbow
  foreLen: number    // elbow → wrist
  handLen: number
  headR: number
  headCY: number     // skull center above Head bone
  neckLen: number    // neck base → Head bone
  // torso cross sections (y from hips, rx, rz, optional front bust bulge)
  rings: { y: number; rx: number; rz: number; bust?: number }[]
  pelvis: { rx: number; rz: number; h: number }
  // arm radii
  armR1: number      // upper arm
  armR2: number      // forearm at elbow
  armR3: number      // wrist
  legR1: number      // thigh
  legR2: number      // calf at knee
  legR3: number      // ankle
}

const MALE: Prop = {
  hipY: 0.98, thighLen: 0.46, calfLen: 0.42, footH: 0.10,
  torsoTop: 0.54, spineY: 0.10, chestY: 0.28,
  shoulderY: 1.547, shoulderX: 0.195, hipX: 0.092,
  upperLen: 0.307, foreLen: 0.25, handLen: 0.11,
  headR: 0.105, headCY: 0.235, neckLen: 0.06,
  rings: [
    { y: 0.00, rx: 0.150, rz: 0.102 },
    { y: 0.06, rx: 0.156, rz: 0.108 },
    { y: 0.14, rx: 0.146, rz: 0.104 },
    { y: 0.22, rx: 0.128, rz: 0.094 },
    { y: 0.32, rx: 0.146, rz: 0.106 },
    { y: 0.40, rx: 0.163, rz: 0.114 },
    { y: 0.47, rx: 0.178, rz: 0.116 },
    { y: 0.505, rx: 0.165, rz: 0.102 },
    { y: 0.53, rx: 0.098, rz: 0.072 },
  ],
  pelvis: { rx: 0.158, rz: 0.112, h: 0.13 },
  armR1: 0.050, armR2: 0.043, armR3: 0.030,
  legR1: 0.078, legR2: 0.060, legR3: 0.038,
}

const FEMALE: Prop = {
  hipY: 0.92, thighLen: 0.44, calfLen: 0.40, footH: 0.08,
  torsoTop: 0.48, spineY: 0.09, chestY: 0.25,
  shoulderY: 1.36, shoulderX: 0.175, hipX: 0.084,
  upperLen: 0.27, foreLen: 0.23, handLen: 0.095,
  headR: 0.098, headCY: 0.215, neckLen: 0.05,
  rings: [
    { y: 0.00, rx: 0.148, rz: 0.100 },
    { y: 0.06, rx: 0.152, rz: 0.104 },
    { y: 0.14, rx: 0.128, rz: 0.090 },
    { y: 0.20, rx: 0.112, rz: 0.082 },
    { y: 0.28, rx: 0.142, rz: 0.104, bust: 0.16 },
    { y: 0.34, rx: 0.138, rz: 0.100, bust: 0.07 },
    { y: 0.41, rx: 0.128, rz: 0.086 },
    { y: 0.438, rx: 0.116, rz: 0.078 },
    { y: 0.46, rx: 0.072, rz: 0.054 },
  ],
  pelvis: { rx: 0.155, rz: 0.108, h: 0.12 },
  armR1: 0.041, armR2: 0.035, armR3: 0.025,
  legR1: 0.070, legR2: 0.054, legR3: 0.033,
}

const CHILD: Prop = {
  hipY: 0.55, thighLen: 0.28, calfLen: 0.22, footH: 0.05,
  torsoTop: 0.33, spineY: 0.08, chestY: 0.19,
  shoulderY: 0.85, shoulderX: 0.135, hipX: 0.072,
  upperLen: 0.17, foreLen: 0.15, handLen: 0.07,
  headR: 0.112, headCY: 0.13, neckLen: 0.05,
  rings: [
    { y: 0.00, rx: 0.128, rz: 0.092 },
    { y: 0.06, rx: 0.136, rz: 0.098 },
    { y: 0.13, rx: 0.142, rz: 0.100 },
    { y: 0.20, rx: 0.136, rz: 0.096 },
    { y: 0.27, rx: 0.134, rz: 0.094 },
    { y: 0.30, rx: 0.122, rz: 0.086 },
    { y: 0.32, rx: 0.072, rz: 0.056 },
  ],
  pelvis: { rx: 0.134, rz: 0.098, h: 0.10 },
  armR1: 0.040, armR2: 0.035, armR3: 0.026,
  legR1: 0.058, legR2: 0.048, legR3: 0.033,
}

// ============================================================================
// 2. PALETTES (baked defaults — the wardrobe tint pipeline recolors by name)
// ============================================================================
interface Pal { skin: number; shirt: number; pants: number; accent: number; hair: number; shoe: number; sole: number; sock: number }
const PALETTES: Record<Gender, Pal> = {
  male: { skin: 0xc98d5f, shirt: 0xc4593a, pants: 0x3d4f43, accent: 0xf2c14e, hair: 0x241d16, shoe: 0x4a3a2c, sole: 0x2a241d, sock: 0xd8d2c2 },
  female: { skin: 0xd49a6c, shirt: 0xb34a78, pants: 0x4a3d55, accent: 0xf2c14e, hair: 0x1c1611, shoe: 0x8c3a4e, sole: 0xe8e2d4, sock: 0xd8d2c2 },
  child: { skin: 0xb97a52, shirt: 0xf2a541, pants: 0x3e6b9e, accent: 0x8c1f28, hair: 0x241812, shoe: 0xcf3230, sole: 0xefece2, sock: 0xf5efdc },
}

function makeMaterials(g: Gender) {
  const P = PALETTES[g]
  const named = (m: THREE.MeshStandardMaterial, name: string) => { m.name = `human_${name}`; return m }
  return {
    skin: named(new THREE.MeshStandardMaterial({ color: P.skin, roughness: 0.58, metalness: 0.01 }), 'skin'),
    shirt: named(new THREE.MeshStandardMaterial({ color: P.shirt, roughness: 0.82, metalness: 0.0 }), 'shirt'),
    shirtDark: named(new THREE.MeshStandardMaterial({ color: new THREE.Color(P.shirt).multiplyScalar(0.82), roughness: 0.84, metalness: 0.0 }), 'shirtDark'),
    pants: named(new THREE.MeshStandardMaterial({ color: P.pants, roughness: 0.86, metalness: 0.0 }), 'pants'),
    accent: named(new THREE.MeshStandardMaterial({ color: P.accent, roughness: 0.6, metalness: 0.04 }), 'accent'),
    hair: named(new THREE.MeshStandardMaterial({ color: P.hair, roughness: 0.58, metalness: 0.0 }), 'hair'),
    shoe: named(new THREE.MeshStandardMaterial({ color: P.shoe, roughness: 0.68, metalness: 0.02 }), 'shoe'),
    sole: named(new THREE.MeshStandardMaterial({ color: P.sole, roughness: 0.92, metalness: 0.0 }), 'sole'),
    sock: named(new THREE.MeshStandardMaterial({ color: P.sock, roughness: 0.9, metalness: 0.0 }), 'sock'),
    eyeWhite: named(new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.22, metalness: 0.0 }), 'eyeWhite'),
    iris: named(new THREE.MeshStandardMaterial({ color: 0x3d2a1a, roughness: 0.25, metalness: 0.0 }), 'iris'),
    pupil: named(new THREE.MeshStandardMaterial({ color: 0x14100b, roughness: 0.12, metalness: 0.0 }), 'pupil'),
    glint: named(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.0 }), 'glint'),
    lip: named(new THREE.MeshStandardMaterial({ color: new THREE.Color(P.skin).multiplyScalar(0.72), roughness: 0.45, metalness: 0.0 }), 'lip'),
    mouthIn: named(new THREE.MeshStandardMaterial({ color: 0x3a1a16, roughness: 0.6, metalness: 0.0 }), 'mouthIn'),
    teeth: named(new THREE.MeshStandardMaterial({ color: 0xf2ede0, roughness: 0.3, metalness: 0.0 }), 'teeth'),
    brow: named(new THREE.MeshStandardMaterial({ color: P.hair, roughness: 0.7, metalness: 0.0 }), 'brow'),
  }
}
type Mats = ReturnType<typeof makeMaterials>

// ============================================================================
// 3. GEOMETRY HELPERS
// ============================================================================
const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
  const m = new THREE.Mesh(geo, mat)
  m.name = name
  return m
}

/** Elliptical ring positions centered (cx, y, cz). */
function ringPositions(y: number, rx: number, rz: number, segs: number, cz = 0, bust = 0): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  for (let j = 0; j < segs; j++) {
    const a = (j / segs) * Math.PI * 2
    const s = Math.sin(a)
    const rzEff = rz * (1 + bust * Math.max(0, s) ** 2)
    pts.push(new THREE.Vector3(Math.cos(a) * rx, y, cz + s * rzEff))
  }
  return pts
}

/**
 * Loft a closed tube through ring sets (bottom → top). Returns indexed geometry
 * (seam-wrapped, smooth normals). Rings are { y, rx, rz, cz?, bust? }.
 */
function loft(rings: { y: number; rx: number; rz: number; cz?: number; bust?: number }[], segs: number, capTop = true, capBottom = true): THREE.BufferGeometry {
  const pos: number[] = []
  const idx: number[] = []
  const rows: THREE.Vector3[][] = []
  for (const r of rings) {
    const row = ringPositions(r.y, r.rx, r.rz, segs, r.cz ?? 0, r.bust ?? 0)
    rows.push(row)
    for (const p of row) pos.push(p.x, p.y, p.z)
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const o0 = i * segs, o1 = (i + 1) * segs
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs
      idx.push(o0 + j, o1 + j, o0 + j1, o0 + j1, o1 + j, o1 + j1)
    }
  }
  // converge caps (tiny inward cone tucked inside neighbours — no open edges)
  const capRow = (rowIdx: number, dir: 1 | -1) => {
    const row = rows[rowIdx]
    let cy = 0, cz = 0
    for (const p of row) { cy += p.y; cz += p.z }
    cy /= row.length; cz /= row.length
    const c = new THREE.Vector3(0, cy + dir * 0.004, cz)
    const ci = pos.length / 3
    pos.push(c.x, c.y, c.z)
    const o = rowIdx * segs
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs
      if (dir > 0) idx.push(o + j, ci, o + j1)
      else idx.push(o + j1, ci, o + j)
    }
  }
  if (capTop) capRow(rows.length - 1, 1)
  if (capBottom) capRow(0, -1)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

/** Merge indexed geometries (position/normal/index) into one. */
function mergeGeoms(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (list.length === 1) return list[0]
  let vCount = 0, iCount = 0
  for (const g of list) { vCount += g.attributes.position.count; iCount += (g.index as THREE.BufferAttribute).count }
  const pos = new Float32Array(vCount * 3)
  const nor = new Float32Array(vCount * 3)
  const idx = new Uint32Array(iCount)
  let vo = 0, io = 0
  for (const g of list) {
    const p = g.attributes.position as THREE.BufferAttribute
    const n = g.attributes.normal as THREE.BufferAttribute
    const gi = g.index as THREE.BufferAttribute
    pos.set(p.array as Float32Array, vo * 3)
    nor.set(n.array as Float32Array, vo * 3)
    for (let i = 0; i < gi.count; i++) idx[io + i] = gi.getX(i) + vo
    vo += p.count
    io += gi.count
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  out.setIndex(new THREE.Uint32BufferAttribute(idx, 1))
  return out
}

const capsule = (r: number, len: number, mat: THREE.Material, name: string, seg = 8): THREE.Mesh =>
  mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 2), 3, seg), mat, name)

function distPointSeg(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a)
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1)
  return p.distanceTo(a.clone().add(ab.multiplyScalar(t)))
}

// ============================================================================
// 4. SKELETON
// ============================================================================
interface BoneInfo { bone: THREE.Bone; world: THREE.Vector3 }
interface SkeletonDef {
  bones: THREE.Bone[]
  index: Record<string, number>
  world: Record<string, THREE.Vector3>
}

function buildSkeleton(p: Prop): SkeletonDef {
  const bones: THREE.Bone[] = []
  const world: Record<string, THREE.Vector3> = {}
  const add = (name: string, parent: THREE.Bone | null, w: THREE.Vector3): THREE.Bone => {
    const b = new THREE.Bone()
    b.name = name
    if (parent) {
      b.position.copy(w).sub(parent.getWorldPosition(new THREE.Vector3()))
      parent.add(b)
    } else {
      b.position.copy(w)
    }
    bones.push(b)
    world[name] = w.clone()
    return b
  }
  const hipsW = new THREE.Vector3(0, p.hipY, 0)
  const hips = add('Hips', null, hipsW)
  const torso = add('Torso', hips, new THREE.Vector3(0, p.hipY + p.spineY, 0))
  const chest = add('Chest', torso, new THREE.Vector3(0, p.hipY + p.chestY, 0))
  const neck = add('Neck', chest, new THREE.Vector3(0, p.hipY + p.torsoTop - p.neckLen, 0))
  add('Head', neck, new THREE.Vector3(0, p.hipY + p.torsoTop, 0))
  // clavicle + arm chains (bone rest positions carry the natural outward splay)
  for (const s of [-1, 1] as const) {
    const L = s < 0 ? 'L' : 'R'
    const shW = new THREE.Vector3(s * p.shoulderX, p.shoulderY, 0)
    const elW = new THREE.Vector3(s * (p.shoulderX + 0.03), p.shoulderY - p.upperLen, 0)
    const wrW = new THREE.Vector3(s * (p.shoulderX + 0.06), p.shoulderY - p.upperLen - p.foreLen, 0)
    const clav = add(`Clavicle${L}`, chest, new THREE.Vector3(s * (p.shoulderX * 0.33), p.shoulderY - 0.02, 0))
    add(`Arm${L}`, clav, shW)
    add(`Elbow${L}`, bones[bones.length - 1], elW)
    add(`Hand${L}`, bones[bones.length - 1], wrW)
  }
  // legs
  for (const s of [-1, 1] as const) {
    const L = s < 0 ? 'L' : 'R'
    add(`Leg${L}`, hips, new THREE.Vector3(s * p.hipX, p.hipY - 0.02, 0))
    add(`Knee${L}`, bones[bones.length - 1], new THREE.Vector3(s * (p.hipX + 0.004), p.hipY - 0.02 - p.thighLen, 0))
    add(`Foot${L}`, bones[bones.length - 1], new THREE.Vector3(s * (p.hipX + 0.004), p.footH, 0.015))
    // toe (ball-of-foot) joint — enables the MTP break during push-off
    add(`Toe${L}`, bones[bones.length - 1], new THREE.Vector3(s * (p.hipX + 0.004), p.footH - p.footH * 0.32, 0.015 + p.footH * 1.05))
  }
  return { bones, index: Object.fromEntries(bones.map((b, i) => [b.name, i])), world }
}

// ============================================================================
// 5. SKIN WEIGHTS — smooth distance-to-segment binding
// ============================================================================
interface Seg { name: string; a: THREE.Vector3; b: THREE.Vector3; r: number }

function buildSegments(p: Prop, w: Record<string, THREE.Vector3>): Seg[] {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const segs: Seg[] = [
    { name: 'Hips', a: V(0, p.hipY - 0.10, 0), b: V(0, p.hipY + p.spineY, 0), r: p.pelvis.rx * 0.92 },
    { name: 'Torso', a: V(0, p.hipY + p.spineY, 0), b: V(0, p.hipY + p.chestY, 0), r: 0.118 },
    { name: 'Chest', a: V(0, p.hipY + p.chestY, 0), b: V(0, p.hipY + p.torsoTop - p.neckLen, 0), r: 0.128 },
    { name: 'Neck', a: V(0, p.hipY + p.torsoTop - p.neckLen, 0), b: V(0, p.hipY + p.torsoTop + 0.02, 0), r: 0.038 },
  ]
  for (const s of [-1, 1] as const) {
    const L = s < 0 ? 'L' : 'R'
    segs.push({ name: `Clavicle${L}`, a: V(s * p.shoulderX * 0.33, p.shoulderY - 0.02, 0), b: V(s * p.shoulderX, p.shoulderY, 0), r: 0.05 })
    segs.push({ name: `Arm${L}`, a: w[`Arm${L}`], b: w[`Elbow${L}`], r: p.armR1 })
    segs.push({ name: `Elbow${L}`, a: w[`Elbow${L}`], b: w[`Hand${L}`], r: p.armR2 })
    segs.push({ name: `Hand${L}`, a: w[`Hand${L}`], b: w[`Hand${L}`].clone().add(V(s * 0.03, -p.handLen, 0)), r: p.armR3 })
    segs.push({ name: `Leg${L}`, a: w[`Leg${L}`], b: w[`Knee${L}`], r: p.legR1 })
    segs.push({ name: `Knee${L}`, a: w[`Knee${L}`], b: w[`Foot${L}`], r: p.legR2 })
    segs.push({ name: `Foot${L}`, a: w[`Foot${L}`], b: w[`Foot${L}`].clone().add(V(0, 0, 0.12)), r: p.legR3 })
  }
  return segs
}

/** Bind geometry: per-vertex up-to-4 nearest bone segments, inverse-distance³, normalized.
 * `allow` = per-mesh INFLUENCE MASK (real-rig practice: a torso vertex must never
 * inherit arm weights, or arm swing spikes the chest). `overrides` force weights
 * in bands (e.g. leg-top rows follow Hips to kill crotch webbing). */
function skinnify(geo: THREE.BufferGeometry, segs: Seg[], index: Record<string, number>, maxInf = 4,
  allow?: string[], overrides?: { yMin: number; yMax: number; weights: [string, number][] }[]): void {
  const usable = allow ? segs.filter((s) => allow.includes(s.name)) : segs
  const pos = geo.attributes.position as THREE.BufferAttribute
  const n = pos.count
  const skinIdx = new Uint16Array(n * 4)
  const skinW = new Float32Array(n * 4)
  const v = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i)
    const ov = overrides?.find((o) => v.y >= o.yMin && v.y <= o.yMax)
    if (ov) {
      let k = 0
      for (const [nm, w] of ov.weights) { skinIdx[i * 4 + k] = index[nm]; skinW[i * 4 + k] = w; k++ }
      for (; k < 4; k++) { skinIdx[i * 4 + k] = index[ov.weights[0][0]]; skinW[i * 4 + k] = 0 }
      continue
    }
    const ds = usable.map((s) => ({ si: index[s.name], d: Math.max(0.004, distPointSeg(v, s.a, s.b) - s.r) }))
    ds.sort((x, y) => x.d - y.d)
    let total = 0
    const inf: { si: number; w: number }[] = []
    for (let k = 0; k < Math.min(maxInf, ds.length); k++) {
      const wgt = 1 / ds[k].d ** 3
      inf.push({ si: ds[k].si, w: wgt })
      total += wgt
    }
    for (let k = 0; k < 4; k++) {
      if (k < inf.length) {
        skinIdx[i * 4 + k] = inf[k].si
        skinW[i * 4 + k] = inf[k].w / total
      } else {
        skinIdx[i * 4 + k] = inf[0].si
        skinW[i * 4 + k] = 0
      }
    }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIdx, 4))
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4))
}

/** Force weights on a geometry to a single bone (rigid-by-skin regions). */
function skinToSingle(geo: THREE.BufferGeometry, boneIdx: number): void {
  const n = geo.attributes.position.count
  const skinIdx = new Uint16Array(n * 4)
  const skinW = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) { skinIdx[i * 4] = boneIdx; skinW[i * 4] = 1 }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIdx, 4))
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4))
}

// ============================================================================
// 6. BODY + CLOTHING BUILDER
// ============================================================================
const HEAD_RX = 0.95, HEAD_RY = 1.12, HEAD_RZ = 0.98

/** 2-axis front-surface z of the skull ellipsoid (kid-lesson: BOTH axes matter). */
function faceZ(p: Prop, yLocal: number, x = 0): number {
  const R = p.headR
  const cy = p.headCY
  const dx = x / (R * HEAD_RX)
  const dy = (yLocal - cy) / (R * HEAD_RY)
  const rr = Math.max(0.03, 1 - dx * dx - dy * dy)
  return R * HEAD_RZ * Math.sqrt(rr)
}

function buildHead(p: Prop, M: Mats): THREE.Group {
  const g = new THREE.Group()
  g.name = 'HeadGroup'
  const R = p.headR
  const cy = p.headCY
  const kid = p === CHILD

  // skull — ellipsoid with a jaw taper (vertex displacement toward the chin)
  const skullGeo = new THREE.SphereGeometry(R, 22, 16)
  skullGeo.scale(HEAD_RX, HEAD_RY, HEAD_RZ)
  skullGeo.translate(0, cy, 0.004)
  {
    const pos = skullGeo.attributes.position as THREE.BufferAttribute
    const chin = new THREE.Vector3(0, cy - R * 0.95, R * 0.30)
    for (let i = 0; i < pos.count; i++) {
      const vy = pos.getY(i), vz = pos.getZ(i)
      if (vy < cy - R * 0.25 && vz > -R * 0.2) {
        const f = THREE.MathUtils.smoothstep((cy - R * 0.25 - vy) / (R * 0.9), 0, 1) * 0.35
        pos.setXYZ(i, pos.getX(i) * (1 - f * 0.35), vy + (chin.y - vy) * f * 0.4, vz + (chin.z - vz) * f * 0.5)
      }
    }
  }
  skullGeo.computeVertexNormals()
  g.add(mesh(skullGeo, M.skin, 'HumanHead'))

  // jaw filler — rounds the under-face AND bridges down to the neck
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(R * 0.52, 12, 8), M.skin)
  jaw.name = 'JawFill'
  jaw.scale.set(0.95, 0.72, 0.95)
  jaw.position.set(0, cy - R * 0.55, R * 0.14)
  g.add(jaw)

  // ears
  for (const s of [-1, 1] as const) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(R * 0.22, 8, 6), M.skin)
    ear.name = s < 0 ? 'EarL' : 'EarR'
    ear.scale.set(0.42, 0.95, 0.68)
    ear.position.set(s * R * HEAD_RX * 0.94, cy + R * 0.02, 0.004)
    g.add(ear)
  }

  // nose — soft wedge: bridge + tip, proud of the surface
  const noseY = cy - R * 0.02
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(R * 0.10, R * 0.26, R * 0.10), M.skin)
  bridge.name = 'NoseBridge'
  bridge.position.set(0, noseY + R * 0.10, faceZ(p, noseY + R * 0.10) - R * 0.035)
  g.add(bridge)
  const nose = new THREE.Mesh(new THREE.SphereGeometry(R * 0.075, 8, 6), M.skin)
  nose.name = 'Nose'
  nose.scale.set(1.1, 0.85, 1.0)
  nose.position.set(0, noseY, faceZ(p, noseY) + R * 0.012)
  g.add(nose)

  // eyes — sclera lens + iris + pupil + glints, with BLINK LID shells
  const eyeY = cy + R * 0.03
  for (const s of [-1, 1] as const) {
    const side = s < 0 ? 'L' : 'R'
    const ex = s * R * 0.33
    const zSurf = faceZ(p, eyeY, ex)
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(R * 0.215, 14, 10), M.eyeWhite)
    sclera.name = `Eye${side}`
    sclera.scale.set(1.0, 0.94, 0.45)
    sclera.position.set(ex, eyeY, zSurf - R * 0.078)
    g.add(sclera)
    const iris = new THREE.Mesh(new THREE.SphereGeometry(R * 0.125, 10, 8), M.iris)
    iris.name = `Iris${side}`
    iris.scale.set(1, 1, 0.42)
    iris.position.set(ex, eyeY, zSurf + R * 0.01)
    g.add(iris)
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(R * 0.062, 8, 6), M.pupil)
    pupil.name = `Pupil${side}`
    pupil.scale.set(1, 1, 0.4)
    pupil.position.set(ex, eyeY, zSurf + R * 0.026)
    g.add(pupil)
    const glint = new THREE.Mesh(new THREE.SphereGeometry(R * 0.024, 6, 4), M.glint)
    glint.name = `Glint${side}`
    glint.position.set(ex - s * R * 0.032, eyeY + R * 0.05, zSurf + R * 0.036)
    g.add(glint)
    // upper lid — shell that rotates down to close (origin AT eye center);
    // rests tucked up-back so the eye reads fully open
    const lid = new THREE.Mesh(new THREE.SphereGeometry(R * 0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.46), M.skin)
    lid.name = `LidTop${side}`
    lid.scale.set(1.12, 1.0, 0.6)
    lid.position.set(ex, eyeY + R * 0.008, zSurf - R * 0.06)
    lid.rotation.x = -1.2
    g.add(lid)
    // lower lid — static soft shelf
    const lidB = new THREE.Mesh(new THREE.SphereGeometry(R * 0.225, 10, 6, 0, Math.PI * 2, Math.PI * 0.74, Math.PI * 0.18), M.skin)
    lidB.name = `LidBot${side}`
    lidB.scale.set(1.06, 0.9, 0.58)
    lidB.position.set(ex, eyeY, zSurf - R * 0.06)
    g.add(lidB)
  }

  // brows — expressive, driven by facial-rig
  const browY = cy + R * 0.27
  for (const s of [-1, 1] as const) {
    const brow = capsule(R * 0.026, R * 0.02, M.brow, s < 0 ? 'BrowL' : 'BrowR', 6)
    brow.rotation.z = Math.PI / 2 + s * 0.14
    brow.position.set(s * R * 0.34, browY, faceZ(p, browY, s * R * 0.34) + R * 0.012)
    g.add(brow)
  }

  // mouth — visible lips + teeth hint; JAW group carries lower lip + chin
  const mouthY = cy - R * 0.30
  const upperLip = new THREE.Mesh(new THREE.CapsuleGeometry(R * 0.038, R * 0.15, 3, 8), M.lip)
  upperLip.name = 'UpperLip'
  upperLip.rotation.z = Math.PI / 2
  upperLip.position.set(0, mouthY + R * 0.02, faceZ(p, mouthY + R * 0.02) + R * 0.01)
  g.add(upperLip)
  const interior = new THREE.Mesh(new THREE.SphereGeometry(R * 0.11, 10, 6), M.mouthIn)
  interior.name = 'MouthInterior'
  interior.scale.set(1.15, 0.55, 0.3)
  interior.position.set(0, mouthY - R * 0.012, faceZ(p, mouthY - R * 0.012) - R * 0.015)
  g.add(interior)
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(R * 0.16, R * 0.034, R * 0.022), M.teeth)
  teeth.name = 'Teeth'
  teeth.position.set(0, mouthY + R * 0.004, faceZ(p, mouthY) + R * 0.014)
  g.add(teeth)
  // JAW — rotates +x to open (lower lip + chin pad ride it)
  const jawGroup = new THREE.Group()
  jawGroup.name = 'Jaw'
  jawGroup.position.set(0, mouthY - R * 0.045, faceZ(p, mouthY - R * 0.045) * 0.55)
  g.add(jawGroup)
  const lowerLip = new THREE.Mesh(new THREE.CapsuleGeometry(R * 0.042, R * 0.13, 3, 8), M.lip)
  lowerLip.name = 'LowerLip'
  lowerLip.rotation.z = Math.PI / 2
  lowerLip.position.set(0, 0, R * 0.125)
  jawGroup.add(lowerLip)
  const chinPad = new THREE.Mesh(new THREE.SphereGeometry(R * 0.115, 10, 6), M.skin)
  chinPad.name = 'ChinPad'
  chinPad.scale.set(1.05, 0.5, 0.75)
  chinPad.position.set(0, -R * 0.06, R * 0.07)
  jawGroup.add(chinPad)

  // HAIR — variant styles; female ponytail gets a runtime spring node.
  // thetaLength ends ABOVE the brows so the face stays open (helmet-hair bug).
  const hairShell = new THREE.Mesh(new THREE.SphereGeometry(R * 1.05, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.4), M.hair)
  hairShell.name = 'Hair'
  hairShell.scale.set(HEAD_RX * 1.03, HEAD_RY * 1.0, HEAD_RZ * 1.04)
  hairShell.position.set(0, cy + R * 0.02, -R * 0.02)
  hairShell.rotation.x = -0.15
  g.add(hairShell)
  const nape = new THREE.Mesh(new THREE.SphereGeometry(R * 0.52, 12, 8), M.hair)
  nape.name = 'HairNape'
  nape.scale.set(1.4, 0.8, 0.95)
  nape.position.set(0, cy - R * 0.14, -R * 0.74)
  g.add(nape)
  const fringeN = kid ? 4 : 3
  for (let i = 0; i < fringeN; i++) {
    const fx = (i - (fringeN - 1) / 2) * R * 0.3
    const tuft = new THREE.Mesh(new THREE.SphereGeometry(R * (kid ? 0.17 : 0.145), 8, 6), M.hair)
    tuft.name = `Fringe${i}`
    tuft.scale.set(1.25, 0.62, 0.6)
    tuft.rotation.z = fx * 3
    tuft.position.set(fx, cy + R * 0.54, faceZ(p, cy + R * 0.54, fx) - R * 0.03)
    g.add(tuft)
  }
  // side tufts above the ears kill the bare-strip look
  for (const s of [-1, 1] as const) {
    const tuft = new THREE.Mesh(new THREE.SphereGeometry(R * 0.16, 8, 6), M.hair)
    tuft.name = s < 0 ? 'SideHairL' : 'SideHairR'
    tuft.scale.set(0.55, 1.1, 1.0)
    tuft.position.set(s * R * 0.88, cy + R * 0.24, -R * 0.05)
    g.add(tuft)
  }
  if (kid) {
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(R * 0.075, R * 0.24, 6), M.hair)
      spike.name = `Spike${i}`
      const a = (i / 4) * Math.PI * 2 + 0.4
      spike.position.set(Math.sin(a) * R * 0.5, cy + R * 0.78, -Math.abs(Math.cos(a)) * R * 0.4)
      spike.rotation.set(Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5)
      g.add(spike)
    }
  }
  if (p === FEMALE) {
    // long back mane
    const mane = new THREE.Mesh(new THREE.CapsuleGeometry(R * 0.34, R * 1.15, 4, 10), M.hair)
    mane.name = 'HairMane'
    mane.scale.set(1.15, 1, 0.55)
    mane.position.set(0, cy - R * 0.42, -R * 0.82)
    mane.rotation.x = 0.12
    g.add(mane)
    // ponytail — SECONDARY-PHYSICS node (runtime spring in SecondaryMotion)
    const pony = new THREE.Group()
    pony.name = 'Ponytail'
    pony.position.set(0, cy + R * 0.38, -R * 0.95)
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(R * 0.14, R * 0.85, 4, 8), M.hair)
    tail.name = 'PonytailMesh'
    tail.position.set(0, -R * 0.42, -R * 0.05)
    tail.rotation.x = 0.22
    pony.add(tail)
    const tip = new THREE.Mesh(new THREE.SphereGeometry(R * 0.115, 8, 6), M.hair)
    tip.name = 'PonytailTip'
    tip.position.set(0, -R * 0.92, -R * 0.14)
    pony.add(tip)
    const band = new THREE.Mesh(new THREE.TorusGeometry(R * 0.1, R * 0.022, 6, 10), M.accent)
    band.name = 'PonytailBand'
    band.rotation.x = Math.PI / 2 - 0.2
    band.position.set(0, -R * 0.02, 0)
    pony.add(band)
    g.add(pony)
  }
  return g
}

function buildBodyAndClothes(p: Prop, M: Mats, skel: SkeletonDef, segs: Seg[]): { skinned: THREE.SkinnedMesh[]; rigid: THREE.Object3D[] } {
  const skinned: THREE.SkinnedMesh[] = []
  const rigid: THREE.Object3D[] = []
  const isChild = p === CHILD
  const shortSleeves = isChild // child tee shows forearms; adults wear long sleeves

  // ---- torso loft (continuous hip-line → neck; shirt for all variants).
  // INFLUENCE MASK: spine bones ONLY — a chest vertex must never inherit arm
  // weights (run-pose spike bug, QA round 5). ----
  const rings = p.rings.map((r) => ({ y: p.hipY + r.y, rx: r.rx, rz: r.rz, bust: r.bust ?? 0 }))
  const torsoGeo = loft(rings, 18)
  skinnify(torsoGeo, segs, skel.index, 4, ['Hips', 'Torso', 'Chest', 'Neck'])
  const torso = new THREE.SkinnedMesh(torsoGeo, M.shirt)
  torso.name = 'HumanTorso'
  skinned.push(torso)

  // ---- pelvis (rigid child of Hips, pants) — BONE-LOCAL space ----
  const pelvisGeo = loft([
    { y: -p.pelvis.h * 0.55, rx: p.pelvis.rx * 0.86, rz: p.pelvis.rz * 0.82 },
    { y: -p.pelvis.h * 0.2, rx: p.pelvis.rx, rz: p.pelvis.rz },
    { y: p.pelvis.h * 0.16, rx: p.pelvis.rx * 0.98, rz: p.pelvis.rz * 0.96 },
    { y: p.pelvis.h * 0.34, rx: p.pelvis.rx * 0.88, rz: p.pelvis.rz * 0.9 },
  ], 18)
  const pelvis = mesh(pelvisGeo, M.pants, 'HumanPelvis')
  rigid.push(pelvis)

  // ---- neck filler (rigid child of Chest, skin) — BONE-LOCAL space.
  // Tall enough to reach INTO the skull bottom (floating-head bug). ----
  const neckTopWorld = p.hipY + p.torsoTop + 0.185
  const neckBotWorld = p.hipY + p.torsoTop - p.neckLen - 0.04
  const neckGeo = new THREE.CylinderGeometry(p.headR * 0.34, p.headR * 0.3, neckTopWorld - neckBotWorld, 10)
  neckGeo.translate(0, (neckTopWorld + neckBotWorld) / 2 - (p.hipY + p.chestY), 0)
  const neckM = mesh(neckGeo, M.skin, 'HumanNeck')
  rigid.push(neckM)

  // ---- collar band (rigid child of Chest) — closes the shirt around the neck
  const collarGeo = new THREE.CylinderGeometry(p.headR * 0.46, p.headR * 0.72, 0.05, 12)
  collarGeo.translate(0, p.hipY + p.torsoTop - 0.035 - (p.hipY + p.chestY), 0)
  const collar = mesh(collarGeo, M.shirtDark, 'Collar')
  rigid.push(collar)

  // ---- trapezius wedges REMOVED (QA r2: corners peeked out as dark flaps).
  // The widened roof rings + sunk deltoid dome cover the notch. ----

  // ---- arms (per side) ----
  for (const s of [-1, 1] as const) {
    const L = s < 0 ? 'L' : 'R'
    const sh = skel.world[`Arm${L}`]
    const el = skel.world[`Elbow${L}`]
    const wr = skel.world[`Hand${L}`]
    const midBicep = sh.clone().lerp(el, 0.52)
    const sleeveEnd = shortSleeves ? midBicep : el
    // start the sleeve BELOW the joint so its top ring tucks under the deltoid
    // dome (a full-radius ring AT the joint pokes 0.06 above it — QA r3/r4)
    const shLow = sh.clone(); shLow.y -= p.armR1 * 1.26 * 0.85
    // sleeve section (shirt) — top radius matches the deltoid capsule
    const sleeveGeo2 = armLoft(shLow, sleeveEnd, p.armR1 * 1.26, p.armR1 * 1.04, 12, 5)
    if (shortSleeves) {
      skinnify(sleeveGeo2, segs, skel.index, 4, [`Clavicle${L}`, `Arm${L}`])
      const sleeve = new THREE.SkinnedMesh(sleeveGeo2, M.shirt)
      sleeve.name = `Sleeve${L}`
      skinned.push(sleeve)
      // skin forearm: mid-bicep → wrist (spans the elbow — smooth weights)
      const foreGeo = armLoft(midBicep, wr, p.armR1 * 0.94, p.armR3, 12, 7)
      skinnify(foreGeo, segs, skel.index, 4, [`Arm${L}`, `Elbow${L}`, `Hand${L}`])
      const fore = new THREE.SkinnedMesh(foreGeo, M.skin)
      fore.name = `Forearm${L}`
      skinned.push(fore)
    } else {
      // adult: full arm in the shirt material, spans the elbow
      const armGeo = armLoft(shLow, wr, p.armR1 * 1.24, p.armR3, 14, 10)
      skinnify(armGeo, segs, skel.index, 4, [`Clavicle${L}`, `Arm${L}`, `Elbow${L}`, `Hand${L}`])
      const arm = new THREE.SkinnedMesh(armGeo, M.shirt)
      arm.name = `HumanArm${L}`
      skinned.push(arm)
    }
    // deltoid — teardrop capsule along the upper-arm axis (NOT a ball on a
    // stick): dome cap at the joint, radius matches the sleeve top so the two
    // read as one continuous form
    const deltCyl = Math.max(0.012, p.armR1 * 0.3)
    const delt = mesh(new THREE.CapsuleGeometry(p.armR1 * 1.26, deltCyl, 4, 12), M.shirt, `Deltoid${L}`)
    delt.scale.set(1.15, 1, 0.95)
    delt.rotation.z = s * 0.1 // rest splay so the capsule axis matches the sleeve
    delt.position.y = 0.012 - (deltCyl / 2 + p.armR1 * 1.26) // dome top covers the sleeve end-cap (cap sits at joint+0.004)
    rigid.push(delt)
    // hand (rigid child of Hand bone): palm loft + 4 curled fingers + thumb
    const handGeo = buildHandGeo(p, s)
    const hand = mesh(handGeo, M.skin, `HumanHand${L}`)
    rigid.push(hand)
    // cuff detail for adults (shirtDark band at the wrist)
    if (!shortSleeves) {
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(p.armR3 * 1.22, p.armR3 * 1.28, 0.028, 10), M.shirtDark)
      cuff.name = `Cuff${L}`
      cuff.position.y = -p.foreLen + 0.03
      rigid.push(cuff)
    }
  }

  // ---- legs (per side) ----
  for (const s of [-1, 1] as const) {
    const L = s < 0 ? 'L' : 'R'
    const hp = skel.world[`Leg${L}`]
    const kn = skel.world[`Knee${L}`]
    const an = skel.world[`Foot${L}`]
    if (isChild) {
      // shorts (thigh) + bare calves — modular demo of the clothing split
      const thighGeo = armLoft(hp, kn, p.legR1 * 1.16, p.legR2 * 1.05, 12, 6)
      skinnify(thighGeo, segs, skel.index, 4, [`Hips`, `Leg${L}`], legTopOverride(p, `Leg${L}`))
      const thigh = new THREE.SkinnedMesh(thighGeo, M.pants)
      thigh.name = `Shorts${L}`
      skinned.push(thigh)
      const calfEnd = an.clone() // bare ankle continues via the AnkleSock
      const calfGeo = armLoft(kn, calfEnd, p.legR2 * 0.96, p.legR3, 12, 7)
      skinnify(calfGeo, segs, skel.index, 4, [`Leg${L}`, `Knee${L}`, `Foot${L}`])
      const calf = new THREE.SkinnedMesh(calfGeo, M.skin)
      calf.name = `Calf${L}`
      skinned.push(calf)
      // sock band
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(p.legR3 * 1.12, p.legR3 * 1.18, 0.05, 10), M.sock)
      sock.name = `Sock${L}`
      sock.position.y = -(an.y - kn.y) + 0.055
      rigid.push(sock)
    } else {
      // full pant leg spans the knee — hem ends ABOVE the ankle bone; the
      // AnkleSock (skin, rigid on Foot) bridges hem→shoe. (QA r13: a hem at
      // ankle height clips through the heel counter and shows the interior.)
      const anExt = an.clone(); anExt.y = p.footH * 1.45
      const legGeo = armLoft(hp, anExt, p.legR1 * 1.14, p.legR3 * 1.04, 14, 11)
      skinnify(legGeo, segs, skel.index, 4, [`Hips`, `Leg${L}`, `Knee${L}`, `Foot${L}`], legTopOverride(p, `Leg${L}`))
      const leg = new THREE.SkinnedMesh(legGeo, M.pants)
      leg.name = `HumanLeg${L}`
      skinned.push(leg)
    }
    // shoe: anatomical sneaker split at the ball — rear on Foot, front on Toe
    const shoeParts = buildShoeParts(p, M)
    for (const m of shoeParts.foot) { m.name += L; rigid.push(m) }
    for (const m of shoeParts.toe) { m.name += L; rigid.push(m) }
  }

  // parent rigid parts to their bones
  rigid.forEach((o) => {
    if (o.name === 'HumanPelvis') skel.bones[skel.index.Hips].add(o)
    else if (o.name === 'HumanNeck') skel.bones[skel.index.Chest].add(o)
    else if (o.name.startsWith('Deltoid')) skel.bones[skel.index[o.name.replace('Deltoid', 'Arm')]].add(o)
    else if (o.name.startsWith('HumanHand')) skel.bones[skel.index[o.name.replace('HumanHand', 'Hand')]].add(o)
    else if (o.name.startsWith('ShoeToe') || o.name.startsWith('SoleToe')) skel.bones[skel.index[o.name.endsWith('L') ? 'ToeL' : 'ToeR']].add(o)
    else if (o.name.startsWith('HumanShoe') || o.name.startsWith('HumanSole') || o.name.startsWith('ShoeCollar') || o.name.startsWith('ShoeTongue') || o.name.startsWith('ShoeLace') || o.name.startsWith('ShoeHeelTab') || o.name.startsWith('AnkleSock')) skel.bones[skel.index[o.name.endsWith('L') ? 'FootL' : 'FootR']].add(o)
    else if (o.name.startsWith('Sock')) skel.bones[skel.index[o.name.endsWith('L') ? 'KneeL' : 'KneeR']].add(o)
    else if (o.name.startsWith('Cuff')) skel.bones[skel.index[o.name.endsWith('L') ? 'ElbowL' : 'ElbowR']].add(o)
    else if (o.name === 'Collar' || o.name.startsWith('Trapezius')) skel.bones[skel.index.Chest].add(o)
  })
  return { skinned, rigid }
}

/** Force the top rows of a leg/shorts loft to follow Hips mostly — kills the
 * crotch webbing when the leg swings (QA round 5). */
function legTopOverride(p: Prop, leg: 'LegL' | 'LegR'): { yMin: number; yMax: number; weights: [string, number][] }[] {
  return [
    { yMin: p.hipY - 0.02, yMax: 99, weights: [['Hips', 0.8], [leg, 0.2]] },
    { yMin: p.hipY - 0.1, yMax: p.hipY - 0.02, weights: [['Hips', 0.45], [leg, 0.55]] },
  ]
}

/** Loft along an arbitrary limb axis (a→b) with linear radius taper. */
function armLoft(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, segs: number, rows: number): THREE.BufferGeometry {
  const rings: { y: number; rx: number; rz: number; cz?: number }[] = []
  const axis = b.clone().sub(a)
  // sample along the axis; rings stay perpendicular via y-slabs (limbs are near-vertical)
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1)
    const pt = a.clone().lerp(b, t)
    const rr = THREE.MathUtils.lerp(r0, r1, t)
    rings.push({ y: pt.y, rx: rr, rz: rr, cz: pt.z })
  }
  const geo = loft(rings, segs)
  // shift x/z so each ring centers on the limb axis (loft centers on x=0)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    // find row t by y
    const tt = THREE.MathUtils.clamp((y - a.y) / Math.max(1e-6, b.y - a.y), 0, 1)
    pos.setX(i, pos.getX(i) + THREE.MathUtils.lerp(a.x, b.x, tt))
    pos.setZ(i, pos.getZ(i) + THREE.MathUtils.lerp(a.z, b.z, tt))
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

function buildHandGeo(p: Prop, side: -1 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const palmLen = p.handLen * 0.52
  const palm = loft([
    { y: 0, rx: p.armR3 * 1.08, rz: p.armR3 * 0.62 },
    { y: -palmLen * 0.5, rx: p.armR3 * 1.24, rz: p.armR3 * 0.66 },
    { y: -palmLen, rx: p.armR3 * 1.3, rz: p.armR3 * 0.6 },
  ], 10)
  parts.push(palm)
  const fingerR = p.armR3 * 0.3
  for (let f = 0; f < 4; f++) {
    const fg = new THREE.CapsuleGeometry(fingerR, p.handLen * 0.42, 2, 6)
    fg.translate(0, -p.handLen * 0.44, 0)
    fg.rotateZ(side * -(0.16 + f * 0.015)) // relaxed curl toward the palm
    fg.translate((-0.032 + f * 0.021) * p.handLen * 8.5, -palmLen + 0.004, 0)
    parts.push(fg)
  }
  const thumb = new THREE.CapsuleGeometry(fingerR * 1.25, p.handLen * 0.3, 2, 6)
  thumb.translate(0, -p.handLen * 0.22, 0)
  thumb.rotateZ(-side * 0.85)
  thumb.rotateX(-0.25)
  thumb.translate(side * -p.armR3 * 0.9, -palmLen * 0.35, p.armR3 * 0.5)
  parts.push(thumb)
  return mergeGeoms(parts)
}

// ============================================================================
// SHOE — anatomical sneaker on a foot last, split at the ball of the foot:
// rear (heel/arch) is a rigid child of Foot, front (toe box) of Toe, so the
// MTP break is visible during push-off. Foot-local space: bone origin at the
// ankle, ground at y=-footH, +z = forward.
// ============================================================================
interface FootLast { heelZ: number; tipZ: number; ballZ: number; U: number }
function footLast(p: Prop): FootLast {
  // TRUE foot-local space (origin at the Foot/ankle bone): heel behind, tip ahead
  return {
    heelZ: -p.footH * 0.72,
    tipZ: p.footH * 2.02,
    ballZ: p.footH * 1.05,
    U: p.legR3 * 1.3, // half-width unit at the ball
  }
}
/** half-width profile 0..1 of the foot last (heel → toe) */
function footW(t: number): number {
  if (t < 0.12) return 0.62 + (t / 0.12) * 0.2          // heel bulb
  if (t < 0.3) return 0.82 + ((t - 0.12) / 0.18) * 0.06
  if (t < 0.58) return 0.88 + ((t - 0.3) / 0.28) * 0.12  // widening to the ball
  if (t < 0.78) return 1 - ((t - 0.58) / 0.2) * 0.08
  if (t < 0.92) return 0.92 - ((t - 0.78) / 0.14) * 0.2
  return 0.72 - ((t - 0.92) / 0.08) * 0.28               // rounded toe (fuller tip)
}
/** sole thickness (heel wedge → thin toe) */
function soleTh(t: number, p: Prop): number { return p.footH * (0.3 - 0.13 * t) }
/** toe spring — sole centerline lifts toward the tip (subtle: ~1.5cm adult) */
function toeSpring(t: number, p: Prop): number {
  return t < 0.68 ? 0 : p.footH * 0.15 * ((t - 0.68) / 0.32) ** 1.7
}
/** topline of the shoe upper (collar → vamp → toe box), foot-local y.
 * One smooth descent from the collar to a round toe — no kink (QA r12: a
 * slope break at t=0.7 read as a second toe knuckle). */
function shoeTop(t: number, p: Prop): number {
  const f = p.footH
  if (t < 0.06) return f * (0.04 + (t / 0.06) * 0.12)     // heel counter rise
  if (t < 0.2) return f * (0.16 - ((t - 0.06) / 0.14) * 0.02) // collar plateau
  return f * (0.14 - ((t - 0.2) / 0.8) * 0.44)             // smooth vamp → toe
}
/** sole seat (top of the sole where the upper ends), foot-local y */
function soleSeat(t: number, p: Prop): number { return -p.footH + soleTh(t, p) + toeSpring(t, p) }

/** Loft along +z: cross-sections are ellipses in the x-y plane (halfW × halfH
 * centered at cy). Closed tube with z-converged caps. */
function zLoft(rows: { z: number; cy: number; hw: number; hh: number }[], segs = 14): THREE.BufferGeometry {
  const pos: number[] = []
  const idx: number[] = []
  for (const r of rows) {
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2
      pos.push(Math.cos(a) * r.hw, r.cy + Math.sin(a) * r.hh, r.z)
    }
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const o0 = i * segs, o1 = (i + 1) * segs
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs
      idx.push(o0 + j, o1 + j, o0 + j1, o0 + j1, o1 + j, o1 + j1)
    }
  }
  const cap = (rowIdx: number, dir: 1 | -1) => {
    const r = rows[rowIdx]
    const ci = pos.length / 3
    pos.push(0, r.cy, r.z + dir * 0.004)
    const o = rowIdx * segs
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs
      if (dir > 0) idx.push(o + j, ci, o + j1)
      else idx.push(o + j1, ci, o + j)
    }
  }
  cap(0, -1)
  cap(rows.length - 1, 1)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

function buildShoeParts(p: Prop, M: Mats): { foot: THREE.Mesh[]; toe: THREE.Mesh[] } {
  const F = footLast(p)
  const tOf = (z: number) => (z - F.heelZ) / (F.tipZ - F.heelZ)
  const zOf = (t: number) => F.heelZ + (F.tipZ - F.heelZ) * t
  const splitT = tOf(F.ballZ) // ball of the foot
  // Toe bone sits (foot-local) 0.32·footH BELOW and 1.05·footH AHEAD of the
  // ankle — toe-parented parts must be re-expressed in Toe-local space.
  const toeShift = { y: p.footH * 0.32, z: -p.footH * 1.05 }

  const foot: THREE.Mesh[] = []
  const toe: THREE.Mesh[] = []

  // ---- upper: rear (heel → just past the ball), front (overlap → tip) ----
  const upperRows = (t0: number, t1: number, n: number) => {
    const rows: { z: number; cy: number; hw: number; hh: number }[] = []
    for (let i = 0; i < n; i++) {
      const t = t0 + ((t1 - t0) * i) / (n - 1)
      const top = shoeTop(t, p), seat = soleSeat(t, p)
      rows.push({ z: zOf(t), cy: (top + seat) / 2, hw: footW(t) * F.U, hh: Math.max(0.006, (top - seat) / 2) })
    }
    return rows
  }
  const upperRear = mesh(zLoft(upperRows(0, Math.min(1, splitT + 0.07), 9), 14), M.shoe, 'HumanShoe')
  foot.push(upperRear)
  const upperFront = mesh(zLoft(upperRows(Math.max(0, splitT - 0.045), 1, 6), 14), M.shoe, 'ShoeToe')
  upperFront.geometry.translate(0, toeShift.y, toeShift.z)
  toe.push(upperFront)

  // ---- sole: same last, wider, flat-ish slab with heel wedge + toe spring ----
  const soleRows = (t0: number, t1: number, n: number) => {
    const rows: { z: number; cy: number; hw: number; hh: number }[] = []
    for (let i = 0; i < n; i++) {
      const t = t0 + ((t1 - t0) * i) / (n - 1)
      const th = soleTh(t, p)
      // slab spans ground(-footH+spring) → soleSeat; center sits halfway
      rows.push({ z: zOf(t), cy: -p.footH + th / 2 + toeSpring(t, p), hw: footW(t) * F.U * 1.1 + 0.004, hh: th / 2 })
    }
    return rows
  }
  const soleRear = mesh(zLoft(soleRows(0, Math.min(1, splitT + 0.06), 8), 14), M.sole, 'HumanSole')
  foot.push(soleRear)
  const soleFront = mesh(zLoft(soleRows(Math.max(0, splitT - 0.04), 1, 6), 14), M.sole, 'SoleToe')
  soleFront.geometry.translate(0, toeShift.y, toeShift.z)
  toe.push(soleFront)

  // ---- ankle filler (skin) — the pant hem ends at the ankle and the shoe
  // topline is below it: without this there is a see-through gap (QA r10) ----
  const sock = mesh(new THREE.CylinderGeometry(p.legR3 * 0.88, p.legR3 * 0.98, p.footH * 0.7, 10), M.skin, 'AnkleSock')
  sock.position.y = p.footH * 0.05 // spans ≈ 0.7f..1.4f world: pant hem → collar → into the shoe
  foot.push(sock)

  // ---- toe-tip cap (small rubber tip hugging the closed toe) — child of Toe
  // (QA r7: a ball-toecap at the ball line towered over the toe box) ----
  const capT = 0.93
  const toecap = mesh(new THREE.SphereGeometry(footW(capT) * F.U * 0.82, 12, 8), M.sole, 'ShoeToeCap')
  toecap.scale.set(1.0, 0.9, 1.0)
  toecap.position.set(0, (shoeTop(capT, p) + soleSeat(capT, p)) / 2 + toeShift.y, zOf(capT) + toeShift.z - 0.002)
  toe.push(toecap)

  // ---- padded collar around the ankle opening (child of Foot) — hugs the
  // membrane, stays INSIDE the heel silhouette (QA r6/r7: oversize torus
  // floated above the topline and overhung the heel) ----
  const cT = 0.11
  const collar = mesh(new THREE.TorusGeometry(footW(cT) * F.U * 0.72, p.footH * 0.11, 8, 16), M.shoe, 'ShoeCollar')
  collar.rotation.x = Math.PI / 2
  collar.scale.set(1.05, 1.06, 1) // mild oval along world z (local y pre-rotation)
  collar.position.set(0, shoeTop(cT, p) - p.footH * 0.055, zOf(cT))
  foot.push(collar)

  // ---- tongue on the instep + 3 lace bars down the vamp (children of Foot) ----
  const tongue = mesh(new THREE.SphereGeometry(F.U * 0.55, 10, 8), M.shoe, 'ShoeTongue')
  tongue.scale.set(1.0, 0.36, 1.5)
  tongue.position.set(0, shoeTop(0.3, p) - p.footH * 0.01, zOf(0.3) + 0.012)
  foot.push(tongue)
  const laceParts: THREE.BufferGeometry[] = []
  for (const lt of [0.22, 0.3, 0.38]) {
    const bar = new THREE.CapsuleGeometry(p.footH * 0.04, footW(lt) * F.U * 2.1, 3, 6)
    bar.rotateZ(Math.PI / 2)
    bar.translate(0, shoeTop(lt, p) + p.footH * 0.008, zOf(lt)) // half-sunk: reads as lace grooves
    laceParts.push(bar)
  }
  const laceMesh = mesh(mergeGeoms(laceParts), M.sole, 'ShoeLace')
  foot.push(laceMesh)
  // heel pull-tab
  const tab = mesh(new THREE.CapsuleGeometry(p.footH * 0.07, p.footH * 0.14, 3, 6), M.shoe, 'ShoeHeelTab')
  tab.position.set(0, shoeTop(0.035, p) + p.footH * 0.02, F.heelZ + p.footH * 0.04)
  foot.push(tab)

  return { foot, toe }
}

// ============================================================================
// 7. ANIMATION — biomechanical gait with foot roll + full state set
// ============================================================================
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
  const times = poses.map((pp) => pp[0])
  const qs = poses.map((pp) => quat(pp[1], pp[2], pp[3]))
  if (loop) { times.push(poses[0][0] + times[times.length - 1]); qs.push(qs[0]) }
  return qTrack(node, times, qs)
}
const bobAnim = (node: string, baseY: number, poses: [number, number][], loop: boolean) => {
  const times = poses.map((pp) => pp[0])
  const vs = poses.map((pp) => [0, baseY + pp[1], 0] as [number, number, number])
  if (loop) { times.push(poses[0][0] + times[times.length - 1]); vs.push(vs[0]) }
  return pTrack(node, times, vs)
}

interface GaitSpec {
  duration: number
  stride: number
  kneeSwing: number
  kneeBase: number
  armSwing: number
  elbowBase: number
  elbowSwing: number
  bob: number
  lean: number
  yaw: number
  footRoll: number // toe-off heel-rise amplitude
}

function kneeAngle(ph: number, s: GaitSpec): number {
  const swing = Math.max(0, Math.sin(Math.PI * ((ph - 0.5) / 0.5))) ** 1.25
  const load = 0.3 * Math.exp(-(((ph - 0.12) / 0.09) ** 2))
  return s.kneeBase + s.kneeSwing * swing + s.kneeSwing * 0.3 * load
}

/** foot pitch over one leg cycle (Foot bone, about the ankle):
 * heel strike (toe-up) → flat → push-off (heel-rise, shared with the Toe) → swing clear.
 * Push-off pitch is SPLIT with the Toe joint (MTP break) — foot 55%, toe 45%. */
function footPitch(ph: number, s: GaitSpec): number {
  if (ph < 0.06) return -0.16 * (1 - ph / 0.06)      // heel strike — toe up
  if (ph < 0.34) return 0                            // flat stance
  if (ph < 0.52) {                                   // push-off — heel rises
    const t = (ph - 0.34) / 0.18
    return s.footRoll * 0.55 * Math.sin(t * Math.PI * 0.6)
  }
  if (ph < 0.72) return -0.10                        // early swing dorsiflexion
  return -0.02                                       // reach
}

/** toe (MTP) pitch relative to the Foot — continues the push-off break so the
 * forefoot rolls instead of the whole rigid foot pivoting at the ankle. */
function toePitch(ph: number, s: GaitSpec): number {
  if (ph < 0.06) return 0.05                         // toes relaxed at heel strike
  if (ph < 0.34) return 0                            // flat stance
  if (ph < 0.52) {
    const t = (ph - 0.34) / 0.18
    return s.footRoll * 0.45 * Math.sin(t * Math.PI * 0.6)
  }
  if (ph < 0.72) return -0.05                        // trail in swing
  return 0
}

function gaitClip(name: string, s: GaitSpec, p: Prop): THREE.AnimationClip {
  const N = 18
  const legL: [number, number, number, number][] = []
  const legR: [number, number, number, number][] = []
  const kneeL: [number, number, number, number][] = []
  const kneeR: [number, number, number, number][] = []
  const footL: [number, number, number, number][] = []
  const footR: [number, number, number, number][] = []
  const toeL: [number, number, number, number][] = []
  const toeR: [number, number, number, number][] = []
  const armL: [number, number, number, number][] = []
  const armR: [number, number, number, number][] = []
  const elbL: [number, number, number, number][] = []
  const elbR: [number, number, number, number][] = []
  const torso: [number, number, number, number][] = []
  const head: [number, number, number, number][] = []
  const neck: [number, number, number, number][] = []
  const hipsRot: [number, number, number, number][] = []
  const bob: [number, number][] = []
  for (let i = 0; i < N; i++) {
    const t = (i / N) * s.duration
    const ph = i / N
    const wv = 2 * Math.PI * ph
    const c = Math.cos(wv)
    const sn = Math.sin(wv)
    legL.push([t, -s.stride * c, 0, 0])
    legR.push([t, s.stride * c, 0, 0])
    kneeL.push([t, kneeAngle(ph, s), 0, 0])
    kneeR.push([t, kneeAngle((ph + 0.5) % 1, s), 0, 0])
    footL.push([t, footPitch(ph, s), 0, 0])
    footR.push([t, footPitch((ph + 0.5) % 1, s), 0, 0])
    toeL.push([t, toePitch(ph, s), 0, 0])
    toeR.push([t, toePitch((ph + 0.5) % 1, s), 0, 0])
    armL.push([t, s.armSwing * c, 0, 0.06 + 0.03 * sn])
    armR.push([t, -s.armSwing * c, 0, -0.06 + 0.03 * sn])
    elbL.push([t, -(s.elbowBase + s.elbowSwing * Math.max(0, -c) ** 1.4), 0, 0])
    elbR.push([t, -(s.elbowBase + s.elbowSwing * Math.max(0, c) ** 1.4), 0, 0])
    torso.push([t, s.lean + 0.016 * Math.sin(2 * wv), s.yaw * sn, 0])
    head.push([t, -0.42 * s.lean + 0.012 * Math.sin(2 * wv + 0.5), -0.6 * s.yaw * sn, 0])
    neck.push([t, -0.18 * s.lean, -0.25 * s.yaw * sn, 0])
    hipsRot.push([t, 0, -0.5 * s.yaw * sn, 0.028 * c])
    bob.push([t, s.bob * (0.5 - 0.5 * Math.cos(2 * wv)) - p.legR1 * 0.06])
  }
  return new THREE.AnimationClip(name, s.duration, [
    qAnim('Torso', torso, true), qAnim('Head', head, true), qAnim('Neck', neck, true),
    qAnim('Hips', hipsRot, true),
    qAnim('LegL', legL, true), qAnim('LegR', legR, true),
    qAnim('KneeL', kneeL, true), qAnim('KneeR', kneeR, true),
    qAnim('FootL', footL, true), qAnim('FootR', footR, true),
    qAnim('ToeL', toeL, true), qAnim('ToeR', toeR, true),
    qAnim('ArmL', armL, true), qAnim('ArmR', armR, true),
    qAnim('ElbowL', elbL, true), qAnim('ElbowR', elbR, true),
    bobAnim('Hips', p.hipY, bob, true),
  ])
}

function buildClips(p: Prop): THREE.AnimationClip[] {
  const H = 'Hips', T = 'Torso', HD = 'Head', NK = 'Neck'
  const AL = 'ArmL', AR = 'ArmR', EL = 'ElbowL', ER = 'ElbowR'
  const LL = 'LegL', LR = 'LegR', KL = 'KneeL', KR = 'KneeR', FL = 'FootL', FR = 'FootR'
  const TL = 'ToeL', TR = 'ToeR'
  const hipY = p.hipY
  const clips: THREE.AnimationClip[] = []

  // walk — adult ~0.95s cycle, child quicker (footRoll now split foot+toe)
  const walkDur = p === CHILD ? 0.75 : p === FEMALE ? 0.88 : 0.95
  clips.push(gaitClip('walk', {
    duration: walkDur, stride: 0.52, kneeSwing: 0.72, kneeBase: 0.10,
    armSwing: 0.38, elbowBase: 0.22, elbowSwing: 0.34,
    bob: 0.024, lean: 0.05, yaw: 0.09, footRoll: 0.44,
  }, p))

  // run — runner arm carriage: elbows stay ~90° so forearms stay forward-flat
  const runDur = p === CHILD ? 0.48 : 0.58
  clips.push(gaitClip('run', {
    duration: runDur, stride: 0.92, kneeSwing: 1.42, kneeBase: 0.20,
    armSwing: 0.65, elbowBase: 0.95, elbowSwing: 0.25,
    bob: 0.052, lean: 0.24, yaw: 0.15, footRoll: 0.6,
  }, p))

  // idle — weight shift, breath-posture on Torso (Chest is runtime-owned), sway
  clips.push(new THREE.AnimationClip('idle', 4.4, [
    qAnim(T, [[0, 0.025, 0, 0], [1.4, 0.045, 0.02, 0.008], [2.6, 0.03, 0, -0.008], [4.4, 0.025, 0, 0]], false),
    qAnim(HD, [[0, 0.01, 0, 0], [1.2, 0.04, 0.07, 0], [2.4, -0.02, -0.06, 0], [3.4, 0.02, 0.04, 0], [4.4, 0.01, 0, 0]], false),
    qAnim(NK, [[0, 0, 0, 0], [1.2, 0.015, 0.03, 0], [2.4, -0.01, -0.025, 0], [4.4, 0, 0, 0]], false),
    qAnim(AL, [[0, 0.06, 0, 0.055], [2.2, 0.11, 0, 0.075], [4.4, 0.06, 0, 0.055]], false),
    qAnim(AR, [[0, 0.06, 0, -0.055], [2.2, 0.11, 0, -0.075], [4.4, 0.06, 0, -0.055]], false),
    qAnim(EL, [[0, -0.14, 0, 0], [2.2, -0.19, 0, 0], [4.4, -0.14, 0, 0]], false),
    qAnim(ER, [[0, -0.14, 0, 0], [2.2, -0.19, 0, 0], [4.4, -0.14, 0, 0]], false),
    qAnim(H, [[0, 0, 0, 0.012], [2.2, 0, 0.008, -0.01], [4.4, 0, 0, 0.012]], false),
    bobAnim(H, hipY, [[0, 0], [1.1, 0.008], [2.2, 0], [3.3, 0.008], [4.4, 0]], false),
  ]))

  // jump — crouch → launch → apex tuck
  clips.push(new THREE.AnimationClip('jump', 0.85, [
    qAnim(T, [[0, 0, 0, 0], [0.16, 0.30, 0, 0], [0.38, 0.05, 0, 0], [0.85, 0.10, 0, 0]], false),
    qAnim(KL, [[0, 0.10, 0, 0], [0.16, 1.45, 0, 0], [0.38, 0.45, 0, 0], [0.85, 0.85, 0, 0]], false),
    qAnim(KR, [[0, 0.10, 0, 0], [0.16, 1.15, 0, 0], [0.38, 0.7, 0, 0], [0.85, 0.8, 0, 0]], false),
    qAnim(LL, [[0, 0, 0, 0], [0.16, -0.8, 0, 0], [0.38, -0.45, 0, 0], [0.85, -0.5, 0, 0]], false),
    qAnim(LR, [[0, 0, 0, 0], [0.16, -0.5, 0, 0], [0.38, 0.32, 0, 0], [0.85, 0.28, 0, 0]], false),
    qAnim(FL, [[0, 0, 0, 0], [0.16, 0.25, 0, 0], [0.38, -0.3, 0, 0], [0.85, -0.2, 0, 0]], false),
    qAnim(FR, [[0, 0, 0, 0], [0.16, 0.2, 0, 0], [0.38, -0.25, 0, 0], [0.85, -0.18, 0, 0]], false),
    qAnim(TL, [[0, 0, 0, 0], [0.16, 0.12, 0, 0], [0.38, -0.12, 0, 0], [0.85, -0.08, 0, 0]], false),
    qAnim(TR, [[0, 0, 0, 0], [0.16, 0.1, 0, 0], [0.38, -0.1, 0, 0], [0.85, -0.07, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.16, 0.5, 0, 0], [0.5, -2.6, 0, 0], [0.85, -2.6, 0, 0]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.16, 0.5, 0, 0], [0.5, -2.6, 0, 0], [0.85, -2.6, 0, 0]], false),
    qAnim(EL, [[0, -0.14, 0, 0], [0.16, -0.45, 0, 0], [0.5, -0.15, 0, 0], [0.85, -0.15, 0, 0]], false),
    qAnim(ER, [[0, -0.14, 0, 0], [0.16, -0.45, 0, 0], [0.5, -0.15, 0, 0], [0.85, -0.15, 0, 0]], false),
    bobAnim(H, hipY, [[0, 0], [0.16, -0.16], [0.38, 0.05], [0.85, 0.05]], false),
  ]))

  // doubleJump — mid-air tuck flip (plays via the driver's doubleJump→jump fallback)
  clips.push(new THREE.AnimationClip('doubleJump', 0.7, [
    qAnim(T, [[0, 0.05, 0, 0], [0.22, -0.35, 0, 0], [0.45, -0.15, 0, 0], [0.7, 0.1, 0, 0]], false),
    qAnim(KL, [[0, 0.4, 0, 0], [0.22, 1.9, 0, 0], [0.45, 1.5, 0, 0], [0.7, 0.7, 0, 0]], false),
    qAnim(KR, [[0, 0.4, 0, 0], [0.22, 1.9, 0, 0], [0.45, 1.5, 0, 0], [0.7, 0.7, 0, 0]], false),
    qAnim(LL, [[0, -0.3, 0, 0], [0.22, -1.1, 0, 0], [0.45, -0.7, 0, 0], [0.7, -0.35, 0, 0]], false),
    qAnim(LR, [[0, -0.3, 0, 0], [0.22, -1.1, 0, 0], [0.45, -0.7, 0, 0], [0.7, -0.35, 0, 0]], false),
    qAnim(AL, [[0, -1.2, 0, 0.4], [0.22, -2.9, 0, 0.5], [0.7, -2.4, 0, 0.4]], false),
    qAnim(AR, [[0, -1.2, 0, -0.4], [0.22, -2.9, 0, -0.5], [0.7, -2.4, 0, -0.4]], false),
    qAnim(HD, [[0, 0, 0, 0], [0.22, -0.3, 0, 0], [0.7, 0.1, 0, 0]], false),
    bobAnim(H, hipY, [[0, 0], [0.22, 0.04], [0.7, 0.02]], false),
  ]))

  // fall — airborne flail, knees up
  clips.push(new THREE.AnimationClip('fall', 1.2, [
    qAnim(T, [[0, -0.13, 0, 0], [0.6, -0.19, 0, 0.06], [1.2, -0.13, 0, 0]], false),
    qAnim(HD, [[0, -0.26, 0, 0], [1.2, -0.26, 0, 0]], false),
    qAnim(AL, [[0, -2.3, 0, 0.34], [0.3, -2.7, 0, 0.52], [0.6, -2.3, 0, 0.34], [0.9, -2.7, 0, 0.52], [1.2, -2.3, 0, 0.34]], false),
    qAnim(AR, [[0, -2.3, 0, -0.34], [0.3, -2.7, 0, -0.52], [0.6, -2.3, 0, -0.34], [0.9, -2.7, 0, -0.52], [1.2, -2.3, 0, -0.34]], false),
    qAnim(EL, [[0, -0.85, 0, 0], [0.6, -1.1, 0, 0], [1.2, -0.85, 0, 0]], false),
    qAnim(ER, [[0, -0.85, 0, 0], [0.6, -1.1, 0, 0], [1.2, -0.85, 0, 0]], false),
    qAnim(LL, [[0, -0.42, 0, 0], [0.6, -0.14, 0, 0], [1.2, -0.42, 0, 0]], false),
    qAnim(LR, [[0, 0.28, 0, 0], [0.6, 0.06, 0, 0], [1.2, 0.28, 0, 0]], false),
    qAnim(KL, [[0, 1.05, 0, 0], [0.6, 0.5, 0, 0], [1.2, 1.05, 0, 0]], false),
    qAnim(KR, [[0, 0.7, 0, 0], [0.6, 0.32, 0, 0], [1.2, 0.7, 0, 0]], false),
    qAnim(FL, [[0, -0.2, 0, 0], [1.2, -0.2, 0, 0]], false),
    qAnim(FR, [[0, -0.15, 0, 0], [1.2, -0.15, 0, 0]], false),
  ]))

  // land — deep absorb → rise
  clips.push(new THREE.AnimationClip('land', 0.5, [
    qAnim(T, [[0, 0.44, 0, 0], [0.5, 0.05, 0, 0]], false),
    qAnim(KL, [[0, 1.65, 0, 0], [0.5, 0.10, 0, 0]], false),
    qAnim(KR, [[0, 1.55, 0, 0], [0.5, 0.10, 0, 0]], false),
    qAnim(LL, [[0, -1.02, 0, 0], [0.5, -0.05, 0, 0]], false),
    qAnim(LR, [[0, -0.92, 0, 0], [0.5, -0.05, 0, 0]], false),
    qAnim(FL, [[0, 0.15, 0, 0], [0.5, 0, 0, 0]], false),
    qAnim(FR, [[0, 0.15, 0, 0], [0.5, 0, 0, 0]], false),
    qAnim(TL, [[0, 0.08, 0, 0], [0.5, 0, 0, 0]], false),
    qAnim(TR, [[0, 0.08, 0, 0], [0.5, 0, 0, 0]], false),
    qAnim(AL, [[0, -1.3, 0, 0.44], [0.5, 0.05, 0, 0]], false),
    qAnim(AR, [[0, -1.3, 0, -0.44], [0.5, 0.05, 0, -0]], false),
    qAnim(EL, [[0, -0.5, 0, 0], [0.5, -0.14, 0, 0]], false),
    qAnim(ER, [[0, -0.5, 0, 0], [0.5, -0.14, 0, 0]], false),
    bobAnim(H, hipY, [[0, -0.27], [0.5, 0]], false),
  ]))

  // slide — ground slide, front leg extended
  clips.push(new THREE.AnimationClip('slide', 0.8, [
    qAnim(T, [[0, -1.12, 0, 0], [0.4, -1.06, 0, 0.05], [0.8, -1.12, 0, 0]], false),
    qAnim(HD, [[0, 0.44, 0, 0], [0.8, 0.44, 0, 0]], false),
    qAnim(LL, [[0, 0.45, 0, 0], [0.8, 0.45, 0, 0]], false),
    qAnim(KL, [[0, 0.16, 0, 0], [0.8, 0.16, 0, 0]], false),
    qAnim(LR, [[0, -0.18, 0, 0], [0.8, -0.18, 0, 0]], false),
    qAnim(KR, [[0, 0.95, 0, 0], [0.8, 0.95, 0, 0]], false),
    qAnim(FL, [[0, -0.25, 0, 0], [0.8, -0.25, 0, 0]], false),
    qAnim(FR, [[0, 0.2, 0, 0], [0.8, 0.2, 0, 0]], false),
    qAnim(AL, [[0, -2.9, 0, 0.26], [0.8, -2.9, 0, 0.26]], false),
    qAnim(EL, [[0, -0.3, 0, 0], [0.8, -0.3, 0, 0]], false),
    qAnim(AR, [[0, -2.7, 0, -0.26], [0.8, -2.7, 0, -0.26]], false),
    qAnim(ER, [[0, -0.36, 0, 0], [0.8, -0.36, 0, 0]], false),
    bobAnim(H, hipY * 0.62, [[0, 0], [0.8, 0]], false),
  ]))

  // hit — stagger, arms up defensively
  clips.push(new THREE.AnimationClip('hit', 0.6, [
    qAnim(T, [[0, 0, 0, 0], [0.15, -0.58, 0, 0.12], [0.6, -0.3, 0, 0]], false),
    qAnim(HD, [[0, 0, 0, 0], [0.2, -0.34, 0.22, 0], [0.45, -0.16, -0.15, 0], [0.6, -0.2, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.2, -1.42, 0, 0.74], [0.6, -0.62, 0, 0.42]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.2, -1.42, 0, -0.74], [0.6, -0.62, 0, -0.42]], false),
    qAnim(EL, [[0, -0.14, 0, 0], [0.2, -1.05, 0, 0], [0.6, -0.55, 0, 0]], false),
    qAnim(ER, [[0, -0.14, 0, 0], [0.2, -1.05, 0, 0], [0.6, -0.55, 0, 0]], false),
    qAnim(LL, [[0, 0, 0, 0], [0.2, 0.36, 0, 0], [0.6, 0.2, 0, 0]], false),
    qAnim(LR, [[0, 0, 0, 0], [0.2, -0.32, 0, 0], [0.6, -0.15, 0, 0]], false),
    qAnim(KL, [[0, 0.1, 0, 0], [0.2, 0.9, 0, 0], [0.6, 0.55, 0, 0]], false),
    qAnim(KR, [[0, 0.1, 0, 0], [0.2, 0.7, 0, 0], [0.6, 0.45, 0, 0]], false),
    bobAnim(H, hipY, [[0, 0], [0.2, -0.1], [0.6, -0.02]], false),
  ]))

  // detained — hands behind back, head bowed
  clips.push(new THREE.AnimationClip('detained', 2.2, [
    qAnim(T, [[0, 0.13, 0, 0], [1.1, 0.15, 0, 0], [2.2, 0.13, 0, 0]], false),
    qAnim(HD, [[0, 0.36, 0, 0], [0.7, 0.44, 0.08, 0], [1.6, 0.4, -0.08, 0], [2.2, 0.36, 0, 0]], false),
    qAnim(AL, [[0, 0.58, 0, 0.52], [2.2, 0.58, 0, 0.52]], false),
    qAnim(AR, [[0, 0.58, 0, -0.52], [2.2, 0.58, 0, -0.52]], false),
    qAnim(EL, [[0, -0.28, 0, 0], [2.2, -0.28, 0, 0]], false),
    qAnim(ER, [[0, -0.28, 0, 0], [2.2, -0.28, 0, 0]], false),
    qAnim(KL, [[0, 0.16, 0, 0], [2.2, 0.16, 0, 0]], false),
    qAnim(KR, [[0, 0.13, 0, 0], [2.2, 0.13, 0, 0]], false),
    qAnim(LL, [[0, 0.06, 0, 0], [2.2, 0.06, 0, 0]], false),
    qAnim(LR, [[0, -0.06, 0, 0], [2.2, -0.06, 0, 0]], false),
  ]))

  // recover — get up from crouch
  clips.push(new THREE.AnimationClip('recover', 0.9, [
    qAnim(T, [[0, 0.5, 0, 0], [0.55, 0.13, 0, 0], [0.9, 0.03, 0, 0]], false),
    qAnim(KL, [[0, 1.8, 0, 0], [0.55, 0.48, 0, 0], [0.9, 0.10, 0, 0]], false),
    qAnim(KR, [[0, 1.7, 0, 0], [0.55, 0.44, 0, 0], [0.9, 0.10, 0, 0]], false),
    qAnim(LL, [[0, -1.12, 0, 0], [0.55, -0.3, 0, 0], [0.9, 0, 0, 0]], false),
    qAnim(LR, [[0, -1.02, 0, 0], [0.55, -0.26, 0, 0], [0.9, 0, 0, 0]], false),
    qAnim(AL, [[0, -0.82, 0, 0.32], [0.9, 0.05, 0, 0]], false),
    qAnim(AR, [[0, -0.82, 0, -0.32], [0.9, 0.05, 0, -0]], false),
    qAnim(EL, [[0, -0.48, 0, 0], [0.9, -0.15, 0, 0]], false),
    qAnim(ER, [[0, -0.48, 0, 0], [0.9, -0.15, 0, 0]], false),
    bobAnim(H, hipY, [[0, -0.3], [0.55, -0.06], [0.9, 0]], false),
  ]))

  // celebrate — fists up hop
  clips.push(new THREE.AnimationClip('celebrate', 1.5, [
    qAnim(T, [[0, -0.07, 0, 0], [0.75, 0, 0, 0], [1.5, -0.07, 0, 0]], false),
    qAnim(HD, [[0, -0.16, 0, 0], [1.5, -0.16, 0, 0]], false),
    qAnim(AL, [[0, -2.9, 0, 0.34], [0.75, -2.6, 0, 0.5], [1.5, -2.9, 0, 0.34]], false),
    qAnim(AR, [[0, -2.9, 0, -0.34], [0.75, -2.6, 0, -0.5], [1.5, -2.9, 0, -0.34]], false),
    qAnim(EL, [[0, -0.22, 0, 0], [0.75, -0.4, 0, 0], [1.5, -0.22, 0, 0]], false),
    qAnim(ER, [[0, -0.22, 0, 0], [0.75, -0.4, 0, 0], [1.5, -0.22, 0, 0]], false),
    qAnim(KL, [[0, 0.12, 0, 0], [0.3, 0.8, 0, 0], [0.75, 0.1, 0, 0], [1.05, 0.8, 0, 0], [1.5, 0.12, 0, 0]], false),
    qAnim(KR, [[0, 0.12, 0, 0], [0.3, 0.8, 0, 0], [0.75, 0.1, 0, 0], [1.05, 0.8, 0, 0], [1.5, 0.12, 0, 0]], false),
    bobAnim(H, hipY, [[0, 0], [0.35, 0.13], [0.75, 0], [1.1, 0.13], [1.5, 0]], false),
  ]))

  // throw — elbow-cocked windup → whip release
  clips.push(new THREE.AnimationClip('throw', 0.7, [
    qAnim(T, [[0, 0, 0, 0], [0.2, 0.19, 0, -0.27], [0.42, 0.29, 0, 0.19], [0.7, 0.05, 0, 0]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.2, 1.02, 0, 0], [0.42, -2.42, 0, 0], [0.7, -1.22, 0, 0]], false),
    qAnim(ER, [[0, -0.14, 0, 0], [0.2, -1.85, 0, 0], [0.42, -0.2, 0, 0], [0.7, -0.3, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.42, 0.44, 0, 0], [0.7, 0, 0, 0]], false),
    qAnim(EL, [[0, -0.14, 0, 0], [0.42, -0.44, 0, 0], [0.7, -0.14, 0, 0]], false),
    qAnim(KL, [[0, 0.1, 0, 0], [0.2, 0.4, 0, 0], [0.42, 0.3, 0, 0], [0.7, 0.13, 0, 0]], false),
    qAnim(KR, [[0, 0.1, 0, 0], [0.2, 0.34, 0, 0], [0.42, 0.55, 0, 0], [0.7, 0.17, 0, 0]], false),
    bobAnim(H, hipY, [[0, 0], [0.42, 0.03], [0.7, 0]], false),
  ]))

  // heal — drink: elbows fold up to the face
  clips.push(new THREE.AnimationClip('heal', 1.0, [
    qAnim(T, [[0, 0, 0, 0], [0.35, -0.08, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(HD, [[0, 0, 0, 0], [0.35, 0.11, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(AL, [[0, 0, 0, 0], [0.3, -1.72, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(AR, [[0, 0, 0, 0], [0.3, -1.72, 0, 0], [1.0, 0, 0, 0]], false),
    qAnim(EL, [[0, -0.14, 0, 0], [0.3, -1.0, 0, 0], [1.0, -0.14, 0, 0]], false),
    qAnim(ER, [[0, -0.14, 0, 0], [0.3, -1.0, 0, 0], [1.0, -0.14, 0, 0]], false),
  ]))

  return clips
}

// ============================================================================
// 8. ASSEMBLY + EXPORT
// ============================================================================
function buildVariant(g: Gender): { root: THREE.Group; clips: THREE.AnimationClip[] } {
  const p = g === 'male' ? MALE : g === 'female' ? FEMALE : CHILD
  const M = makeMaterials(g)
  const root = new THREE.Group()
  root.name = `VoteChorHuman${g[0].toUpperCase()}${g.slice(1)}`

  const skel = buildSkeleton(p)
  const armature = new THREE.Group()
  armature.name = 'Armature'
  for (const b of skel.bones) if (!b.parent) armature.add(b)
  root.add(armature)
  root.updateMatrixWorld(true)

  const segs = buildSegments(p, skel.world)
  const { skinned, rigid } = buildBodyAndClothes(p, M, skel, segs)

  // skinned meshes bind to the shared skeleton
  const skeleton = new THREE.Skeleton(skel.bones)
  const identity = new THREE.Matrix4()
  for (const sm of skinned) {
    root.add(sm)
    sm.bind(skeleton, identity)
    sm.normalizeSkinWeights()
  }
  // head group rides the Head bone
  const headGroup = buildHead(p, M)
  skel.bones[skel.index.Head].add(headGroup)

  root.traverse((o) => { o.castShadow = false; o.receiveShadow = false })
  const clips = buildClips(p)
  return { root, clips }
}

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

const t0 = Date.now()
const timer = setInterval(() => {
  if (Date.now() - t0 > 20000) { console.error('TIMEOUT'); process.exit(1) }
}, 100)

const maleV = buildVariant('male')
const femaleV = buildVariant('female')
const childV = buildVariant('child')

Promise.all([
  exportGlb(maleV.root, maleV.clips, 'public/models/votechor-human-male.glb'),
  exportGlb(femaleV.root, femaleV.clips, 'public/models/votechor-human-female.glb'),
  exportGlb(childV.root, childV.clips, 'public/models/votechor-human-child.glb'),
])
  .then(() => { clearInterval(timer); console.log('DONE'); process.exit(0) })
  .catch((e) => { console.error('FAIL', e); process.exit(1) })
