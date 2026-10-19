// VoteChor GLB asset validation — binary-parses the shipped character models.
//
// Coverage:
//   • GLB container: magic, version 2, total length, chunk structure.
//   • JSON chunk: asset version, node hierarchy (Hips/Torso/Head/Arms/Legs),
//     mesh + material counts, animation inventory (all 13 gameplay states).
//   • Gender variants: male + female both valid; female carries the ponytail node.
//   • Binary chunk: length sanity + 4-byte padding (GLB spec).
//
// Run: bun tests/glb-test.ts
import { readFileSync, existsSync } from 'node:fs'

let pass = 0
let fail = 0
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ FAIL: ${label}`) }
}

const REQUIRED_CLIPS = ['idle', 'walk', 'run', 'jump', 'fall', 'land', 'slide', 'hit', 'detained', 'recover', 'celebrate', 'throw', 'heal']
const REQUIRED_NODES = ['VoteChorCharacter', 'Hips', 'Torso', 'Head', 'ArmL', 'ArmR', 'LegL', 'LegR']

interface GlbInfo {
  version: number
  json: {
    asset: { version: string }
    nodes?: { name?: string }[]
    meshes?: unknown[]
    materials?: unknown[]
    animations?: { name?: string; channels: unknown[]; samplers: unknown[] }[]
  }
  binLen: number
  binPadded: boolean
}

function parseGlb(path: string): GlbInfo {
  const buf = readFileSync(path)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const magic = dv.getUint32(0, true)
  if (magic !== 0x46546c67) throw new Error(`${path}: bad magic 0x${magic.toString(16)}`)
  const version = dv.getUint32(4, true)
  const total = dv.getUint32(8, true)
  if (total !== buf.byteLength) throw new Error(`${path}: header length ${total} != file ${buf.byteLength}`)
  // first chunk (JSON)
  let off = 12
  const jsonLen = dv.getUint32(off, true)
  const jsonType = dv.getUint32(off + 4, true)
  if (jsonType !== 0x4e4f534a) throw new Error(`${path}: first chunk is not JSON`)
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(off + 8, off + 8 + jsonLen)))
  // second chunk (BIN)
  off += 8 + jsonLen
  let binLen = 0
  let binPadded = true
  if (off + 8 <= buf.byteLength) {
    binLen = dv.getUint32(off, true)
    const binType = dv.getUint32(off + 4, true)
    if (binType === 0x004e4942) {
      binPadded = binLen % 4 === 0
      off += 8 + binLen
    }
  }
  if (off !== buf.byteLength) throw new Error(`${path}: trailing bytes after chunks (${off} vs ${buf.byteLength})`)
  return { version, json, binLen, binPadded }
}

for (const [file, gender] of [['public/models/votechor-male.glb', 'male'], ['public/models/votechor-female.glb', 'female']] as const) {
  console.log(`— ${file} (${gender}) —`)
  ok(existsSync(file), 'file exists')
  if (!existsSync(file)) { fail++; continue }
  try {
    const glb = parseGlb(file)
    ok(glb.version === 2, 'GLB version 2')
    ok(glb.json.asset?.version === '2.0', 'glTF asset version 2.0')
    const nodeNames = (glb.json.nodes ?? []).map((n) => n.name ?? '')
    ok(REQUIRED_NODES.every((n) => nodeNames.includes(n)), `hierarchy complete (${REQUIRED_NODES.join(', ')})`)
    if (gender === 'female') ok(nodeNames.includes('Ponytail'), 'female has the Ponytail node')
    ok((glb.json.meshes?.length ?? 0) >= 10, `meshes present (${glb.json.meshes?.length})`)
    ok((glb.json.materials?.length ?? 0) >= 6, `PBR materials present (${glb.json.materials?.length})`)
    const clips = glb.json.animations ?? []
    const names = clips.map((a) => a.name ?? '')
    ok(clips.length === REQUIRED_CLIPS.length, `all ${REQUIRED_CLIPS.length} clips exported (${clips.length})`)
    ok(REQUIRED_CLIPS.every((c) => names.includes(c)), `clip inventory complete: ${names.join(', ')}`)
    ok(clips.every((a) => a.channels.length > 0 && a.samplers.length > 0), 'every clip has channels + samplers')
    ok(glb.binLen > 0 && glb.binPadded, `binary chunk ${glb.binLen}B, 4-byte padded`)
  } catch (e) {
    fail++
    console.log(`  ✗ FAIL: parse error: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// GLBAssetManager error contract — invalid path resolves null (never rejects), bad URLs are cached as failed
console.log('— GLBAssetManager error contract —')
import { GLBAssetManager } from '../src/game/glb'
const mgr = new GLBAssetManager()
const bad = await mgr.load('/models/does-not-exist.glb')
ok(bad === null, 'invalid path → resolves null (fallback contract)')
ok(mgr.hasFailed('/models/does-not-exist.glb'), 'failed URL cached — no re-fetch storm')
const bad2 = await mgr.load('/models/does-not-exist.glb')
ok(bad2 === null, 'second load of bad URL short-circuits null')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
