// Measure leg/arm regions of the textured avatar for the vertex-shader locomotion.
// Usage: bun scripts/measure-avatar.ts <glb>
import * as fs from 'fs'

const buf = fs.readFileSync(process.argv[2] ?? 'public/models/votechor-male.glb')
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
const jsonStart = 20
const binHeader = jsonStart + jsonLen
const binStart = binHeader + 8
const bin = buf.subarray(binStart)
const accs = json.accessors ?? []
const bvs = json.bufferViews ?? []

function positions(meshName: string): Float32Array {
  const mesh = (json.meshes ?? []).find((m: { name?: string }) => m.name === meshName)
  if (!mesh) return new Float32Array(0)
  const a = accs[mesh.primitives[0].attributes.POSITION]
  const off = (bvs[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0)
  const out = new Float32Array(a.count * 3)
  for (let i = 0; i < a.count; i++) {
    out[i * 3] = bin.readFloatLE(off + i * 12)
    out[i * 3 + 1] = bin.readFloatLE(off + i * 12 + 4)
    out[i * 3 + 2] = bin.readFloatLE(off + i * 12 + 8)
  }
  return out
}

for (const name of ['AvatarBody', 'outfit_bottom', 'outfit_shoes', 'outfit_top']) {
  const p = positions(name)
  if (!p.length) { console.log(`${name}: MISSING`); continue }
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i])
    minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1])
    minZ = Math.min(minZ, p[i + 2]); maxZ = Math.max(maxZ, p[i + 2])
  }
  console.log(`\n${name}: count=${p.length / 3} x[${minX.toFixed(3)},${maxX.toFixed(3)}] y[${minY.toFixed(3)},${maxY.toFixed(3)}] z[${minZ.toFixed(3)},${maxZ.toFixed(3)}]`)
  // horizontal slice scan: max |x| per 0.1 y-band (find hem height / hip width / leg width)
  const bands = new Map<number, { maxAbsX: number; count: number }>()
  for (let i = 0; i < p.length; i += 3) {
    const y = p[i + 1]
    const b = Math.floor(y * 10) / 10
    const e = bands.get(b) ?? { maxAbsX: 0, count: 0 }
    e.maxAbsX = Math.max(e.maxAbsX, Math.abs(p[i])); e.count++
    bands.set(b, e)
  }
  const sorted = [...bands.entries()].sort((a, b) => b[0] - a[0])
  let line = ''
  for (const [y, e] of sorted) line += `y${y.toFixed(1)}:|x|${e.maxAbsX.toFixed(2)}(${e.count})  `
  console.log(line)
}

// ---- landmark measurements for skeleton fitting ----
console.log(`\n== landmarks ==`)
for (const name of ['AvatarBody', 'AvatarHead', 'outfit_top', 'outfit_bottom', 'outfit_shoes']) {
  const p = positions(name)
  if (!p.length) continue
  let armMinY = 1e9, armMaxY = -1e9, armMaxAbsX = 0
  let headMinY = 1e9, headMaxY = -1e9, headXZ = [0, 0], headN = 0
  let legFootMinY = 1e9
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2]
    if (Math.abs(x) > 0.21 && y > 0.8) { armMinY = Math.min(armMinY, y); armMaxY = Math.max(armMaxY, y); armMaxAbsX = Math.max(armMaxAbsX, Math.abs(x)) }
    if (name === 'AvatarHead') { headMinY = Math.min(headMinY, y); headMaxY = Math.max(headMaxY, y); headXZ[0] += x; headXZ[1] += z; headN++ }
    if (y < 0.2) legFootMinY = Math.min(legFootMinY, y)
  }
  console.log(`${name}: armRegion(|x|>0.21,y>0.8) y[${armMinY.toFixed(3)}..${armMaxY.toFixed(3)}] maxAbsX=${armMaxAbsX.toFixed(3)}; footMinY=${legFootMinY.toFixed(3)}` +
    (name === 'AvatarHead' ? `; head y[${headMinY.toFixed(3)}..${headMaxY.toFixed(3)}] center=(${(headXZ[0] / headN).toFixed(3)},${(headXZ[1] / headN).toFixed(3)})` : ''))
}
