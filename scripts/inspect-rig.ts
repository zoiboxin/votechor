// Deep-rig inspection WITHOUT GLTFLoader (bun-safe): parse the GLB JSON chunk,
// rebuild the node hierarchy with three.js math, and dump:
//   - node tree (name, mesh, local T/R/S, world rest position)
//   - per-animation channel targets (node + property) and durations
// Usage: bun scripts/inspect-rig.ts <file.glb>
import * as fs from 'fs'
import * as THREE from 'three'

const file = process.argv[2] ?? 'public/models/votechor-male-rigged.glb'
const buf = fs.readFileSync(file)
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())

type Node = { name?: string; children?: number[]; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }
const nodes: Node[] = json.nodes ?? []

// world transforms at rest
const worldPos = new Map<number, THREE.Vector3>()
const worldQuat = new Map<number, THREE.Quaternion>()
const localPos = new Map<number, THREE.Vector3>()
const localQuat = new Map<number, THREE.Quaternion>()

function resolve(i: number, parentPos: THREE.Vector3, parentQuat: THREE.Quaternion) {
  const n = nodes[i]
  let lp: THREE.Vector3, lq: THREE.Quaternion
  if (n.matrix) {
    const m = new THREE.Matrix4().fromArray(n.matrix)
    lp = new THREE.Vector3().setFromMatrixPosition(m)
    lq = new THREE.Quaternion().setFromRotationMatrix(m)
  } else {
    lp = new THREE.Vector3(...(n.translation ?? [0, 0, 0]))
    lq = new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1]))
  }
  const ls = new THREE.Vector3(...(n.scale ?? [1, 1, 1]))
  const wp = lp.clone().multiply(ls).applyQuaternion(parentQuat).add(parentPos)
  const wq = parentQuat.clone().multiply(lq)
  localPos.set(i, lp); localQuat.set(i, lq); worldPos.set(i, wp); worldQuat.set(i, wq)
  for (const c of n.children ?? []) resolve(c, wp, wq)
}
// find roots (not referenced as a child)
const isChild = new Set<number>()
for (const n of nodes) for (const c of n.children ?? []) isChild.add(c)
for (let i = 0; i < nodes.length; i++) if (!isChild.has(i)) resolve(i, new THREE.Vector3(), new THREE.Quaternion())

console.log(`== ${file} node tree ==`)
function dump(i: number, depth: number) {
  const n = nodes[i]
  const wp = worldPos.get(i)!
  const meshName = n.mesh !== undefined ? ` MESH:${(json.meshes ?? [])[n.mesh]?.name ?? '?'}` : ''
  const lp = localPos.get(i)!
  console.log(`${'  '.repeat(depth)}#${i} "${n.name ?? '?'}"${meshName} local=(${lp.x.toFixed(3)},${lp.y.toFixed(3)},${lp.z.toFixed(3)}) world=(${wp.x.toFixed(3)},${wp.y.toFixed(3)},${wp.z.toFixed(3)})`)
  for (const c of n.children ?? []) dump(c, depth + 1)
}
for (let i = 0; i < nodes.length; i++) if (!isChild.has(i)) dump(i, 0)

console.log(`\n== animations ==`)
for (const a of json.animations ?? []) {
  let maxT = 0
  const targets = new Map<string, Set<string>>()
  for (const ch of a.channels ?? []) {
    const n = nodes[ch.target?.node ?? -1]
    const key = `${n?.name ?? `node${ch.target?.node}`}`
    if (!targets.has(key)) targets.set(key, new Set())
    targets.get(key)!.add(ch.target?.path ?? '?')
    // duration from sampler input accessor min/max
    const s = a.samplers?.[ch.sampler]
    if (s) {
      const acc = (json.accessors ?? [])[s.input]
      if (acc?.max?.[0]) maxT = Math.max(maxT, acc.max[0])
    }
  }
  const pretty = [...targets.entries()].map(([k, v]) => `${k}[${[...v].join(',')}]`).join(' ')
  console.log(`  "${a.name}" dur=${maxT.toFixed(2)}s targets: ${pretty}`)
}

// ---- extra: rest rotations + first/last keyframe values of each clip ----
console.log(`\n== rest rotations (euler deg) ==`)
for (let i = 0; i < nodes.length; i++) {
  const q = localQuat.get(i)!
  if (q.x === 0 && q.y === 0 && q.z === 0 && q.w === 1) continue
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ')
  console.log(`  #${i} "${nodes[i].name ?? '?'}" euler=(${(e.x * 180 / Math.PI).toFixed(1)},${(e.y * 180 / Math.PI).toFixed(1)},${(e.z * 180 / Math.PI).toFixed(1)})`)
}

const accs2 = json.accessors ?? []
const bvs2 = json.bufferViews ?? []
const binStart2 = 20 + jsonLen + 8
const bin2 = buf.subarray(binStart2)
function readAccessor(ai: number): { arr: Float32Array; comp: number } {
  const a = accs2[ai]
  const off = (bvs2[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0)
  const comp = a.type === 'VEC4' ? 4 : a.type === 'VEC3' ? 3 : 1
  const arr = new Float32Array(a.count * comp)
  for (let i = 0; i < a.count * comp; i++) arr[i] = bin2.readFloatLE(off + i * 4)
  return { arr, comp }
}
console.log(`\n== walk clip keyframes ==`)
const walk = (json.animations ?? []).find((a: { name: string }) => a.name === 'walk')!
for (const ch of walk.channels ?? []) {
  const s = walk.samplers[ch.sampler]
  const t = readAccessor(s.input).arr
  const o = readAccessor(s.output)
  const n = nodes[ch.target.node]
  const first = Array.from(o.arr.slice(0, o.comp)).map((v) => v.toFixed(3)).join(',')
  const last = Array.from(o.arr.slice(-o.comp)).map((v) => v.toFixed(3)).join(',')
  console.log(`  ${n?.name}.${ch.target.path}: keys=${t.length} t=[${t[0].toFixed(2)}..${t[t.length - 1].toFixed(2)}] first=[${first}] last=[${last}]`)
}
