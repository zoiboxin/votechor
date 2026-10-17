// VoteChor Task 43 — level-map variant invariants.
// Run: bun tests/maps-test.ts
//
// Every campaign district (maps.ts) must keep the SYNCED skeleton byte-identical
// to the classic world (spawn, zones, checkpoints, cross roads, boss arena and
// every item/npc/vehicle/searchlight id + payload) while re-theming the client
// experience. Variant extras are appended AFTER the skeleton and their ground
// colliders are validated clear of every synced element.
import { buildWorldDef } from '../src/game/shared/world-def'
import { MAP_VARIANTS, mapForLevel, nextMapUnlock } from '../src/game/shared/maps'
import { CROSS_ROADS } from '../src/game/shared/world-def'

let failures = 0
const ok = (cond: boolean, label: string) => {
  if (cond) console.log(`  ✓ ${label}`)
  else { console.error(`  ✗ FAIL: ${label}`); failures++ }
}
const json = (v: unknown) => JSON.stringify(v)

const classic = buildWorldDef('classic')
const skeletonOf = (w: ReturnType<typeof buildWorldDef>) => ({
  bounds: w.bounds, spawn: w.spawn, zones: w.zones, crossRoads: w.crossRoads,
  checkpoints: w.checkpoints, bossArena: w.bossArena,
  items: w.items, npcs: w.npcs, vehicles: w.vehicles, searchlights: w.searchlights,
})
const SKELETON = json(skeletonOf(classic))

// AABB overlap with a margin
const overlaps = (
  a: { minX: number; minZ: number; maxX: number; maxZ: number },
  b: { minX: number; minZ: number; maxX: number; maxZ: number },
  m = 0.4,
) => a.minX - m < b.maxX && a.maxX + m > b.minX && a.minZ - m < b.maxZ && a.maxZ + m > b.minZ

const hitItem = (items: { id: string; x: number; z: number }[], c: { minX: number; minZ: number; maxX: number; maxZ: number }) =>
  items.find((i) => c.minX - 1.6 < i.x && i.x < c.maxX + 1.6 && c.minZ - 1.6 < i.z && i.z < c.maxZ + 1.6)
const hitCheckpoint = (cps: { id: number; x: number; z: number; radius: number }[], c: { minX: number; minZ: number; maxX: number; maxZ: number }) =>
  cps.find((cp) => Math.hypot((c.minX + c.maxX) / 2 - cp.x, (c.minZ + c.maxZ) / 2 - cp.z) < cp.radius + 2.5)

console.log(`\n== maps-test: ${MAP_VARIANTS.length} districts ==`)
ok(MAP_VARIANTS.length === 6, 'six campaign districts registered')
ok(MAP_VARIANTS[0].id === 'classic', 'classic is the level-1 district')

for (const map of MAP_VARIANTS) {
  const w = buildWorldDef(map.id)
  console.log(`\n-- ${map.name} (${map.id}, Lv ${map.minLevel}+) --`)
  ok(json(skeletonOf(w)) === SKELETON, 'skeleton byte-identical to classic')
  ok(w.mapId === map.id && w.mapName === map.name, 'def stamped with map identity')
  ok(w.xpMul === map.xpMul && w.difficulty === map.difficulty, 'def stamped with difficulty/xpMul')
  ok(!!w.groundTint && !!w.roadTint, 'ground/road tints present')

  if (map.id === 'classic') {
    ok(w.decorations.length === classic.decorations.length, 'classic has zero extras')
    continue
  }

  // extras appended → skeleton prefix unchanged
  const baseDecos = classic.decorations.length
  ok(w.decorations.length > baseDecos, `extras appended (${w.decorations.length - baseDecos} props)`)
  ok(w.colliders.length >= classic.colliders.length, 'colliders never shrink')

  // palettes actually differ from classic (visual change is the point)
  const buildingColors = new Set(w.decorations.filter((d) => d.kind === 'building').map((d) => d.color))
  ok(!buildingColors.has('#c96f4a') || map.building.includes('#c96f4a'), 'building palette re-themed')

  // ---- placement safety for every GROUND collider the variant added ----
  const extraColliders = w.colliders.slice(classic.colliders.length)
  const baseColliders = classic.colliders
  const items = classic.items
  const vehicles = classic.vehicles
  const checkpoints = classic.checkpoints
  const arena = classic.bossArena
  const RUNWAY = { minX: -9.5, minZ: -430, maxX: 9.5, maxZ: 12 } // main avenue asphalt
  let clear = 0
  for (const c of extraColliders) {
    let hit = ''
    if (baseColliders.some((b) => overlaps(c, b, 0.3))) hit = 'base collider'
    if (!hit) {
      const it = hitItem(items, c)
      if (it) hit = `item ${it.id}`
    }
    if (!hit) {
      const cp = hitCheckpoint(checkpoints, c)
      if (cp) hit = `checkpoint ${cp.id}`
    }
    if (!hit) {
      for (const v of vehicles) {
        for (const [px, pz] of v.path) {
          if (px > c.minX - 2.4 && px < c.maxX + 2.4 && pz > c.minZ - 2.4 && pz < c.maxZ + 2.4) { hit = `vehicle ${v.id}`; break }
        }
        if (hit) break
      }
    }
    if (!hit && CROSS_ROADS.some((r) => c.minZ - 2.2 < r.z + r.halfW && r.z - r.halfW < c.maxZ + 2.2)) hit = 'cross-road lane'
    if (!hit && c.minZ < -452 && Math.hypot((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2 - arena.z) < arena.radius + 2) hit = 'boss arena'
    if (hit) { console.error(`  ✗ FAIL: extra collider [${c.minX},${c.minZ}..${c.maxX},${c.maxZ}] hits ${hit}`); failures++ }
    else clear++
  }
  ok(clear === extraColliders.length, `all ${extraColliders.length} extra ground colliders clear of the synced skeleton`)

  // stringLights/arch spans must not put solids ON the runway (poles sit at x ±9.65+)
  const runwayBlockers = extraColliders.filter((c) => overlaps(c, RUNWAY, 0))
  ok(runwayBlockers.length === 0, `nothing solid on the main runway (${runwayBlockers.length} found)`)
}
console.log('\n== level → district mapping ==')
const expectations: Array<[number, string]> = [[1, 'classic'], [2, 'classic'], [3, 'bazaar'], [4, 'bazaar'], [5, 'monsoon'], [7, 'depot'], [9, 'raat'], [12, 'azad'], [99, 'azad']]
for (const [lvl, id] of expectations) ok(mapForLevel(lvl).id === id, `level ${lvl} → ${id}`)
ok(!nextMapUnlock(99), 'no unlock beyond the finale district')

console.log('\n== difficulty & stakes curve ==')
let last = 0
for (const m of MAP_VARIANTS) {
  ok(m.xpMul > last || m.id === 'classic', `${m.name}: xpMul ${m.xpMul} monotonic`)
  last = Math.max(last, m.xpMul)
  ok(m.difficulty >= 1 && m.difficulty <= 5, `${m.name}: difficulty pips in range`)
}

console.log(failures === 0 ? '\nALL MAP TESTS PASS ✅' : `\n${failures} FAILURES ❌`)
process.exit(failures === 0 ? 0 : 1)
