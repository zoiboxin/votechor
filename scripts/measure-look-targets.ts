// Measure the look-target data needed by src/game/avatar-look.ts:
//   1. per-mesh POSITION bbox of votechor-male-skinned.glb (accessory fitting)
//   2. baked texture reference colors at chosen landmark vertices (luminance-
//      normalized tint: tint = target / bakedRef so the rendered region average
//      becomes exactly the palette color instead of palette × baked × baked-dark)
//   3. female puppet node layout (attachment compatibility check)
// Usage: bun scripts/measure-look-targets.ts
import * as fs from 'fs'
import sharp from 'sharp'

function readGlb(file: string) {
  const buf = fs.readFileSync(file)
  const jsonLen = buf.readUInt32LE(12)
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
  const bin = buf.subarray(20 + jsonLen + 8)
  return { json, bin }
}

function readF32(g: { json: ReturnType<typeof readGlb>['json']; bin: Buffer }, ai: number): Float32Array {
  const a = g.json.accessors[ai]
  const bv = g.json.bufferViews[a.bufferView]
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const comp = a.type === 'VEC4' ? 4 : a.type === 'VEC3' ? 3 : a.type === 'VEC2' ? 2 : 1
  const out = new Float32Array(a.count * comp)
  for (let i = 0; i < out.length; i++) out[i] = g.bin.readFloatLE(off + i * 4)
  return out
}

const { json, bin } = readGlb('public/models/votechor-male-skinned.glb')
const nodes = json.nodes as { name?: string; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; children?: number[] }[]

console.log('=== MALE SKINNED — real mesh bboxes (accessor min/max is STALE — fix-avatar-pose rewrote positions without updating them) ===')
for (const n of nodes) {
  if (n.mesh === undefined) continue
  const m = json.meshes[n.mesh]
  const pos = readF32({ json, bin }, m.primitives[0].attributes.POSITION)
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let v = 0; v < pos.length / 3; v++) {
    minX = Math.min(minX, pos[v * 3]); maxX = Math.max(maxX, pos[v * 3])
    minY = Math.min(minY, pos[v * 3 + 1]); maxY = Math.max(maxY, pos[v * 3 + 1])
    minZ = Math.min(minZ, pos[v * 3 + 2]); maxZ = Math.max(maxZ, pos[v * 3 + 2])
  }
  const uvAcc = m.primitives[0].attributes.TEXCOORD_0
  const matIdx = m.primitives[0].material
  const mat = json.materials[matIdx]
  const bct = mat.pbrMetallicRoughness?.baseColorTexture
  const texIdx = bct ? bct.index : -1
  const imgIdx = texIdx >= 0 ? (json.textures[texIdx].source ?? -1) : -1
  console.log(
    `${m.name ?? '?'}  y[${minY.toFixed(3)},${maxY.toFixed(3)}] x[${minX.toFixed(3)},${maxX.toFixed(3)}] z[${minZ.toFixed(3)},${maxZ.toFixed(3)}]` +
    ` uv=${uvAcc !== undefined} tex=${texIdx} img=${imgIdx} base=${JSON.stringify(mat.pbrMetallicRoughness?.baseColorFactor)}`,
  )
}

// sample a texture at UV (PNG via sharp)
const imgCache = new Map<number, { data: Buffer; w: number; h: number }>()
async function sampleImg(imgIdx: number, u: number, v: number): Promise<[number, number, number]> {
  let img = imgCache.get(imgIdx)
  if (!img) {
    const image = json.images[imgIdx]
    // buffer view → png bytes
    const bv = json.bufferViews[image.bufferView]
    const png = bin.subarray((bv.byteOffset ?? 0), (bv.byteOffset ?? 0) + bv.byteLength)
    const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    img = { data: raw.data, w: raw.info.width, h: raw.info.height }
    imgCache.set(imgIdx, img)
  }
  const x = Math.min(img.w - 1, Math.max(0, Math.round(u * (img.w - 1))))
  const y = Math.min(img.h - 1, Math.max(0, Math.round((1 - v) * (img.h - 1)))) // glTF UV origin top-left
  const i = (y * img.w + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2]]
}

