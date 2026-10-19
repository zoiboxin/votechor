// BALDIFY the male skinned avatar: repaint the baked scalp hair in the
// AvatarHead texture to skin so the default look is a bald head and every
// hair style attaches onto clean skin.
//
// Method (measured, iterative, verifiable):
//   Pass A — seeds = texels of head vertices above the scalp threshold whose
//     texel is dark brown (lum < THR, g >= b — excludes the magenta UV pockets);
//     flood fill 4-connected through dark brown texels. Painted eyebrows are
//     explicitly PROTECTED (never entered).
//   Pass B — bright islands ENCLOSED by hair (the combed parting strip):
//     connected components of non-hair texels that (a) touch a dilated hair
//     mask, (b) are NOT connected to the known skin samples (neck band), and
//     (c) are skin-colored (mean lum 150..225, mean g >= mean b) -> repaint.
//   Repaint with measured skin average + noise; feather the boundary.
//   VERIFY — resample every head vertex texel: dark texels may only remain
//     inside the eyebrow exclusion box.
//
// Usage: bun scripts/baldify-male-head.ts [--apply]
import * as fs from 'fs'
import sharp from 'sharp'

const APPLY = process.argv.includes('--apply')
const FILE = 'public/models/votechor-male-skinned.glb'
const SCALP_LOCAL = 0.30
const THR = 165 // hair/skin luminance split (measured: hair p95 ~160, skin p05 ~170)

const buf = fs.readFileSync(FILE)
if (buf.readUInt32LE(0) !== 0x46546c67) { console.error('not a GLB'); process.exit(1) }
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
let binOff = -1
{ let off = 12; while (off < buf.length) { const len = buf.readUInt32LE(off); const type = buf.readUInt32LE(off + 4); if (type === 0x004e4942) { binOff = off + 8; break } off += 8 + len } }
if (binOff < 0) { console.error('no BIN'); process.exit(1) }
const bin = buf.subarray(binOff)

// Head joint world y (rest rotations identity)
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
const pngBytes = bin.subarray(imgBv.byteOffset ?? 0, (imgBv.byteOffset ?? 0) + imgBv.byteLength)
const raw = await sharp(pngBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const W = raw.info.width, H = raw.info.height, CH = raw.info.channels
const N = W * H
console.log(`Head joint y=${headY.toFixed(3)} | texture ${W}x${H} | head verts=${pos.length / 3}`)

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
// glTF UV: origin TOP-LEFT, v grows downward, sampler wraps (REPEAT) — scalp v runs negative
const wrap1 = (x: number) => ((x % 1) + 1) % 1
const txOf = (vi: number) => Math.min(W - 1, Math.max(0, Math.round(wrap1(uv[vi * 2]) * (W - 1))))
const tyOf = (vi: number) => Math.min(H - 1, Math.max(0, Math.round(wrap1(uv[vi * 2 + 1]) * (H - 1))))

// vertex classes
const scalpVerts: number[] = [], browTexels = new Set<number>(), skinTexels = new Set<number>(), cheekTexels = new Set<number>()
const zoneVerts: number[] = [] // every vertex where hair USED to grow
const inHairZone = (x: number, y: number, z: number) => y > SCALP_LOCAL || (z <= 0.055 && y > 0.17) || (Math.abs(x) > 0.075 && y > 0.20)
for (let vi = 0; vi < pos.length / 3; vi++) {
  const x = pos[vi * 3], y = pos[vi * 3 + 1] - headY, z = pos[vi * 3 + 2]
  const t = tyOf(vi) * W + txOf(vi)
  if (y > SCALP_LOCAL) scalpVerts.push(t)
  if (inHairZone(x, y, z)) zoneVerts.push(t)
  if (Math.abs(x) < 0.062 && y > 0.262 && y < 0.302 && z > 0.075) browTexels.add(t)
  if (y < 0.08) skinTexels.add(t)
  // cheek apples: face skin reference for the fill tone
  if (y > 0.08 && y < 0.15 && z > 0.09 && Math.abs(x) < 0.06) cheekTexels.add(t)
}
console.log(`scalp vert-texels=${new Set(scalpVerts).size} zone vert-texels=${new Set(zoneVerts).size} brow=${browTexels.size} skin=${skinTexels.size} cheek=${cheekTexels.size}`)

// skin average: cheek (face tone) blended 50/50 with neck band
let sr = 0, sg = 0, sb = 0
for (const t of skinTexels) { sr += raw.data[t * CH]; sg += raw.data[t * CH + 1]; sb += raw.data[t * CH + 2] }
const neckAvg = [sr / skinTexels.size, sg / skinTexels.size, sb / skinTexels.size]
let skinAvg = neckAvg.map(Math.round)
if (cheekTexels.size >= 50) {
  let cr = 0, cg = 0, cb = 0
  for (const t of cheekTexels) { cr += raw.data[t * CH]; cg += raw.data[t * CH + 1]; cb += raw.data[t * CH + 2] }
  const cheekAvg = [cr / cheekTexels.size, cg / cheekTexels.size, cb / cheekTexels.size]
  skinAvg = [0, 1, 2].map(i => Math.round(neckAvg[i] * 0.5 + cheekAvg[i] * 0.5))
  console.log(`cheek avg rgb=${cheekAvg.map(v => v | 0).join(',')} neck avg rgb=${neckAvg.map(v => v | 0).join(',')} -> fill rgb=${skinAvg.join(',')}`)
}
console.log(`fill avg rgb=${skinAvg.join(',')}`)

// ---- Pass A: dark flood fill seeded from EVERY hair-zone vertex (nape/side hair may be UV islands) ----
const hair = new Uint8Array(N)
const q: number[] = []
let darkSeeds = 0
for (const t of new Set(zoneVerts)) {
  if (browTexels.has(t)) continue
  const o = t * CH
  if (lum(raw.data[o], raw.data[o + 1], raw.data[o + 2]) < THR) { hair[t] = 1; q.push(t); darkSeeds++ }
}
console.log(`dark seeds: ${darkSeeds}`)
while (q.length) {
  const t = q.pop()!
  const x = t % W, y = (t - x) / W
  for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
    const ni = ny * W + nx
    if (hair[ni] || browTexels.has(ni)) continue
    const o = ni * CH
    if (lum(raw.data[o], raw.data[o + 1], raw.data[o + 2]) < THR) { hair[ni] = 1; q.push(ni) }
  }
}
let passA = 0
for (let i = 0; i < N; i++) if (hair[i]) passA++
console.log(`Pass A (dark fill): ${passA} texels (${((passA / N) * 100).toFixed(1)}%)`)

