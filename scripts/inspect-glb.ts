// Dump a GLB's JSON chunk: meshes, skins, animations, materials, node count.
// Usage: bun scripts/inspect-glb.ts <file.glb>
import * as fs from 'fs'

const file = process.argv[2]
if (!file) { console.error('usage: bun scripts/inspect-glb.ts <file.glb>'); process.exit(1) }
const buf = fs.readFileSync(file)
const magic = buf.readUInt32LE(0)
if (magic !== 0x46546c67) { console.error('not a GLB'); process.exit(1) }
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())

console.log(`== ${file} (${(buf.length / 1048576).toFixed(2)}MB) ==`)
console.log(`meshes: ${(json.meshes ?? []).length}, nodes: ${(json.nodes ?? []).length}, skins: ${(json.skins ?? []).length}, animations: ${(json.animations ?? []).length}, materials: ${(json.materials ?? []).length}, images: ${(json.images ?? []).length}`)

for (const m of json.meshes ?? []) {
  const prims = (m.primitives ?? []).length
  const attrs = Object.keys(m.primitives?.[0]?.attributes ?? {}).join(',')
  console.log(`  mesh "${m.name}" prims=${prims} attrs=[${attrs}]`)
}
for (const s of json.skins ?? []) console.log(`  skin "${s.name ?? '?'}" joints=${(s.joints ?? []).length}`)
for (const a of json.animations ?? []) {
  console.log(`  anim "${a.name}" channels=${(a.channels ?? []).length} samplers=${(a.samplers ?? []).length}`)
}
for (const mat of json.materials ?? []) {
  const pbr = mat.pbrMetallicRoughness ?? {}
  const hasTex = pbr.baseColorTexture ? 'baseTex' : ''
  console.log(`  material "${mat.name}" ${hasTex} baseColor=${JSON.stringify(pbr.baseColorFactor ?? null)}`)
}
if (json.images) for (const im of json.images) console.log(`  image "${im.name ?? im.uri ?? '?'}" mime=${im.mimeType}`)
