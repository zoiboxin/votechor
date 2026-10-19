// Measure the male High-Fi head mesh geometry in head-local space:
// bbox + cross-section (|x| max, z range) at every y band. Output drives hair fitting.
// Usage: bun scripts/measure-head-geom.ts
import * as fs from 'fs'

const FILE = 'public/models/votechor-male-skinned.glb'
const buf = fs.readFileSync(FILE)
if (buf.readUInt32LE(0) !== 0x46546c67) { console.error('not a GLB'); process.exit(1) }
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
let binOff = -1
{ let off = 12; while (off < buf.length) { const len = buf.readUInt32LE(off); const type = buf.readUInt32LE(off + 4); if (type === 0x004e4942) { binOff = off + 8; break } off += 8 + len } }
const bin = buf.subarray(binOff)

const nodes = json.nodes ?? []
const parent: Record<number, number> = {}
nodes.forEach((n: { children?: number[] }, i: number) => (n.children ?? []).forEach(c => { parent[c] = i }))
let headY = 0
{ let i = nodes.findIndex((n: { name?: string }) => n.name === 'Head'); while (i !== undefined && i >= 0) { headY += nodes[i].translation?.[1] ?? 0; i = parent[i] } }

const headMesh = json.meshes.find((m: { name: string }) => m.name === 'AvatarHead')
const prim = headMesh.primitives[0]
function accessor(idx: number) {
  const acc = json.accessors[idx]
  const bv = json.bufferViews[acc.bufferView]
  const start = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3 }[acc.type as string] ?? 1
  const Arr = acc.componentType === 5126 ? Float32Array : Uint16Array
  return new Arr(bin.buffer, bin.byteOffset + start, acc.count * comps)
}
const pos = accessor(prim.attributes.POSITION) as Float32Array
const n = pos.length / 3

// bbox in head-local space
let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9
const pts: [number, number, number][] = []
for (let i = 0; i < n; i++) {
  const x = pos[i * 3], y = pos[i * 3 + 1] - headY, z = pos[i * 3 + 2]
  pts.push([x, y, z])
  if (x < minX) minX = x; if (x > maxX) maxX = x
  if (y < minY) minY = y; if (y > maxY) maxY = y
  if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
}
console.log(`head-local bbox: x [${minX.toFixed(3)}, ${maxX.toFixed(3)}]  y [${minY.toFixed(3)}, ${maxY.toFixed(3)}]  z [${minZ.toFixed(3)}, ${maxZ.toFixed(3)}]`)

// cross-sections: for each y band of 0.02, report |x| p98, z min/p2/max, and the x histogram edges
const BAND = 0.02
for (let b = minY; b <= maxY; b += BAND) {
  const sel = pts.filter(([, y]) => y >= b && y < b + BAND)
  if (sel.length < 8) continue
  const xs = sel.map(([x]) => Math.abs(x)).sort((a, b2) => a - b2)
  const zs = sel.map(([, , z]) => z).sort((a, b2) => a - b2)
  const x98 = xs[Math.floor(xs.length * 0.98)]
  const zMin = zs[0], zP2 = zs[Math.floor(zs.length * 0.02)], zMax = zs[zs.length - 1]
  // width at the BACK half (z<0) and FRONT half (z>0) separately
  const bx = sel.filter(([, , z]) => z < -0.01).map(([x]) => Math.abs(x)).sort((a, b2) => a - b2)
  const fx = sel.filter(([, , z]) => z > 0.01).map(([x]) => Math.abs(x)).sort((a, b2) => a - b2)
  const bW = bx.length ? bx[Math.floor(bx.length * 0.98)] : 0
  const fW = fx.length ? fx[Math.floor(fx.length * 0.98)] : 0
  console.log(`y ${b.toFixed(2)}-${(b + BAND).toFixed(2)}  |x|max ${x98.toFixed(3)} (back ${bW.toFixed(3)} front ${fW.toFixed(3)})  z [${zMin.toFixed(3)} .. ${zMax.toFixed(3)}] p2=${zP2.toFixed(3)}  n=${sel.length}`)
}
