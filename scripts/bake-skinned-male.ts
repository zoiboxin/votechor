// Bake a GENUINELY RIGGED male avatar GLB from two source assets:
//   1. public/models/votechor-male.glb      — the textured promptplay avatar
//      (10 static meshes, baked PNGs, NO skin, NO clips — verified)
//   2. public/models/votechor-male-rigged.glb — the project's authored animation
//      puppet (13 clips: idle/walk/run/jump/fall/land/slide/hit/detained/recover/
//      celebrate/throw/heal driving 6 joint nodes, NO skin — verified)
//
// Output: public/models/votechor-male-skinned.glb — the SAME textured appearance,
// bound to a fitted 15-joint humanoid skeleton (computed distance-to-segment skin
// weights), carrying the 13 authored clips (remapped to the fitted joints, hips
// translation rescaled 0.940→0.950) PLUS synthesized knee/elbow flexion channels
// (the source puppet has no elbow/knee joints — straight-limb swings). After this
// bake the game plays REAL skeletal animation through the existing GLBAnimDriver.
//
// Usage: bun scripts/bake-skinned-male.ts [--check]
import * as fs from 'fs'
import * as THREE from 'three'

// ---------- glb reading ----------
function readGlb(file: string) {
  const buf = fs.readFileSync(file)
  const jsonLen = buf.readUInt32LE(12)
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
  const binStart = 20 + jsonLen + 8
  const bin = buf.subarray(binStart)
  return { json, bin }
}
const src = readGlb('public/models/votechor-male.glb')
const rig = readGlb('public/models/votechor-male-rigged.glb')

type J = Record<string, unknown>
const srcJson = src.json as {
  meshes: { name?: string; primitives: { attributes: Record<string, number> }[] }[]
  nodes: J[]
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[]
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number }[]
  images?: J[]
  materials?: J[]
  textures?: J[]
  samplers?: J[]
  scenes: { nodes: number[] }[]
}
const rigJson = rig.json as {
  nodes: { name?: string; children?: number[] }[]
  animations: { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number; interpolation?: string }[] }[]
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[]
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number }[]
}

function readF32(g: typeof srcJson, ai: number): Float32Array {
  const a = g.accessors[ai]
  const bv = g.bufferViews[a.bufferView]
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const comp = a.type === 'VEC4' ? 4 : a.type === 'VEC3' ? 3 : a.type === 'SCALAR' ? 1 : 0
  const out = new Float32Array(a.count * comp)
  for (let i = 0; i < out.length; i++) out[i] = src.bin.readFloatLE(off + i * 4)
  return out
}
function readRigF32(ai: number): Float32Array {
  const a = rigJson.accessors[ai]
  const bv = rigJson.bufferViews[a.bufferView]
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const comp = a.type === 'VEC4' ? 4 : a.type === 'VEC3' ? 3 : a.type === 'SCALAR' ? 1 : 0
  const out = new Float32Array(a.count * comp)
  for (let i = 0; i < out.length; i++) out[i] = rig.bin.readFloatLE(off + i * 4)
  return out
}

