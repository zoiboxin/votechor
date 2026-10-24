/**
 * Validate the professional skinned human GLBs (master prompt Phase 13).
 * Checks: skeleton joints, skin attributes (JOINTS_0/WEIGHTS_0), weight
 * normalization (≤4 influences, sum≈1), the 14-clip contract, animation
 * targets resolving to real nodes, height sanity, facial-rig node presence,
 * material naming. Exits 1 on any failure.
 *
 * Usage: bun scripts/validate-human.ts
 */
import * as fs from 'node:fs'

const FILES: [string, number][] = [
  ['public/models/votechor-human-male.glb', 1.9],
  ['public/models/votechor-human-female.glb', 1.7],
  ['public/models/votechor-human-child.glb', 1.26],
]

const REQUIRED_CLIPS = ['idle', 'walk', 'run', 'jump', 'doubleJump', 'fall', 'land', 'slide', 'hit', 'detained', 'recover', 'celebrate', 'throw', 'heal']
const REQUIRED_BONES = ['Hips', 'Torso', 'Chest', 'Neck', 'Head', 'ClavicleL', 'ClavicleR', 'ArmL', 'ArmR', 'ElbowL', 'ElbowR', 'HandL', 'HandR', 'LegL', 'LegR', 'KneeL', 'KneeR', 'FootL', 'FootR']
const REQUIRED_FACIAL = ['LidTopL', 'LidTopR', 'BrowL', 'BrowR', 'Jaw', 'PupilL', 'PupilR']

interface J {
  nodes: { name?: string; children?: number[]; mesh?: number; skin?: number; translation?: number[] }[]
  meshes: { name?: string; primitives: { attributes: Record<string, number>; indices?: number }[] }[]
  accessors: { componentType: number; count: number; type: string; min?: number[]; max?: number[] }[]
  skins?: { joints: number[]; inverseBindMatrices: number }[]
  animations: { name: string; channels: { target: { node: number; path: string } }[] }[]
  materials?: { name?: string }[]
  scenes: { nodes: number[] }[]
}

