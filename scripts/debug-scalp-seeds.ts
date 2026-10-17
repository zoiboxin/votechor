// Debug: mark scalp seed texels (head verts local y > threshold) on the head texture.
// Usage: bun scripts/debug-scalp-seeds.ts [thresholdLocal=0.30]
import * as fs from 'fs'
import sharp from 'sharp'

const SCALP_LOCAL = Number(process.argv[2] ?? '0.30')
const FILE = 'public/models/votechor-male-skinned.glb'
const buf = fs.readFileSync(FILE)
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
const uv = accessor(prim.attributes.TEXCOORD_0) as Float32Array
const imgIdx = json.textures[json.materials[prim.material].pbrMetallicRoughness.baseColorTexture.index].source
const imgBv = json.bufferViews[json.images[imgIdx].bufferView]
const png = bin.subarray(imgBv.byteOffset ?? 0, (imgBv.byteOffset ?? 0) + imgBv.byteLength)
const raw = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const W = raw.info.width, H = raw.info.height, CH = raw.info.channels
const out = Buffer.from(raw.data)

// bands: scalp (>0.30), mid (0.22..0.30), low (0.10..0.22) — mark red/green/blue
const bands: [number, number, number[]][] = [[SCALP_LOCAL, 9, [255, 0, 0]], [0.22, SCALP_LOCAL, [0, 255, 0]], [0.10, 0.22, [0, 128, 255]]]
const stats: Record<string, { n: number; lums: number[] }> = {}
for (let vi = 0; vi < pos.length / 3; vi++) {
  const y = pos[vi * 3 + 1], x = pos[vi * 3], z = pos[vi * 3 + 2]
  const localY = y - headY
  const tx = Math.min(W - 1, Math.max(0, Math.round(uv[vi * 2] * (W - 1))))
  const ty = Math.min(H - 1, Math.max(0, Math.round((1 - uv[vi * 2 + 1]) * (H - 1))))
  for (const [lo, hi, col] of bands) {
    if (localY > lo && localY <= hi) {
      const key = `${col.join(',')}`
      const o = (ty * W + tx) * CH
      const l = 0.2126 * out[o] + 0.7152 * out[o + 1] + 0.0722 * out[o + 2]
      ;(stats[key] ??= { n: 0, lums: [] }).n++; stats[key].lums.push(l)
      out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]
      break
    }
  }
}
for (const [k, v] of Object.entries(stats)) {
  v.lums.sort((a, b) => a - b)
  console.log(`band rgb(${k}): n=${v.n} lum p05=${v.lums[Math.floor(v.lums.length * 0.05)] | 0} p50=${v.lums[Math.floor(v.lums.length * 0.5)] | 0} p95=${v.lums[Math.floor(v.lums.length * 0.95)] | 0}`)
}
await sharp(out, { raw: { width: W, height: H, channels: CH } }).png().toFile('/tmp/scalp-seeds.png')
console.log('-> /tmp/scalp-seeds.png (red=scalp>0.30, green=0.22-0.30, blue=0.10-0.22)')