// ---------- fitted skeleton (world rest joints; identity rotations) ----------
// Landmarks measured from votechor-male.glb (scripts/measure-avatar.ts):
//   hip line 0.95 · shoulders (±0.215, 1.547) · hands (±0.374, ~0.83) ·
//   head/neck 1.58 (head spans 1.583..1.957) · feet y=0 · pants |x|≤0.20
const JOINT_NAMES = ['Hips', 'Torso', 'Head', 'ArmL', 'ElbowL', 'HandL', 'ArmR', 'ElbowR', 'HandR', 'LegL', 'KneeL', 'FootL', 'LegR', 'KneeR', 'FootR'] as const
type JointName = (typeof JOINT_NAMES)[number]
const jointWorld: Record<JointName, THREE.Vector3> = {
  Hips: new THREE.Vector3(0, 0.95, 0),
  Torso: new THREE.Vector3(0, 0.95, 0), // rotates about the hip line (as authored)
  Head: new THREE.Vector3(0, 1.58, 0.03),
  ArmL: new THREE.Vector3(-0.215, 1.547, 0),
  ElbowL: new THREE.Vector3(-0.29, 1.22, 0),
  HandL: new THREE.Vector3(-0.355, 0.95, 0),
  ArmR: new THREE.Vector3(0.215, 1.547, 0),
  ElbowR: new THREE.Vector3(0.29, 1.22, 0),
  HandR: new THREE.Vector3(0.355, 0.95, 0),
  LegL: new THREE.Vector3(-0.088, 0.95, 0),
  KneeL: new THREE.Vector3(-0.09, 0.5, 0),
  FootL: new THREE.Vector3(-0.09, 0.06, 0.03),
  LegR: new THREE.Vector3(0.088, 0.95, 0),
  KneeR: new THREE.Vector3(0.09, 0.5, 0),
  FootR: new THREE.Vector3(0.09, 0.06, 0.03),
}
// local translations rel parent (hierarchy mirrors the authored puppet)
const jointParent: Record<JointName, JointName | 'Root'> = {
  Hips: 'Root', Torso: 'Hips', Head: 'Torso',
  ArmL: 'Torso', ElbowL: 'ArmL', HandL: 'ElbowL',
  ArmR: 'Torso', ElbowR: 'ArmR', HandR: 'ElbowR',
  LegL: 'Hips', KneeL: 'LegL', FootL: 'KneeL',
  LegR: 'Hips', KneeR: 'LegR', FootR: 'KneeR',
}
const jointLocal: Record<JointName, THREE.Vector3> = {} as never
for (const n of JOINT_NAMES) {
  const p = jointParent[n]
  jointLocal[n] = jointWorld[n].clone().sub(p === 'Root' ? new THREE.Vector3() : jointWorld[p])
}

// skin segments: [joint, from, to] — distance-to-segment drives the weights
const SEGMENTS: [JointName, THREE.Vector3, THREE.Vector3][] = [
  ['Hips', new THREE.Vector3(0, 0.84, 0), new THREE.Vector3(0, 1.02, 0)],
  ['Torso', new THREE.Vector3(0, 1.02, 0), new THREE.Vector3(0, 1.52, 0)],
  ['Head', new THREE.Vector3(0, 1.58, 0.03), new THREE.Vector3(0, 1.92, 0.06)],
  ['ArmL', new THREE.Vector3(-0.215, 1.547, 0), new THREE.Vector3(-0.29, 1.22, 0)],
  ['ElbowL', new THREE.Vector3(-0.29, 1.22, 0), new THREE.Vector3(-0.355, 0.97, 0)],
  ['HandL', new THREE.Vector3(-0.355, 0.97, 0), new THREE.Vector3(-0.374, 0.83, 0)],
  ['ArmR', new THREE.Vector3(0.215, 1.547, 0), new THREE.Vector3(0.29, 1.22, 0)],
  ['ElbowR', new THREE.Vector3(0.29, 1.22, 0), new THREE.Vector3(0.355, 0.97, 0)],
  ['HandR', new THREE.Vector3(0.355, 0.97, 0), new THREE.Vector3(0.374, 0.83, 0)],
  ['LegL', new THREE.Vector3(-0.088, 0.95, 0), new THREE.Vector3(-0.09, 0.5, 0)],
  ['KneeL', new THREE.Vector3(-0.09, 0.5, 0), new THREE.Vector3(-0.09, 0.1, 0)],
  ['FootL', new THREE.Vector3(-0.09, 0.1, 0), new THREE.Vector3(-0.09, 0.0, 0.1)],
  ['LegR', new THREE.Vector3(0.088, 0.95, 0), new THREE.Vector3(0.09, 0.5, 0)],
  ['KneeR', new THREE.Vector3(0.09, 0.5, 0), new THREE.Vector3(0.09, 0.1, 0)],
  ['FootR', new THREE.Vector3(0.09, 0.1, 0), new THREE.Vector3(0.09, 0.0, 0.1)],
]
const jointIndex: Record<string, number> = {}
JOINT_NAMES.forEach((n, i) => { jointIndex[n] = i })

function distSqToSeg(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a)
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1)
  return p.distanceToSquared(a.clone().addScaledVector(ab, t))
}

