// VoteChor asset tool — turns the uploaded T-pose avatar (promptplay-male) into an
// A-pose game character. The model has NO rig/skin: limbs are fused into the
// AvatarBody mesh, so we rotate the arm-region vertices offline around the
// shoulder pivots (skinning-style smoothstep blend) and bake the result into
// the POSITION/NORMAL accessors. The BIN chunk layout is preserved byte-for-byte
// (same sizes/offsets) so bufferViews stay valid; only the JSON chunk is
// re-serialized (padded to 4 bytes with spaces).
//
// Usage: bun scripts/fix-avatar-pose.ts <in.glb> <out.glb>
// Measurements this bakes (from accessor inspection):
//   - shoulder pivot  (±0.215, 1.547)
//   - arm tube        x 0.225..0.95 at y 1.485..1.597
//   - shirt hem max|x| 0.209  → offline blend smoothstep(0.20, 0.30, |x|)
//   - model faces +Z, feet at y=0, head top y=1.957

import * as fs from 'fs'

const IN = process.argv[2] ?? 'upload/promptplay-male-1717.glb'
const OUT = process.argv[3] ?? 'public/models/votechor-male.glb'

const PIVOT_X = 0.215
const PIVOT_Y = 1.547
const ANGLE_DEG = 78 // arms down from horizontal T-pose
const W_LO = 0.2 // smoothstep band (hem-safe: hem ends at 0.209)
const W_HI = 0.3

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const buf = fs.readFileSync(IN)
const magic = buf.readUInt32LE(0)
if (magic !== 0x46546c67) throw new Error('not a GLB')
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
// BIN chunk data starts after the 8-byte BIN chunk header (verified against PNG signatures)
const binStart = 20 + jsonLen + 8
const bin = buf.subarray(binStart)
const accs = json.accessors ?? []
const bvs = json.bufferViews ?? []

const targetMeshes = new Set(['AvatarBody', 'outfit_top'])
let touched = 0
for (const mesh of json.meshes ?? []) {
  if (!targetMeshes.has(mesh.name)) continue
  for (const prim of mesh.primitives) {
    for (const semantic of ['POSITION', 'NORMAL'] as const) {
      const ai = prim.attributes[semantic]
      if (ai == null) continue
      const a = accs[ai]
      if (a.componentType !== 5126 || a.type !== 'VEC3') throw new Error(`${mesh.name}.${semantic}: unexpected layout`)
      const bv = bvs[a.bufferView]
      const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
      for (let i = 0; i < a.count; i++) {
        const o = off + i * 12
        const x = bin.readFloatLE(o)
        const y = bin.readFloatLE(o + 4)
        const sgn = x >= 0 ? 1 : -1
        const w = smooth(W_LO, W_HI, Math.abs(x))
        if (w < 0.0005) continue
        const ang = -sgn * (ANGLE_DEG * Math.PI / 180) * w
        const c = Math.cos(ang), s = Math.sin(ang)
        const dx = x - sgn * PIVOT_X, dy = y - PIVOT_Y
        bin.writeFloatLE(sgn * PIVOT_X + dx * c - dy * s, o)
        bin.writeFloatLE(PIVOT_Y + dx * s + dy * c, o + 4)
        if (semantic === 'POSITION') touched++
        else {
          // normals rotate about the same axis, no pivot translation
          const nx = bin.readFloatLE(o), ny = bin.readFloatLE(o + 4)
          bin.writeFloatLE(nx * c - ny * s, o)
          bin.writeFloatLE(nx * s + ny * c, o + 4)
        }
      }
    }
  }
}

// ---- verify post-transform bounds (arm extent + height) ----
let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9
{
  const mesh = (json.meshes ?? []).find((m: { name: string }) => m.name === 'AvatarBody')
  const a = accs[mesh.primitives[0].attributes.POSITION]
  const off = (bvs[a.bufferView].byteOffset ?? 0)
  for (let i = 0; i < a.count; i++) {
    const x = bin.readFloatLE(off + i * 12), y = bin.readFloatLE(off + i * 12 + 4)
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
}

// ---- re-serialize: new JSON chunk (space-padded to 4), same BIN bytes ----
const jsonBytes = Buffer.from(JSON.stringify(json))
const jsonPad = (4 - (jsonBytes.length % 4)) % 4
const jsonOut = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)])
const total = 12 + 8 + jsonOut.length + 8 + bin.length
const out = Buffer.alloc(total)
out.writeUInt32LE(0x46546c67, 0)
out.writeUInt32LE(2, 4)
out.writeUInt32LE(total, 8)
out.writeUInt32LE(jsonOut.length, 12)
// NOTE: three's GLTFLoader matches chunkType against 0x4E4F534A (ASCII "JSON"), NOT the
// glTF-spec value 0x46546C67 — the original upload used the same raw-ASCII spelling,
// which is the only variant this project's loader (three r186) accepts.
out.writeUInt32LE(0x4e4f534a, 16) // 'JSON' as three's GLTFLoader expects
jsonOut.copy(out, 20)
const binHeader = 20 + jsonOut.length
out.writeUInt32LE(bin.length, binHeader)
out.writeUInt32LE(0x004e4942, binHeader + 4) // 'BIN\0'
bin.copy(out, binHeader + 8)

fs.mkdirSync(OUT.substring(0, OUT.lastIndexOf('/')), { recursive: true })
fs.writeFileSync(OUT, out)
console.log(`A-posed ${touched} vertices → ${OUT} (${(out.length / 1048576).toFixed(1)}MB)`)
console.log(`AvatarBody post bbox: x ${minX.toFixed(3)}..${maxX.toFixed(3)}  y ${minY.toFixed(3)}..${maxY.toFixed(3)} (expect hands ≈ ±0.37, head top ≈ 1.96)`)
