// Dump world transforms of nodes matching a filter (default shoe parts).
// Usage: bun scripts/tmp-dump-nodes.ts <file.glb> [nameFilter]
import * as fs from 'fs'

const file = process.argv[2] ?? 'public/models/votechor-human-male.glb'
const filter = process.argv[3] ?? 'Shoe|Sole|Toe|Collar|Tongue|Lace|HeelTab|Foot'
const buf = fs.readFileSync(file)
const jsonLen = buf.readUInt32LE(12)
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())

const nodes = json.nodes ?? []
const childrenOf = new Map<number, number[]>()
const parentOf = new Map<number, number>()
nodes.forEach((n: { children?: number[] }, i: number) => {
  for (const c of n.children ?? []) { childrenOf.set(i, childrenOf.get(i) ?? []); childrenOf.get(i)!.push(c); parentOf.set(c, i) }
})
const nodeName = (i: number) => nodes[i].name ?? `#${i}`

// compose world TRS (assumes TRS or matrix-with-translation only)
const world = new Map<number, { t: number[]; s: number[] }>()
function resolve(i: number): { t: number[]; s: number[] } {
  if (world.has(i)) return world.get(i)!
  const n = nodes[i]
  const t = (n.translation ?? [0, 0, 0]) as number[]
  const s = (n.scale ?? [1, 1, 1]) as number[]
  const p = parentOf.get(i)
  if (p === undefined) { const w = { t, s }; world.set(i, w); return w }
  const pw = resolve(p)
  const w = {
    t: [pw.t[0] + pw.s[0] * t[0], pw.t[1] + pw.s[1] * t[1], pw.t[2] + pw.s[2] * t[2]],
    s: [pw.s[0] * s[0], pw.s[1] * s[1], pw.s[2] * s[2]],
  }
  world.set(i, w)
  return w
}
const roots = nodes.map((_: unknown, i: number) => i).filter((i) => !parentOf.has(i))
roots.forEach(resolve)

const re = new RegExp(filter)
for (let i = 0; i < nodes.length; i++) {
  if (!re.test(nodeName(i))) continue
  const w = resolve(i)
  console.log(`${nodeName(i).padEnd(14)} world t=(${w.t.map((v) => v.toFixed(3)).join(', ')}) s=(${w.s.map((v) => v.toFixed(2)).join(', ')})`)
}
