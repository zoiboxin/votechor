// v47 — world integrity: the NEW solid-prop colliders (tagged `prop` in world-def)
// must not swallow items, block checkpoints or clip vehicle routes, and the main
// avenue corridor must stay passable. Pre-existing base geometry (buildings,
// fences, towers, tree trunks) is intentionally out of scope here — maps-test
// guards the variant EXTRAS, this guards the v47 prop pass.
import { buildWorldDef } from '../src/game/shared/world-def'
import { MAP_VARIANTS } from '../src/game/shared/maps'

let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`) }
  else { fail++; console.error(`  ✗ ${msg}`) }
}

const propsOf = (def: ReturnType<typeof buildWorldDef>) => def.colliders.filter(c => c.prop)

for (const variant of MAP_VARIANTS) {
  const def = buildWorldDef(variant.id)
  const props = propsOf(def)

  // 1. every item must remain collectable: not buried inside a prop box (3D —
  //    items under an elevated box like the flyover hoarding are fine)
  let swallowed = 0
  for (const it of def.items) {
    for (const c of props) {
      const inside = it.x > c.minX + 0.45 && it.x < c.maxX - 0.45 &&
        it.z > c.minZ + 0.45 && it.z < c.maxZ - 0.45 &&
        it.y > c.minY - 0.1 && it.y < c.maxY - 0.3
      if (inside) {
        swallowed++
        console.error(`    item ${it.id} (${it.x},${it.z},y${it.y}) inside prop [${c.minX.toFixed(1)},${c.minZ.toFixed(1)}..${c.maxX.toFixed(1)},${c.maxZ.toFixed(1)}]`)
        break
      }
    }
  }
  ok(swallowed === 0, `${variant.id}: all ${def.items.length} items collectable (none buried in a prop)`)

  // 2. checkpoint centers stay clear of prop boxes (activation is distance-based)
  let cpBlocked = 0
  for (const cp of def.checkpoints) {
    for (const c of props) {
      if (cp.x > c.minX && cp.x < c.maxX && cp.z > c.minZ && cp.z < c.maxZ && c.maxY > 0.7) { cpBlocked++; break }
    }
  }
  ok(cpBlocked === 0, `${variant.id}: all checkpoint centers clear of props`)

  // 3. vehicle polylines must not come within (1.3 + prop half-diagonal) of a prop
  //    center — true point-segment distance (AABB corridor overlap false-positives
  //    on diagonal routes like the maidan cow)
  const PAD = 1.3
  const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
    const dx = bx - ax, dz = bz - az
    const len2 = dx * dx + dz * dz || 1e-9
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2))
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
  }
  let clips = 0
  for (const v of def.vehicles) {
    for (const c of props) {
      if (c.maxY < 0.7) continue
      if (c.minY > 2) continue // elevated props (flyover hoarding) don't clip ground vehicles
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2
      const half = Math.max(c.maxX - c.minX, c.maxZ - c.minZ) / 2
      for (let i = 0; i < v.path.length - 1; i++) {
        const [ax, az] = v.path[i], [bx, bz] = v.path[i + 1]
        if (segDist(cx, cz, ax, az, bx, bz) < PAD + half) {
          clips++
          console.error(`    vehicle ${v.id} comes within ${(PAD + half).toFixed(1)}m of prop at (${cx.toFixed(1)},${cz.toFixed(1)}) h=${c.maxY}`)
          i = v.path.length
          break
        }
      }
    }
  }
  ok(clips === 0, `${variant.id}: no vehicle route clips a prop (${def.vehicles.length} routes)`)

  // 4. main avenue corridor |x|<8 always has a ≥1.2 m gap in every scanned row
  let blockedRows = 0
  for (let z = 10; z > -576; z -= 2) {
    const boxes = props.filter(c => c.maxY > 0.7 && c.minX < 8 && c.maxX > -8 && z > c.minZ && z < c.maxZ)
    if (boxes.length === 0) continue
    const spans = boxes.map(c => [Math.max(-8, c.minX), Math.min(8, c.maxX)] as [number, number]).sort((a, b) => a[0] - b[0])
    let cursor = -8, free = false
    for (const [s, e] of spans) {
      if (s - cursor >= 1.2) { free = true; break }
      cursor = Math.max(cursor, e)
    }
    if (!free && 8 - cursor >= 1.2) free = true
    if (!free) blockedRows++
  }
  ok(blockedRows === 0, `${variant.id}: main corridor |x|<8 always has a ≥1.2 m gap (${blockedRows} blocked rows)`)
}

console.log(`\n${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