async function meshRef(meshName: string, ref: [number, number, number]): Promise<void> {
  const mesh = (json.meshes as { name?: string; primitives: { attributes: Record<string, number>; material: number }[] }[]).find((m) => m.name === meshName)
  if (!mesh) { console.log(`${meshName}: NOT FOUND`); return }
  const m = mesh
  const pos = readF32({ json, bin }, m.primitives[0].attributes.POSITION)
  const uv = readF32({ json, bin }, m.primitives[0].attributes.TEXCOORD_0)
  let best = -1
  let bestD = Infinity
  for (let v = 0; v < pos.length / 3; v++) {
    const dx = pos[v * 3] - ref[0]
    const dy = pos[v * 3 + 1] - ref[1]
    const dz = pos[v * 3 + 2] - ref[2]
    const d = dx * dx + dy * dy + dz * dz
    if (d < bestD) { bestD = d; best = v }
  }
  const matIdx = m.primitives[0].material
  const bct = json.materials[matIdx].pbrMetallicRoughness?.baseColorTexture
  const imgIdx = bct ? json.textures[bct.index].source ?? -1 : -1
  if (imgIdx < 0 || best < 0) { console.log(`${meshName}: no texture/vertex`); return }
  const u = uv[best * 2]
  const v = uv[best * 2 + 1]
  const [r, g, b] = await sampleImg(imgIdx, u, v)
  // vertex world position (nodes are identity-transformed in the bake)
  console.log(
    `${meshName} ref[${ref}] → vert(${pos[best * 3].toFixed(3)},${pos[best * 3 + 1].toFixed(3)},${pos[best * 3 + 2].toFixed(3)})` +
    ` uv(${u.toFixed(4)},${v.toFixed(4)}) bakedRGB(#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')})`,
  )
}

console.log('\n=== baked reference colors (landmark vertices on REAL geometry) ===')
// face skin / body skin / shirt chest / pants thigh — refs chosen from real arm-down pose
await meshRef('AvatarHead', [0, 1.72, 0.14])
await meshRef('AvatarHead', [0, 1.86, 0.10]) // forehead cross-check
await meshRef('AvatarBody', [0.34, 1.05, 0.02]) // right forearm skin
await meshRef('AvatarBody', [-0.34, 1.05, 0.02]) // left forearm skin
await meshRef('AvatarBody', [0, 1.585, 0.05]) // neck skin
await meshRef('outfit_top', [0, 1.35, 0.15]) // chest
await meshRef('outfit_top', [0, 1.05, 0.13]) // belly
await meshRef('outfit_bottom', [0.09, 0.8, 0.09]) // right thigh
await meshRef('outfit_bottom', [-0.09, 0.3, 0.09]) // left shin
await meshRef('outfit_shoes', [0.09, 0.09, 0.05]) // shoe top

console.log('\n=== FEMALE puppet nodes ===')
const f = readGlb('public/models/votechor-female.glb')
const fnodes = f.json.nodes as { name?: string; mesh?: number; translation?: number[]; children?: number[] }[]
const sceneNodes: number[] = (f.json.scenes as { nodes: number[] }[])[0].nodes
const worldY = new Map<number, number>()
const walk = (idx: number, py: number) => {
  const n = fnodes[idx]
  const y = py + (n.translation?.[1] ?? 0)
  worldY.set(idx, y)
  for (const c of n.children ?? []) walk(c, y)
}
for (const s of sceneNodes) walk(s, 0)
for (let i = 0; i < fnodes.length; i++) {
  const n = fnodes[i]
  if (n.name && !n.mesh) console.log(`node '${n.name}' local=(${(n.translation ?? []).join(',')}) approxWorldY=${(worldY.get(i) ?? 0).toFixed(3)}`)
  else if (n.mesh !== undefined) console.log(`MESH '${n.name ?? '?'}' approxWorldY=${(worldY.get(i) ?? 0).toFixed(3)}`)
}