// ---------- per-vertex skin weights for one mesh ----------
function skinMesh(positions: Float32Array): { joints: Uint8Array; weights: Float32Array } {
  const n = positions.length / 3
  const joints = new Uint8Array(n * 4)
  const weights = new Float32Array(n * 4)
  const p = new THREE.Vector3()
  const d2 = new Float32Array(SEGMENTS.length)
  for (let v = 0; v < n; v++) {
    p.set(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
    for (let s = 0; s < SEGMENTS.length; s++) d2[s] = distSqToSeg(p, SEGMENTS[s][1], SEGMENTS[s][2])
    // top-4 by weight = 1/(d2+eps)^2 (d^-4 falloff — firm but blendable)
    const best: { i: number; w: number }[] = []
    for (let s = 0; s < SEGMENTS.length; s++) {
      const w = 1 / Math.pow(d2[s] + 4e-4, 2)
      if (best.length < 4) { best.push({ i: s, w }); best.sort((a, b) => b.w - a.w) }
      else if (w > best[3].w) { best[3] = { i: s, w }; best.sort((a, b) => b.w - a.w) }
    }
    const sum = best.reduce((acc, x) => acc + x.w, 0) || 1
    for (let k = 0; k < 4; k++) {
      joints[v * 4 + k] = jointIndex[SEGMENTS[best[k].i][0]]
      weights[v * 4 + k] = k < best.length ? best[k].w / sum : 0
    }
  }
  return { joints, weights }
}

// ---------- buffer assembly ----------
const BIN_PAD = (4 - (src.bin.length % 4)) % 4
const BIN_BASE = src.bin.length + BIN_PAD // appended regions live after the original bin
const chunks: Buffer[] = []
let appended = 0
function push(data: ArrayBufferLike): { byteOffset: number; byteLength: number } {
  const aligned = Math.ceil(data.byteLength / 4) * 4
  chunks.push(Buffer.from(data))
  if (aligned !== data.byteLength) chunks.push(Buffer.alloc(aligned - data.byteLength))
  const r = { byteOffset: BIN_BASE + appended, byteLength: data.byteLength }
  appended += aligned
  return r
}
const newAccessors: unknown[] = []
const newBufferViews: unknown[] = []
function addView(arr: ArrayBufferLike, target?: number): number {
  const { byteOffset, byteLength } = push(arr)
  newBufferViews.push({ buffer: 0, byteOffset, byteLength, ...(target ? { target } : {}) })
  return (srcJson.bufferViews.length ?? 0) + newBufferViews.length - 1
}
function addAccessor(view: number, count: number, type: string, componentType: number): number {
  newAccessors.push({ bufferView: view, byteOffset: 0, componentType, count, type })
  return (srcJson.accessors?.length ?? 0) + newAccessors.length - 1
}

const CT_UBYTE = 5121, CT_FLOAT = 5126
// ---------- 1. skin every textured mesh ----------
const meshJointAcc: Record<string, number> = {}
const meshWeightAcc: Record<string, number> = {}
let totalVerts = 0
for (const mesh of srcJson.meshes) {
  const name = mesh.name ?? '?'
  const posAcc = mesh.primitives[0].attributes.POSITION
  const positions = readF32(srcJson, posAcc)
  totalVerts += positions.length / 3
  const { joints, weights } = skinMesh(positions)
  const jv = addView(joints.buffer, 34962)
  const wv = addView(weights.buffer, 34962)
  meshJointAcc[name] = addAccessor(jv, positions.length / 3, 'VEC4', CT_UBYTE)
  meshWeightAcc[name] = addAccessor(wv, positions.length / 3, 'VEC4', CT_FLOAT)
}

// ---------- 2. inverse bind matrices (translation-only bones) ----------
const ibm = new Float32Array(JOINT_NAMES.length * 16)
JOINT_NAMES.forEach((n, i) => {
  const m = new THREE.Matrix4().makeTranslation(-jointWorld[n].x, -jointWorld[n].y, -jointWorld[n].z)
  ibm.set(m.elements, i * 16)
})
const ibmView = addView(ibm.buffer)
const ibmAcc = addAccessor(ibmView, JOINT_NAMES.length, 'MAT4', CT_FLOAT)

// ---------- 3. copy authored clips + synthesize knee/elbow channels ----------
const SRC_NODE_COUNT = srcJson.nodes?.length ?? 0
const nameToRigNode: Record<string, number> = {}
rigJson.nodes.forEach((n, i) => { if (n.name) nameToRigNode[n.name] = i })
const HIPS_SCALE = 0.95 / 0.94 // authored hips baseline 0.940 → fitted 0.950

function sampleQuatTrack(times: Float32Array, quats: Float32Array, t: number, out: THREE.Quaternion) {
  if (t <= times[0]) { out.set(quats[0], quats[1], quats[2], quats[3]); return out }
  const last = times.length - 1
  if (t >= times[last]) { out.set(quats[last * 4], quats[last * 4 + 1], quats[last * 4 + 2], quats[last * 4 + 3]); return out }
  let i = 0
  while (i < last - 1 && times[i + 1] < t) i++
  const a = new THREE.Quaternion(quats[i * 4], quats[i * 4 + 1], quats[i * 4 + 2], quats[i * 4 + 3])
  const b = new THREE.Quaternion(quats[i * 4 + 4], quats[i * 4 + 5], quats[i * 4 + 6], quats[i * 4 + 7])
  const f = (t - times[i]) / Math.max(1e-6, times[i + 1] - times[i])
  out.copy(a).slerp(b, f)
  return out
}
/** pitch (X-angle, rad) of a down-hanging limb: +θ = swings backward */
function pitchOf(q: THREE.Quaternion): number {
  return Math.atan2(2 * (q.w * q.x), 1 - 2 * q.x * q.x)
}

interface SynthCfg { maxKnee: number; maxElbow: number; decayToKnee?: number; decayToElbow?: number; gait?: boolean }
const SYNTH: Record<string, SynthCfg> = {
  idle: { maxKnee: 4, maxElbow: 10 },
  walk: { maxKnee: 38, maxElbow: 26, gait: true },
  run: { maxKnee: 56, maxElbow: 38, gait: true },
  jump: { maxKnee: 42, maxElbow: 45 },
  fall: { maxKnee: 26, maxElbow: 35 },
  land: { maxKnee: 52, maxElbow: 26, decayToKnee: 8, decayToElbow: 12 },
  slide: { maxKnee: 66, maxElbow: 40 },
  hit: { maxKnee: 18, maxElbow: 20 },
  detained: { maxKnee: 12, maxElbow: 14 },
  recover: { maxKnee: 26, maxElbow: 18, decayToKnee: 6, decayToElbow: 10 },
  celebrate: { maxKnee: 10, maxElbow: 30 },
  throw: { maxKnee: 16, maxElbow: 40 },
  heal: { maxKnee: 12, maxElbow: 22 },
}

const newAnimations: unknown[] = []
for (const anim of rigJson.animations) {
  const channels: unknown[] = []
  const samplers: { input: number; output: number; interpolation: string }[] = []
  const addSampler = (times: Float32Array, values: Float32Array, type: string): number => {
    const tv = addView(times.buffer)
    const ti = addAccessor(tv, times.length, 'SCALAR', CT_FLOAT)
    const ov = addView(values.buffer)
    const oi = addAccessor(ov, values.length / (type === 'VEC4' ? 4 : 3), type, CT_FLOAT)
    samplers.push({ input: ti, output: oi, interpolation: 'LINEAR' })
    return samplers.length - 1
  }
  for (const ch of anim.channels) {
    const srcNode = rigJson.nodes[ch.target.node]
    const jName = srcNode?.name ?? ''
    const sampler = anim.samplers[ch.sampler]
    const times = readRigF32(sampler.input)
    const out = readRigF32(sampler.output)
    const nodeOf = (n: JointName) => SRC_NODE_COUNT + jointIndex[n]
    if (ch.target.path === 'translation' && jName === 'Hips') {
      const scaled = out.slice()
      for (let i = 0; i < scaled.length; i += 3) scaled[i + 1] *= HIPS_SCALE
      channels.push({ sampler: addSampler(times, scaled, 'VEC3'), target: { node: nodeOf('Hips'), path: 'translation' } })
    } else if (ch.target.path === 'rotation' && (jName in jointIndex)) {
      channels.push({ sampler: addSampler(times, out, 'VEC4'), target: { node: nodeOf(jName as JointName), path: 'rotation' } })
    }
    // meshes/other paths of the puppet asset are intentionally dropped
  }
  // ---- synthesized knee/elbow flexion (the puppet has no such joints) ----
  const cfg = SYNTH[anim.name] ?? { maxKnee: 12, maxElbow: 16 }
  const dur = (() => {
    let mx = 0
    for (const s of anim.samplers) { const t = readRigF32(s.input); mx = Math.max(mx, t[t.length - 1]) }
    return mx || 1
  })()
  const fps = 30, steps = Math.max(2, Math.ceil(dur * fps))
  const dt = dur / steps
  const times = new Float32Array(steps + 1)
  for (let i = 0; i <= steps; i++) times[i] = i * dt
  const q = new THREE.Quaternion()
  const legPitch: Record<'L' | 'R', number[]> = { L: [], R: [] }
  const armPitch: Record<'L' | 'R', number[]> = { L: [], R: [] }
  const rigNodeOf = (nm: string) => nameToRigNode[nm]
  void rigNodeOf
  const samplerOf = (nm: string) => {
    const ch = anim.channels.find((c) => rigJson.nodes[c.target.node]?.name === nm && c.target.path === 'rotation')
    return ch ? anim.samplers[ch.sampler] : null
  }
  for (const side of ['L', 'R'] as const) {
    for (let i = 0; i <= steps; i++) {
      const ls = samplerOf(`Leg${side}`)
      legPitch[side][i] = ls ? pitchOf(sampleQuatTrack(readRigF32(ls.input), readRigF32(ls.output), times[i], q)) : 0
      const as = samplerOf(`Arm${side}`)
      armPitch[side][i] = as ? pitchOf(sampleQuatTrack(readRigF32(as.input), readRigF32(as.output), times[i], q)) : 0
    }
  }
  const kneel: Record<'L' | 'R', Float32Array> = { L: new Float32Array((steps + 1) * 4), R: new Float32Array((steps + 1) * 4) }
  const elbow: Record<'L' | 'R', Float32Array> = { L: new Float32Array((steps + 1) * 4), R: new Float32Array((steps + 1) * 4) }
  const mkQuat = (rad: number, out: Float32Array, i: number, sign: number) => {
    out[i * 4] = Math.sin(rad / 2) * sign; out[i * 4 + 1] = 0; out[i * 4 + 2] = 0; out[i * 4 + 3] = Math.cos(rad / 2)
  }
  for (const side of ['L', 'R'] as const) {
    let thetaMax = 1e-6
    for (const th of legPitch[side]) thetaMax = Math.max(thetaMax, Math.abs(th))
    const vRef = (2 * thetaMax) / Math.max(0.2, dur / 2)
    for (let i = 0; i <= steps; i++) {
      const decay = cfg.decayToKnee !== undefined ? 1 - (i / steps) * ((cfg.maxKnee - cfg.decayToKnee) / cfg.maxKnee) : 1
      let kneeRad = (cfg.maxKnee * Math.PI) / 180 * decay
      let elbowRad = (cfg.maxElbow * Math.PI) / 180
      if (cfg.decayToElbow !== undefined) elbowRad = ((cfg.maxElbow + (cfg.decayToElbow - cfg.maxElbow) * (i / steps)) * Math.PI) / 180
      if (cfg.gait) {
        const v = (legPitch[side][Math.min(steps, i + 1)] - legPitch[side][Math.max(0, i - 1)]) / (2 * dt)
        const swing = THREE.MathUtils.clamp(-v / vRef, 0, 1)
        const midSwing = 0.55 + 0.45 * (1 - Math.abs(legPitch[side][i]) / thetaMax)
        kneeRad = (cfg.maxKnee * Math.PI) / 180 * swing * midSwing
        const av = (armPitch[side][Math.min(steps, i + 1)] - armPitch[side][Math.max(0, i - 1)]) / (2 * dt)
        elbowRad = (12 * Math.PI) / 180 + (cfg.maxElbow - 12) * (Math.PI / 180) * THREE.MathUtils.clamp(-armPitch[side][i] / thetaMax, 0, 1) * THREE.MathUtils.clamp(-av / vRef, 0, 1)
      }
      // knee flexes BACKWARD (+X on a down-hanging shin), elbow flexes FORWARD (−X)
      mkQuat(kneeRad, kneel[side], i, +1)
      mkQuat(elbowRad, elbow[side], i, -1)
    }
    channels.push({ sampler: addSampler(times, kneel[side], 'VEC4'), target: { node: SRC_NODE_COUNT + jointIndex[`Knee${side}` as JointName], path: 'rotation' } })
    channels.push({ sampler: addSampler(times, elbow[side], 'VEC4'), target: { node: SRC_NODE_COUNT + jointIndex[`Elbow${side}` as JointName], path: 'rotation' } })
  }
  newAnimations.push({ name: anim.name, channels, samplers })
}

// ---------- 4. assemble output glTF ----------
const ROOT_IDX = SRC_NODE_COUNT + JOINT_NAMES.length // appended after the 15 joint nodes
const out: Record<string, unknown> = {
  asset: { version: '2.0', generator: 'votechor-bake-skinned-male' },
  scene: 0,
  scenes: [{ nodes: [...srcJson.scenes[0].nodes, ROOT_IDX] }],
  nodes: [
    ...srcJson.nodes.map((n) => ({ ...n, skin: 0 })), // 10 mesh nodes
    ...JOINT_NAMES.map((n) => ({ name: n, translation: [jointLocal[n].x, jointLocal[n].y, jointLocal[n].z] as number[] })),
    { name: 'Root' }, // index ROOT_IDX — single scene child holding the whole bone tree
  ],
  meshes: srcJson.meshes.map((m) => {
    const name = m.name ?? '?'
    return { ...m, primitives: m.primitives.map((pr) => ({ ...pr, attributes: { ...pr.attributes, JOINTS_0: meshJointAcc[name], WEIGHTS_0: meshWeightAcc[name] } })) }
  }),
  skins: [{ inverseBindMatrices: ibmAcc, joints: JOINT_NAMES.map((_, i) => SRC_NODE_COUNT + i) }],
  accessors: [...(srcJson.accessors ?? []), ...newAccessors],
  bufferViews: [...(srcJson.bufferViews ?? []), ...newBufferViews],
  materials: srcJson.materials ?? [],
  textures: srcJson.textures ?? [],
  images: srcJson.images ?? [],
  samplers: srcJson.samplers ?? [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
  animations: newAnimations,
  buffers: [{ byteLength: src.bin.length + appended }],
}
// wire bone hierarchy children: Hips ← Torso,LegL,LegR; Torso ← Head,ArmL,ArmR; ...
{
  const byName: Record<string, number> = {}
  JOINT_NAMES.forEach((n, i) => { byName[n] = SRC_NODE_COUNT + i })
  const children: Record<string, number[]> = {}
  for (const n of JOINT_NAMES) {
    const p = jointParent[n]
    if (p === 'Root') continue
    ;(children[p] ??= []).push(byName[n])
  }
  const nodes = out.nodes as Record<string, unknown>[]
  for (const [p, cs] of Object.entries(children)) nodes[byName[p]] = { ...nodes[byName[p]], children: cs }
  nodes[ROOT_IDX] = { name: 'Root', children: [byName.Hips] }
}

// ---------- 5. write GLB ----------
{
  // sanity: skins[0].joints order matches jointIndex and points at the right nodes
  const jointsArr = (out.skins as { joints: number[] }[])[0].joints
  JOINT_NAMES.forEach((_, i) => {
    if (jointsArr[i] !== SRC_NODE_COUNT + i) throw new Error(`joint index mismatch at ${i}`)
  })
}
const binBuf = Buffer.concat([Buffer.from(src.bin), Buffer.alloc(BIN_PAD), ...chunks])
// IMPORTANT: original bufferViews reference `buffer: 0` — verify srcJson uses one buffer
if ((srcJson.bufferViews ?? []).some((v) => v.buffer !== 0)) throw new Error('source uses multiple buffers — unsupported')
const jsonStr = JSON.stringify(out)
const jsonPad = (4 - (jsonStr.length % 4)) % 4
const jsonBuf = Buffer.concat([Buffer.from(jsonStr, 'utf8'), Buffer.alloc(jsonPad, 0x20)])
const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length
const glb = Buffer.alloc(total)
glb.writeUInt32LE(0x46546c67, 0) // glTF
glb.writeUInt32LE(2, 4)
glb.writeUInt32LE(total, 8)
glb.writeUInt32LE(jsonBuf.length, 12)
glb.writeUInt32LE(0x4e4f534a, 16) // JSON
Buffer.from(jsonStr, 'utf8').copy(glb, 20)
glb.writeUInt32LE(binBuf.length, 20 + jsonBuf.length)
glb.writeUInt32LE(0x004e4942, 24 + jsonBuf.length) // BIN
binBuf.copy(glb, 28 + jsonBuf.length)
fs.writeFileSync('public/models/votechor-male-skinned.glb', glb)
console.log(`baked public/models/votechor-male-skinned.glb (${(glb.length / 1048576).toFixed(2)}MB) — ${totalVerts} verts skinned, ${JOINT_NAMES.length} joints, ${newAnimations.length} clips`)
