/**
 * Task 107 — analyze every GLB in the characters pack:
 * - materials (for tint maps)
 * - animations (names + durations)
 * - skins / joint counts
 * - top-level node names (for safe flips)
 * - FACING PROOF: sample the first mesh primitive accessor min/max on Z
 *   (eyes/brows/toes at +z ⇒ faces +Z; back items at −z confirm)
 */
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const dir = process.argv[2] ?? '/home/z/my-project/upload/characters-pack'

interface Report {
  file: string
  bytes: number
  nodes: number
  skins: number
  joints: number
  materials: string[]
  anims: { name: string; dur: number; targets: number }[]
  roots: string[]
  zRangeOfFirstMesh: [number, number] | null
  yTop: number | null
  hasSkinMat: boolean
}

function analyze(file: string): Report | null {
  const buf = readFileSync(join(dir, file))
  // GLB header: magic(4) version(4) length(4); JSON chunk: len(4) type(4)
  const jsonLen = buf.readUInt32LE(12)
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'))
  // BIN chunk starts after JSON chunk + its 8-byte header
  const binStart = 20 + jsonLen + 8

  const nodes = json.nodes ?? []
  const skins = json.skins ?? []
  const mats = (json.materials ?? []).map((m: { name?: string }) => m.name ?? '?')
  const anims = (json.animations ?? []).map((a: { name?: string; channels: unknown[]; samplers: { input: number }[] }) => {
    // duration from sampler input accessor max
    let dur = 0
    for (const s of a.samplers) {
      const acc = json.accessors[s.input]
      if (acc?.max?.[0]) dur = Math.max(dur, acc.max[0])
    }
    return { name: a.name ?? '?', dur: Math.round(dur * 100) / 100, targets: a.channels.length }
  })

  // roots = nodes not targeted by any child relationship
  const childSet = new Set<number>()
  for (const n of nodes) for (const c of n.children ?? []) childSet.add(c)
  // skinned meshes' skeleton joints are also parented; scene roots:
  const sceneRoots = (json.scenes?.[0]?.nodes ?? []).filter((i: number) => !childSet.has(i)).map((i: number) => nodes[i].name ?? `#${i}`)

  // facing proof: find accessors referenced by POSITION of first few mesh prims,
  // take global min/max Z across all POSITION accessors used by meshes
  let zMin = Infinity, zMax = -Infinity, yMax = -Infinity
  const seen = new Set<number>()
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const posIdx = prim.attributes?.POSITION
      if (posIdx == null || seen.has(posIdx)) continue
      seen.add(posIdx)
      const acc = json.accessors[posIdx]
      if (acc.min && acc.max) {
        zMin = Math.min(zMin, acc.min[2])
        zMax = Math.max(zMax, acc.max[2])
        yMax = Math.max(yMax, acc.max[1])
      }
    }
  }

  return {
    file,
    bytes: buf.length,
    nodes: nodes.length,
    skins: skins.length,
    joints: skins[0]?.joints?.length ?? 0,
    materials: mats,
    anims,
    roots: sceneRoots,
    zRangeOfFirstMesh: zMin === Infinity ? null : [Math.round(zMin * 100) / 100, Math.round(zMax * 100) / 100],
    yTop: yMax === -Infinity ? null : Math.round(yMax * 100) / 100,
    hasSkinMat: mats.some((m: string) => /^skin$/i.test(m)),
  }
}

const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.glb') && !f.startsWith('.')).sort()
for (const f of files) {
  try {
    const r = analyze(f)
    if (!r) continue
    console.log(`\n### ${r.file}  (${(r.bytes / 1e6).toFixed(1)} MB)`)
    console.log(`  nodes=${r.nodes} skins=${r.skins} joints=${r.joints} hasSkinMat=${r.hasSkinMat}`)
    console.log(`  roots: ${r.roots.join(', ')}`)
    console.log(`  mesh Z range: ${r.zRangeOfFirstMesh ? r.zRangeOfFirstMesh.join(' .. ') : 'n/a'}   Y top: ${r.yTop}`)
    console.log(`  materials(${r.materials.length}): ${r.materials.join(', ')}`)
    console.log(`  anims(${r.anims.length}): ${r.anims.map(a => `${a.name}[${a.dur}s]`).join(', ')}`)
  } catch (e) {
    console.log(`\n### ${f}  ERROR: ${(e as Error).message}`)
  }
}