// ---- Pass B: bright islands enclosed by hair, not connected to skin ----
// dilate hair by 2 to define the "adjacent to hair" zone
const hairDil = new Uint8Array(N)
{ const q2: number[] = []
  for (let i = 0; i < N; i++) if (hair[i]) q2.push(i)
  let depth = 0
  while (q2.length && depth < 2) {
    const lvl = q2.length
    for (let k = 0; k < lvl; k++) {
      const t = q2.shift()!
      const x = t % W, y = (t - x) / W
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const ni = ny * W + nx
        if (!hairDil[ni]) { hairDil[ni] = 1; q2.push(ni) }
      }
    }
    depth++
  }
}
// connected components over non-hair texels; label via BFS
const comp = new Int32Array(N).fill(-1)
let compId = 0
const compInfo: { touchesSkin: boolean; touchesHairDil: boolean; sumL: number; n: number; sumR: number; sumG: number; sumB: number }[] = []
for (let i = 0; i < N; i++) {
  if (hair[i] || comp[i] >= 0) continue
  const id = compId++
  const queue = [i]
  comp[i] = id
  const info = { touchesSkin: false, touchesHairDil: false, sumL: 0, n: 0, sumR: 0, sumG: 0, sumB: 0 }
  while (queue.length) {
    const t = queue.pop()!
    const o = t * CH
    info.n++; info.sumL += lum(raw.data[o], raw.data[o + 1], raw.data[o + 2]); info.sumR += raw.data[o]; info.sumG += raw.data[o + 1]; info.sumB += raw.data[o + 2]
    if (skinTexels.has(t)) info.touchesSkin = true
    if (hairDil[t]) info.touchesHairDil = true
    const x = t % W, y = (t - x) / W
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const ni = ny * W + nx
      if (!hair[ni] && comp[ni] < 0) { comp[ni] = id; queue.push(ni) }
    }
  }
  compInfo.push(info)
}
let passB = 0
compInfo.forEach((info, id) => {
  if (info.n === 0 || info.n > 40000) return
  if (info.touchesSkin || !info.touchesHairDil) return
  const mL = info.sumL / info.n, mG = info.sumG / info.n, mB = info.sumB / info.n
  if (mL < 150 || mL > 225 || mG < mB) return // skin-colored only
  for (let i = 0; i < N; i++) if (comp[i] === id) { hair[i] = 1; passB++ }
  console.log(`  Pass B island #${id}: n=${info.n} meanLum=${mL | 0} -> painted`)
})
console.log(`Pass B (enclosed bright islands): ${passB} texels`)

