// Task 37 — deterministic street-tree spot verification.
// Checks candidate sidewalk tree spots (x ±11.5, avenue zones B/C) against ALL
// existing decorations + colliders so no new tree can overlap a prop, home,
// lamp, gate pillar, or road surface.
import { buildWorldDef } from '../src/game/shared/world-def'

const CANDIDATES: Array<[number, number]> = [
  [11.5, -100], [11.5, -140], [11.5, -164], [11.5, -226], [11.5, -262],
  [-11.5, -132], [-11.5, -158], [-11.5, -178], [-11.5, -210], [-11.5, -240], [-11.5, -268],
]

const w = buildWorldDef()
const CROSS = [[-78, 4.8], [-198, 5], [-286, 4], [-452, 5]]
let bad = 0
for (const [x, z] of CANDIDATES) {
  const issues: string[] = []
  // cross-road asphalt band (halfW + 3 sidewalk flare margin)
  for (const [cz, hw] of CROSS) if (Math.abs(z - cz) < hw + 6) issues.push(`cross road z=${cz}`)
  // main avenue asphalt x -8.5..8.5 (tree trunk clears by >2.6 m, double-check)
  if (Math.abs(x) < 10.2) issues.push('on avenue asphalt margin')
  // decorations within 2.6 m
  for (const d of w.decorations) {
    const dx = d.x - x, dz = d.z - z
    if (dx * dx + dz * dz < 2.6 * 2.6) issues.push(`deco ${d.kind} @(${d.x.toFixed(1)},${d.z.toFixed(1)}) d=${Math.hypot(dx, dz).toFixed(2)}`)
  }
  // colliders intersecting a 0.5 m tree trunk footprint
  for (const c of w.colliders) {
    if (x + 0.35 > c.minX - 0.4 && x - 0.35 < c.maxX + 0.4 && z + 0.35 > c.minZ - 0.4 && z - 0.35 < c.maxZ + 0.4) {
      issues.push(`collider [${c.minX},${c.minZ}..${c.maxX},${c.maxZ}] h=${c.maxY}`)
    }
  }
  if (issues.length) { bad++; console.log(`BAD  (${x},${z}) → ${issues.join(' | ')}`) }
  else console.log(`OK   (${x},${z})`)
}
console.log(bad === 0 ? 'ALL SPOTS CLEAR' : `${bad} SPOTS BLOCKED`)
