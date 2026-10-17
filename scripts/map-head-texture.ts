// Map each mesh's material to its image index; extract the head texture PNG.
// Usage: bun scripts/map-head-texture.ts <file.glb> [outPrefix]
import * as fs from 'fs'

const file = process.argv[2] ?? 'public/models/votechor-male-skinned.glb'
const prefix = process.argv[3] ?? 'head'
const buf = fs.readFileSync(file)
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())

const binChunk = (() => {
  // GLB header: magic(4) version(4) length(4) then chunks: [len(4) type(4) data]
  let off = 12
  while (off < buf.length) {
    const len = buf.readUInt32LE(off)
    const type = buf.readUInt32LE(off + 4)
    if (type === 0x004e4942) return { off: off + 8, len }
    off += 8 + len
  }
  return null
})()
if (!binChunk) { console.error('no BIN chunk'); process.exit(1) }
const bin = buf.subarray(binChunk.off, binChunk.off + binChunk.len)

// accessor reader
function readAccessor(idx: number): { arr: Float32Array | Uint32Array | Uint16Array, comps: number } {
  const acc = json.accessors[idx]
  const bv = json.bufferViews[acc.bufferView]
  const start = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type as string] ?? 1
  const Comp = acc.componentType === 5126 ? Float32Array : acc.componentType === 5125 ? Uint32Array : Uint16Array
  const arr = new Comp(bin.buffer, bin.byteOffset + start, acc.count * comps)
  return { arr, comps }
}

console.log('== textures ==')
for (const t of json.textures ?? []) console.log(`  texture ${t.source}`)
console.log('== material -> image ==')
const matImage: Record<string, number> = {}
for (const m of json.materials ?? []) {
  const texIdx = m.pbrMetallicRoughness?.baseColorTexture?.index
  const src = texIdx !== undefined ? json.textures[texIdx].source : -1
  matImage[m.name as string] = src
  console.log(`  material "${m.name}" -> image ${src}`)
}
console.log('== mesh -> material -> image + vertex bbox ==')
for (const mesh of json.meshes ?? []) {
  const p = mesh.primitives[0]
  const matName = json.materials[p.material]?.name ?? '?'
  const pos = readAccessor(p.attributes.POSITION).arr as Float32Array
  let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i])
    minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1])
    minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2])
  }
  console.log(`  mesh "${mesh.name}" mat="${matName}" image=${matImage[matName] ?? '?'} bbox=[${minX.toFixed(2)},${minY.toFixed(2)},${minZ.toFixed(2)} .. ${maxX.toFixed(2)},${maxY.toFixed(2)},${maxZ.toFixed(2)}] verts=${pos.length / 3}`)
}

// extract the head image
const headMat = json.materials.find((m: { name: string }) => m.name === 'AvatarHead')
const texIdx = headMat?.pbrMetallicRoughness?.baseColorTexture?.index
if (texIdx !== undefined) {
  const imgIdx = json.textures[texIdx].source
  const img = json.images[imgIdx]
  const bv = json.bufferViews[img.bufferView]
  const start = bv.byteOffset ?? 0
  const png = bin.subarray(start, start + bv.byteLength)
  fs.writeFileSync(`/tmp/${prefix}-texture.png`, png)
  // also extract body texture for comparison
  const bodyMat = json.materials.find((m: { name: string }) => m.name === 'AvatarBody')
  const bodyTex = bodyMat?.pbrMetallicRoughness?.baseColorTexture?.index
  if (bodyTex !== undefined) {
    const bodyImg = json.images[json.textures[bodyTex].source]
    const bbv = json.bufferViews[bodyImg.bufferView]
    const same = bbv.byteOffset === bv.byteOffset
    console.log(`head image ${imgIdx} bytes=${bv.byteLength}; body shares head image: ${same}`)
  }
  console.log(`head texture written to /tmp/${prefix}-texture.png (${bv.byteLength} bytes)`)
}