function readGlbJson(file: string): J {
  const buf = fs.readFileSync(file)
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not GLB`)
  const jsonLen = buf.readUInt32LE(12)
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
}

let failures = 0
const fail = (msg: string) => { console.error(`  ✗ ${msg}`); failures++ }
const pass = (msg: string) => console.log(`  ✓ ${msg}`)

for (const [file, expectedH] of FILES) {
  console.log(`\n=== ${file} ===`)
  if (!fs.existsSync(file)) { fail('FILE MISSING'); continue }
  const kb = fs.statSync(file).size / 1024
  pass(`size ${kb.toFixed(0)} KB${kb > 2500 ? ' — TOO BIG' : ''}`)
  if (kb > 2500) fail('asset over 2.5 MB budget')
  const j = readGlbJson(file)

  // ---- skeleton ----
  const nodeName = new Map<number, string>()
  j.nodes.forEach((n, i) => { if (n.name) nodeName.set(i, n.name) })
  const nameNode = new Map<string, number>()
  nodeName.forEach((v, k) => { if (!nameNode.has(v)) nameNode.set(v, k) })
  const missingBones = REQUIRED_BONES.filter((b) => !nameNode.has(b))
  if (missingBones.length) fail(`missing bones: ${missingBones.join(', ')}`)
  else pass(`all ${REQUIRED_BONES.length} contract bones present`)

  // ---- skins ----
  const skins = j.skins ?? []
  if (!skins.length) fail('NO SKINS — meshes are not bound to a skeleton')
  else {
    pass(`${skins.length} skin(s), joints: ${(skins[0].joints ?? []).length}`)
    for (const s of skins) {
      for (const joint of s.joints) if (!nodeName.has(joint)) { fail('skin joint points at unnamed node'); break }
    }
  }

  // ---- skinned mesh attributes + weights ----
  let skinnedMeshes = 0
  let totalTris = 0
  j.meshes.forEach((m) => {
    for (const prim of m.primitives) {
      const a = prim.attributes
      if (a.JOINTS_0 !== undefined && a.WEIGHTS_0 !== undefined) skinnedMeshes++
      if (a.POSITION !== undefined) {
        const acc = j.accessors[a.POSITION]
        const idx = prim.indices !== undefined ? j.accessors[prim.indices].count : acc.count
        totalTris += Math.floor(idx / 3)
      }
    }
  })
  if (!skinnedMeshes) fail('no skinned primitives (JOINTS_0/WEIGHTS_0)')
  else pass(`${skinnedMeshes} skinned meshes, ~${totalTris} triangles`)

  // weight sanity: parse WEIGHTS_0 accessor from the binary chunk of one mesh
  {
    const buf = fs.readFileSync(file)
    const jsonLen = buf.readUInt32LE(12)
    const binStart = 20 + jsonLen + 8
    const bin = buf.subarray(binStart)
    const withViews = j as unknown as { bufferViews: { byteOffset?: number; buffer: number }[] }
    const mesh0 = j.meshes.find((m) => m.primitives[0].attributes.WEIGHTS_0 !== undefined)
    if (mesh0) {
      const acc = j.accessors[mesh0.primitives[0].attributes.WEIGHTS_0]
      const view = withViews.bufferViews[(acc as unknown as { bufferView: number }).bufferView]
      const base = (view?.byteOffset ?? 0) + ((acc as unknown as { byteOffset?: number }).byteOffset ?? 0)
      const n = acc.count
      let bad = 0
      for (let i = 0; i < n; i++) {
        let sum = 0
        for (let k = 0; k < 4; k++) sum += bin.readFloatLE(base + (i * 4 + k) * 4)
        if (Math.abs(sum - 1) > 0.02) bad++
      }
      if (bad) fail(`${bad}/${n} vertices with unnormalized weights`)
      else pass(`weights normalized on first skinned mesh (${n} verts)`)
    }
  }

  // ---- height sanity (world bounds: accessor min/max + node translation chain) ----
  {
    const parent = new Map<number, number>()
    j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)))
    const worldY = (i: number): number => {
      let y = 0, cur: number | undefined = i
      while (cur !== undefined) { y += j.nodes[cur].translation?.[1] ?? 0; cur = parent.get(cur) }
      return y
    }
    let minY = Infinity, maxY = -Infinity
    j.nodes.forEach((n) => {
      if (n.mesh === undefined) return
      const wy = worldY(j.nodes.indexOf(n))
      const acc = j.accessors[j.meshes[n.mesh].primitives[0].attributes.POSITION]
      if (acc.min && acc.max) { minY = Math.min(minY, acc.min[1] + wy); maxY = Math.max(maxY, acc.max[1] + wy) }
    })
    if (Math.abs((maxY - minY) - expectedH) > 0.14) fail(`height ${(maxY - minY).toFixed(2)} m ≠ expected ~${expectedH} m`)
    else pass(`height ${(maxY - minY).toFixed(2)} m (expected ~${expectedH})`)
    if (minY < -0.06) fail(`geometry below ground: y=${minY.toFixed(3)}`)
    else pass(`ground alignment ok (min y ${minY.toFixed(3)})`)
    if (maxY > expectedH + 0.25) fail(`implausibly tall: ${maxY.toFixed(2)} m — double-transform bug?`)
  }

  // ---- clips ----
  const clipNames = j.animations.map((a) => a.name)
  const missingClips = REQUIRED_CLIPS.filter((c) => !clipNames.includes(c))
  if (missingClips.length) fail(`missing clips: ${missingClips.join(', ')}`)
  else pass(`all ${REQUIRED_CLIPS.length} contract clips present`)
  const dupes = clipNames.filter((c, i) => clipNames.indexOf(c) !== i)
  if (dupes.length) fail(`duplicate clips: ${dupes.join(', ')}`)

  // animation targets resolve to named nodes
  let badTargets = 0
  const targetNames = new Set<string>()
  for (const anim of j.animations) {
    for (const ch of anim.channels) {
      const nm = nodeName.get(ch.target.node)
      if (!nm) badTargets++
      else targetNames.add(nm)
    }
  }
  if (badTargets) fail(`${badTargets} animation channels target unnamed nodes`)
  else pass(`all animation channels target named nodes (${targetNames.size} distinct)`)
  const ghostTargets = [...targetNames].filter((t) => REQUIRED_BONES.includes(t) && !nameNode.has(t))
  if (ghostTargets.length) fail(`tracks target missing bones: ${ghostTargets.join(', ')}`)

  // ---- facial rig nodes ----
  const missingFace = REQUIRED_FACIAL.filter((f) => !nameNode.has(f))
  if (missingFace.length) fail(`missing facial-rig nodes: ${missingFace.join(', ')}`)
  else pass(`facial-rig nodes present (${REQUIRED_FACIAL.join(', ')})`)

  // gait clips must drive Foot bones (foot-roll)
  const walkAnim = j.animations.find((a) => a.name === 'walk')
  const walkTargets = new Set((walkAnim?.channels ?? []).map((c) => nodeName.get(c.target.node)))
  if (!walkTargets.has('FootL') || !walkTargets.has('FootR')) fail('walk clip does not drive FootL/FootR (no foot-roll)')
  else pass('walk clip drives foot-roll (FootL/FootR tracks)')

  // ---- materials named ----
  const unnamed = (j.materials ?? []).filter((m) => !m.name).length
  if (unnamed) fail(`${unnamed} unnamed materials`)
  else pass(`${j.materials?.length ?? 0} named materials`)
}

console.log(failures ? `\nVALIDATION FAILED (${failures})` : '\nALL VALIDATIONS PASS')
process.exit(failures ? 1 : 0)
