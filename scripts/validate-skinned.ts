// CPU validation of the baked skinned avatar — NO browser needed.
//  1. rest pose: skinning must reproduce original vertex positions exactly
//  2. walk clip: shoes must alternate forward/back (z), swing foot must lift
//     (y > 0), hips baseline ≈ 0.95, no NaNs
// Usage: bun scripts/validate-skinned.ts
import * as fs from 'fs'
import * as THREE from 'three'

const buf = fs.readFileSync('public/models/votechor-male-skinned.glb')
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
const bin = buf.subarray(20 + jsonLen + 8)

const accs = json.accessors
const bvs = json.bufferViews
function readF32(ai: number): Float32Array {
  const a = accs[ai]
  const off = (bvs[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0)
  const comp = a.type === 'VEC4' ? 4 : a.type === 'VEC3' ? 3 : a.type === 'MAT4' ? 16 : 1
  const out = new Float32Array(a.count * comp)
  for (let i = 0; i < out.length; i++) out[i] = bin.readFloatLE(off + i * 4)
  return out
}
function readU8(ai: number): Uint8Array {
  const a = accs[ai]
  const off = (bvs[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0)
  const out = new Uint8Array(a.count * 4)
  for (let i = 0; i < out.length; i++) out[i] = bin.readUInt8(off + i)
  return out
}

const nodes = json.nodes as { name?: string; translation?: number[]; children?: number[] }[]
const world = new Map<number, THREE.Matrix4>()
const rootIdx = json.scenes[0].nodes.find((ni: number) => nodes[ni].name === 'Root')!

// rest world transforms (no animation)
function resolve(i: number, parent: THREE.Matrix4) {
  const n = nodes[i]
  const m = new THREE.Matrix4()
  if (n.translation) m.makeTranslation(n.translation[0], n.translation[1], n.translation[2])
  m.premultiply(parent)
  world.set(i, m)
  for (const c of n.children ?? []) resolve(c, m)
}
resolve(rootIdx, new THREE.Matrix4())
for (const ni of json.scenes[0].nodes) if (!world.has(ni)) resolve(ni, new THREE.Matrix4())

const jointNodeIdx = (json.skins as { joints: number[] }[])[0].joints
const ibmRaw = readF32((json.skins as { inverseBindMatrices: number }[])[0].inverseBindMatrices)
const ibms = jointNodeIdx.map((_, j) => new THREE.Matrix4().fromArray(ibmRaw, j * 16))
let boneMats = jointNodeIdx.map((ni) => world.get(ni)!)

const v = new THREE.Vector3(), tmp = new THREE.Vector3()
const outVec = new THREE.Vector3() // separate output — never alias the scratch
function skin(pos: THREE.Vector3, joints: Uint8Array, weights: Float32Array, vi: number, out: THREE.Vector3) {
  out.set(0, 0, 0)
  for (let k = 0; k < 4; k++) {
    const w = weights[vi * 4 + k]
    if (w < 1e-4) continue
    tmp.copy(pos).applyMatrix4(ibms[joints[vi * 4 + k]]).applyMatrix4(boneMats[joints[vi * 4 + k]])
    out.addScaledVector(tmp, w)
  }
  return out
}

console.log('== rest pose identity ==')
for (const mesh of json.meshes as { name: string; primitives: { attributes: Record<string, number> }[] }[]) {
  const pr = mesh.primitives[0]
  const pos = readF32(pr.attributes.POSITION)
  const joints = readU8(pr.attributes.JOINTS_0)
  const weights = readF32(pr.attributes.WEIGHTS_0)
  let maxErr = 0
  const stride = Math.max(1, Math.floor(pos.length / 3 / 400))
  for (let vi = 0; vi < pos.length / 3; vi += stride) {
    v.set(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2])
    skin(v, joints, weights, vi, outVec)
    maxErr = Math.max(maxErr, outVec.distanceTo(v))
  }
  console.log(`  ${mesh.name}: max rest skin error = ${maxErr.toExponential(2)}`)
}

// ---- walk pose evaluation ----
const anims = json.animations as { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[] }[]
const walk = anims.find((a) => a.name === 'walk')!
const sData = walk.samplers.map((s) => ({ times: readF32(s.input), vals: readF32(s.output) }))
const dur = sData[0].times[sData[0].times.length - 1]
const localQ = new Map<number, THREE.Quaternion>()
const localT = new Map<number, THREE.Vector3>()
function evalPose(t: number) {
  localQ.clear(); localT.clear()
  walk.channels.forEach((ch, ci) => {
    const { times, vals } = sData[ci]
    const last = times.length - 1
    let i = 0
    while (i < last - 1 && times[i + 1] < t) i++
    const f = THREE.MathUtils.clamp((t - times[i]) / Math.max(1e-6, times[i + 1] - times[i]), 0, 1)
    if (ch.target.path === 'rotation') {
      const a = new THREE.Quaternion(vals[i * 4], vals[i * 4 + 1], vals[i * 4 + 2], vals[i * 4 + 3])
      const b = new THREE.Quaternion(vals[i * 4 + 4], vals[i * 4 + 5], vals[i * 4 + 6], vals[i * 4 + 7])
      localQ.set(ch.target.node, new THREE.Quaternion().copy(a).slerp(b, f))
    } else {
      const lerp = (k: number) => vals[i * 3 + k] + (vals[(i + 1) * 3 + k] - vals[i * 3 + k]) * f
      localT.set(ch.target.node, new THREE.Vector3(lerp(0), lerp(1), lerp(2)))
    }
  })
}
function recompose() {
  world.clear()
  const walk2 = (parent: THREE.Matrix4, i: number) => {
    const n = nodes[i]
    const m = new THREE.Matrix4()
    const lt = localT.get(i)
    if (lt) m.makeTranslation(lt.x, lt.y, lt.z)
    else if (n.translation) m.makeTranslation(n.translation[0], n.translation[1], n.translation[2])
    const lq = localQ.get(i)
    if (lq) m.multiply(new THREE.Matrix4().makeRotationFromQuaternion(lq))
    m.premultiply(parent)
    world.set(i, m)
    for (const c of n.children ?? []) walk2(m, c)
  }
  walk2(new THREE.Matrix4(), rootIdx)
  boneMats = jointNodeIdx.map((ni) => world.get(ni)!)
}

const shoeMesh = (json.meshes as { name: string; primitives: { attributes: Record<string, number> }[] }[]).find((m) => m.name === 'outfit_shoes')!
const sPos = readF32(shoeMesh.primitives[0].attributes.POSITION)
const sJoints = readU8(shoeMesh.primitives[0].attributes.JOINTS_0)
const sWeights = readF32(shoeMesh.primitives[0].attributes.WEIGHTS_0)

console.log(`== walk cycle (shoe cloud stats), dur=${dur.toFixed(2)}s ==`)
const out = new THREE.Vector3()
for (const f of [0, 0.25, 0.5, 0.75]) {
  evalPose(f * dur)
  recompose()
  let minY = 1e9, liftL = 0, liftR = 0, zLmin = 1e9, zLmax = -1e9, zRmin = 1e9, zRmax = -1e9, nan = false
  for (let vi = 0; vi < sPos.length / 3; vi++) {
    v.set(sPos[vi * 3], sPos[vi * 3 + 1], sPos[vi * 3 + 2])
    skin(v, sJoints, sWeights, vi, out)
    if (!Number.isFinite(out.x + out.y + out.z)) nan = true
    minY = Math.min(minY, out.y)
    if (out.x < 0) { zLmin = Math.min(zLmin, out.z); zLmax = Math.max(zLmax, out.z); liftL = Math.max(liftL, out.y) }
    else { zRmin = Math.min(zRmin, out.z); zRmax = Math.max(zRmax, out.z); liftR = Math.max(liftR, out.y) }
  }
  const hipsY = localT.get(jointNodeIdx[0])?.y.toFixed(3) ?? '?'
  console.log(`  t=${(f * dur).toFixed(2)} hipsY=${hipsY} minY=${minY.toFixed(3)} liftL=${liftL.toFixed(3)} liftR=${liftR.toFixed(3)} zL=[${zLmin.toFixed(2)},${zLmax.toFixed(2)}] zR=[${zRmin.toFixed(2)},${zRmax.toFixed(2)}]${nan ? ' NaN!!' : ''}`)
}