// ---- Pass C: magenta UV pockets (would render as magenta spots once hair is gone) ----
let passC = 0
for (let i = 0; i < N; i++) {
  if (hair[i]) continue
  const o = i * CH
  const r = raw.data[o], g = raw.data[o + 1], b = raw.data[o + 2]
  if (r > 100 && r > g && b > g && r - g > 40) { hair[i] = 1; passC++ }
}
console.log(`Pass C (magenta pockets): ${passC} texels`)

// ---- repaint ----
const out = Buffer.from(raw.data)
const prng = (() => { let s = 987654321; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) })()
const boundary: number[] = []
for (let i = 0; i < N; i++) {
  if (!hair[i]) continue
  const x = i % W, y = (i - x) / W
  let edge = false
  for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
    if (!hair[ny * W + nx]) { edge = true; break }
  }
  const o = i * CH
  const soft = edge ? 4 : 10 // boundary texels get gentler noise: a hard-ish edge against AA skin reads fine in 3D
  out[o] = Math.max(0, Math.min(255, skinAvg[0] + prng() * soft))
  out[o + 1] = Math.max(0, Math.min(255, skinAvg[1] + prng() * soft))
  out[o + 2] = Math.max(0, Math.min(255, skinAvg[2] + prng() * soft))
  if (edge) boundary.push(i)
}
console.log(`repainted ${passA + passB + passC} texels; boundary texels ${boundary.length}`)

// ---- VERIFY ----
// hair zones must be skin now; face features below the hairline legitimately keep dark details
let stray = 0
const strayList: string[] = []
for (let vi = 0; vi < pos.length / 3; vi++) {
  const x = pos[vi * 3], y = pos[vi * 3 + 1] - headY, z = pos[vi * 3 + 2]
  const t = tyOf(vi) * W + txOf(vi)
  const o = t * CH
  if (inHairZone(x, y, z) && lum(out[o], out[o + 1], out[o + 2]) < 140) {
    stray++
    if (strayList.length < 3) strayList.push(`v${vi} local(${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}) texel(${t % W},${Math.floor(t / W)}) out=${out[o]},${out[o + 1]},${out[o + 2]}`)
  }
}
console.log(`VERIFY hair-zone strays: ${stray}${stray ? ' :: ' + strayList.join(' | ') : ' (clean)'}`)

const newPng = await sharp(out, { raw: { width: W, height: H, channels: CH } }).png().toBuffer()
fs.writeFileSync('/tmp/head-baldified.png', newPng)
console.log(`new head texture ${newPng.length} bytes (was ${pngBytes.length}) -> /tmp/head-baldified.png`)
if (!APPLY) { console.log('DRY RUN — rerun with --apply to write the GLB'); process.exit(0) }

// ---- rebuild GLB ----
const bvIndex: number = json.images[imgIdx].bufferView
const views = json.bufferViews
let cursor = 0
const newOffsets: number[] = []
for (let i = 0; i < views.length; i++) {
  newOffsets[i] = cursor
  cursor += i === bvIndex ? newPng.length : views[i].byteLength
  if (cursor % 4 !== 0) cursor += 4 - (cursor % 4)
}
const newBin = Buffer.alloc(cursor)
for (let i = 0; i < views.length; i++) {
  const src = i === bvIndex ? newPng : bin.subarray(views[i].byteOffset ?? 0, (views[i].byteOffset ?? 0) + views[i].byteLength)
  newBin.set(src, newOffsets[i])
  views[i].byteOffset = newOffsets[i]
}
views[bvIndex].byteLength = newPng.length
const jsonStr = JSON.stringify(json)
const jsonPad = (4 - (jsonStr.length % 4)) % 4
const jsonChunk = Buffer.concat([Buffer.from(jsonStr), Buffer.alloc(jsonPad, 0x20)])
const binPad = (4 - (newBin.length % 4)) % 4
const binChunk = Buffer.concat([newBin, Buffer.alloc(binPad, 0)])
const header = Buffer.alloc(12)
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4)
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8)
const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonChunk.length, 0); jh.writeUInt32LE(0x4e4f534a, 4)
const bh = Buffer.alloc(8); bh.writeUInt32LE(binChunk.length, 0); bh.writeUInt32LE(0x004e4942, 4)
fs.writeFileSync(FILE + '.bald.bak', buf)
fs.writeFileSync(FILE, Buffer.concat([header, jh, jsonChunk, bh, binChunk]))
console.log(`APPLIED -> ${FILE} (${(fs.statSync(FILE).size / 1048576).toFixed(2)}MB; hairy backup at ${FILE}.bald.bak)`)
