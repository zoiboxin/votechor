// VoteChor world definition — deterministic procedural city data.
// PURE data generation (seeded RNG) so browser client and game server build identical worlds.
//
// GREATER VOTECHOR CITY (round 19): the old single-road strip grew into a real city —
// a 240m-wide grid with four east-west cross streets, residential mohallas full of
// small homes separated by narrow galis (alleys), a bazaar lane, a school, a bus
// depot, two parks and government quarters. The original 5-zone spine (plaza →
// market → checkpoint → avenue → parliament) is untouched down the middle.
import type { AABB, Deco, DecoKind, ItemSpawn, NpcSpawn, VehicleDef, WorldDef, SearchlightDef, CrossRoadDef } from './types'
import { mapById } from './maps'

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SHOP_NAMES = [
  'Sharma Chai & Snacks', 'Gupta Electronics', 'New Bharat Sarees', 'Verma Mobile Point',
  'Khan Biryani House', 'Mehta Optics', 'Anand Sweets & Farsan', 'Rajesh Tailors',
  'Singh Cyber Café', 'Devi General Store', 'Shree Ganesh Medicals', 'Lotus Beauty Parlour',
  'Jai Hind Book Depot', 'Yahoo Cycle Store', 'Patel Diagnostics', 'Chacha Tiffin Center',
  'Mumbai Mistri Hardware', 'Sunny Salon & WiFi', 'Golden Bakery', 'Krishna Dairy',
]
const SIGN_TEXTS = [
  'VOTE 4 CHAI', 'DOWN WITH PAPERWORK', 'MY VOTE MY CHAPPAL', 'BRING BACK THE VOTES',
  'SAVE DEMOCRACY (AND CRICKET)', 'FORM 12B RUINED MY LIFE', 'MONDAY IS THE REAL ENEMY',
  'I JUST WANT FREE WIFI', 'UNCLE WAS RIGHT', 'STAMP OUT STAMPING', 'CHAI > COMMITTEE',
  'LESS COMMITTEES MORE CRICKET', 'RETURN OUR VOTES OR RETURN OUR SAMOSAS', 'NO VOTE NO SLEEP',
  'DEMOCRACY DELAYED IS CHAI DENIED', 'AUNTY APPROVES THIS PROTEST',
]

const BUILDING_COLORS = ['#c96f4a', '#b85c3e', '#7f9a8c', '#c9a86a', '#9a7b5f', '#8d6e63', '#a3b18a', '#c2b280', '#b07d62', '#7e9bb0']
const HOME_COLORS = ['#d9b98a', '#cfa477', '#d8c49a', '#c2926a', '#bfae8e', '#d3b193', '#b9a27f', '#c8b093', '#c4a484', '#d6c8a8']
// zone-D roadworks hoardings (classic pool — variants swap these via maps.ts)
const HOARDING_TEXTS = ['VOTE RESPONSIBLY', 'HONK IF YOU LOVE FORMS', 'SPEED THRILLS BUT PAPERWORK KILLS', 'DEMOTE DAMAD, PROMOTE DEMOCRACY']

// East-west cross streets — exported so the minimap and renderer pave the same
// asphalt without duplicating layout numbers.
export const CROSS_ROADS: CrossRoadDef[] = [
  { z: -78, halfW: 4.8 },   // Plaza Cross Road (between the plaza and the market)
  { z: -198, halfW: 5 },    // Market Exit Cross Road (checkpoint 2 sits on this junction)
  { z: -286, halfW: 4 },    // Avenue Cross Road
  { z: -452, halfW: 5 },    // Colony Cross Road (government district)
]

let idc = 0
const nid = (p: string) => `${p}_${(idc++).toString(36)}`

/**
 * Build the deterministic city. `mapId` (Task 43) selects the campaign district:
 * the SKELETON (spawn/zones/checkpoints/cross roads/boss arena + every synced id)
 * is identical for all variants — only palettes, signage, ground/road tint and
 * the variant-only `extras` decor appended at the end differ. RNG call order is
 * untouched by the variant, so every build stays byte-deterministic.
 */
export function buildWorldDef(mapId: string = 'classic'): WorldDef {
  idc = 0
  const mapDef = mapById(mapId)
  const BLD = mapDef.building
  const HOMES = mapDef.homes
  const SHOPS = mapDef.shops ?? SHOP_NAMES
  const SIGNS = mapDef.signs ?? SIGN_TEXTS
  const rnd = mulberry32(20240614)
  const colliders: AABB[] = []
  const decorations: Deco[] = []
  const items: ItemSpawn[] = []
  const npcs: NpcSpawn[] = []
  const searchlights: SearchlightDef[] = []
  const vehicles: VehicleDef[] = []
  const landmarks: { name: string; x: number; z: number }[] = []

  const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, walkable = false) => {
    const c: AABB = { minX, minY, minZ, maxX, maxY, maxZ }
    if (walkable) c.walkable = true
    colliders.push(c)
    return c
  }
  const deco = (d: Deco) => { decorations.push(d); return d }

  // v47 — solid-prop helpers: previously scooters, benches, crates, tea kettles,
  // planters, the toilet, billboards and the checkpoint road barriers RENDERED
  // solid but had NO collider — the player visibly walked straight through them.
  // Every prop placement below now pairs its deco with a matching box.
  const solidBox = (x: number, z: number, w: number, d: number, h: number, y = 0) => { const c = box(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2); c.prop = true; return c }
  // ry-proof square footprints for rotated clutter (scooters park at any angle)
  const scooterBox = (x: number, z: number) => solidBox(x, z, 1.9, 1.9, 1.0)
  // bench seat — low + standable (step-up height)
  const benchBox = (x: number, z: number) => solidBox(x, z, 1.8, 0.9, 0.55)
  const kettleBox = (x: number, z: number) => solidBox(x, z, 1.1, 1.1, 1.4)
  const planterBox = (x: number, z: number) => solidBox(x, z, 1.5, 1.5, 1.0)
  const crateBoxS = (x: number, z: number, s: number) => solidBox(x, z, 1.15 * s, 1.15 * s, 1.2 * s)

  // east-west street band test — random props must not spawn on the asphalt
  const inCrossRoad = (z: number, pad = 1.6) => CROSS_ROADS.some(r => Math.abs(z - r.z) < r.halfW + pad)

  // small home (mohalla house) — instanced in the renderer, AABB collider here.
  // variant: 0 pitched roof, 1 flat roof. ry: 0 or π only (keeps the AABB honest).
  const home = (x: number, z: number, w: number, d: number, h: number, variant = 0, ry = 0) => {
    deco({ kind: 'home', x, z, w, d, h, variant, ry, color: HOMES[Math.floor(rnd() * HOMES.length)] })
    box(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2)
  }
  // compound / courtyard wall — 1.1m tall (sprint-vaultable) unless h given
  const wall = (x1: number, z1: number, x2: number, z2: number, h = 1.1) => {
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2)
    const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2)
    deco({ kind: 'wall', x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: Math.max(0.4, maxX - minX), d: Math.max(0.4, maxZ - minZ), h })
    box(minX, 0, minZ, maxX, h, maxZ)
  }
  const clothesline = (x: number, z: number, len: number, ry = 0) => deco({ kind: 'clothesline', x, z, w: len, ry })

  // Invisible world walls
  box(-124, 0, 10, 124, 14, 12)        // back wall (spawn side)
  box(-124, 0, -576, 124, 14, -572)    // far wall (parliament end)
  box(-124, 0, -576, -120, 14, 12)     // left wall
  box(120, 0, -576, 124, 14, 12)       // right wall

  // ================= ZONE A — PROTEST GATHERING PLAZA (z 0 .. -80) =================
  const plazaBuilding = (x: number, z: number, i: number) => {
    const w = 10 + rnd() * 8
    const d = 8 + rnd() * 6
    const h = 8 + rnd() * 8
    const color = BLD[Math.floor(rnd() * BLD.length)]
    deco({ kind: 'building', x, z, w, d, h, color, variant: Math.floor(rnd() * 3), sign: SHOPS[i % SHOPS.length] })
    box(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2)
  }
  for (let i = 0; i < 5; i++) { plazaBuilding(-22 - rnd() * 14, -6 - i * 15, i) }
  for (let i = 0; i < 5; i++) { plazaBuilding(22 + rnd() * 14, -8 - i * 15, i + 5) }

  // Fountain center
  deco({ kind: 'fountain', x: 0, z: -34, collider: true })
  box(-4.4, 0, -38.4, 4.4, 1.1, -29.6)
  landmarks.push({ name: 'Protest Fountain', x: 0, z: -34 })
  // Stage
  deco({ kind: 'stage', x: -16, z: -18, ry: 0.5 })
  box(-20, 0, -22, -12, 1.2, -14, true)
  // Food stalls row — v47: EVERY stall is solid now (half used to be walk-through
  // ghosts); 4.2 m pitch with 3.2 m stall boxes leaves 1.0 m gaps, so the market
  // lane stays passable and no vehicle route crosses this band.
  const stallKinds: DecoKind[] = ['stall', 'cart', 'teaKettle']
  for (let i = 0; i < 6; i++) {
    const x = -10 + i * 4.2, z = -52
    deco({ kind: stallKinds[i % 3], x, z, ry: Math.PI, variant: i, sign: SHOPS[(i + 8) % SHOPS.length], collider: true })
    // 2.6 m box on a 4.2 m pitch leaves a 1.6 m gap between stalls — solid to walk
    // through, but the central avenue corridor stays comfortably passable
    solidBox(x, z, 2.6, 2.6, 2.4)
  }
  // Street props (kept off the cross-road band at z -78)
  for (let i = 0; i < 8; i++) {
    const x = -26 + rnd() * 52, z = -4 - rnd() * 66
    if (Math.abs(x) < 9) continue
    deco({ kind: 'tree', x, z, s: 0.8 + rnd() * 0.6, variant: Math.floor(rnd() * 2) })
    box(x - 0.35, 0, z - 0.35, x + 0.35, 3, z + 0.35)
  }
  for (let i = 0; i < 6; i++) { const bx = -14 + i * 5.6; deco({ kind: 'bench', x: bx, z: -12, ry: Math.PI }); benchBox(bx, -12) }
  for (let i = 0; i < 5; i++) { const sx = -30 + rnd() * 8, sz = -30 - i * 9; deco({ kind: 'scooter', x: sx, z: sz, ry: 0.3 + rnd() * 0.4 }); scooterBox(sx, sz) }
  for (let i = 0; i < 4; i++) deco({ kind: 'lamp', x: i % 2 ? 9 : -9, z: -10 - i * 20 })
  // Tutorial ring (train area)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const cx = 16 + Math.cos(a) * 6, cz = -64 + Math.sin(a) * 6
    deco({ kind: 'crate', x: cx, z: cz, ry: a, s: 0.9 })
    crateBoxS(cx, cz, 0.9)
  }
  box(10, 0, -70, 22, 1.1, -58) // tutorial platform to jump on
  landmarks.push({ name: 'Training Ring', x: 16, z: -64 })
  // Crowd of ambient protesters in plaza
  for (let i = 0; i < 24; i++) {
    const x = -20 + rnd() * 40, z = -6 - rnd() * 60
    if (Math.abs(x) < 5 && z > -20) continue
    if (inCrossRoad(z)) continue
    deco({ kind: 'crowd', x, z, ry: rnd() * Math.PI * 2, variant: Math.floor(rnd() * 6), sign: rnd() < 0.55 ? SIGNS[Math.floor(rnd() * SIGNS.length)] : undefined })
  }
  // Plaza billboards — v47: solid now; the middle one sits at z -35 (was -38) so
  // the bazaar's festival-stall extra at (12.5, -40) stays clear of its box
  for (let i = 0; i < 3; i++) { const bx = i % 2 ? 14 : -14, bz = i === 1 ? -35 : -20 - i * 18; deco({ kind: 'billboard', x: bx, z: bz, ry: i % 2 ? -0.6 : 0.6, sign: SIGNS[(i * 5) % SIGNS.length] }); solidBox(bx, bz, 4.6, 1.6, 3.4) }
  deco({ kind: 'toilet', x: 30, z: -70 }); solidBox(30, -70, 1.3, 1.7, 2.4)

  // Plaza items
  items.push(
    { id: 'A_tok_1', type: 'token', x: -26, y: 1, z: -44 },
    { id: 'A_tok_2', type: 'token', x: 24, y: 1.15, z: -64 }, // on tutorial platform
    { id: 'A_chai_1', type: 'chai', x: -8.6, y: 1, z: -52 },
    { id: 'A_chai_2', type: 'chai', x: 6.5, y: 1, z: -46 },
    { id: 'A_bot_1', type: 'bottle', x: 4, y: 1, z: -22 },
    { id: 'A_bot_2', type: 'bottle', x: -4, y: 1, z: -60 },
    { id: 'A_sign_1', type: 'sign', x: 12, y: 1, z: -30 },
    { id: 'A_aid_1', type: 'firstaid', x: 30, y: 1, z: -16 },
    { id: 'A_joke_1', type: 'joke', x: 16, y: 1.15, z: -62 },
    { id: 'A_chai_3', type: 'chai', x: -6, y: 1, z: -66 },
    { id: 'A_snack_3', type: 'snack', x: 6, y: 1, z: -60 },
  )

  // Plaza NPCs (light) — patrol the SIDES of the plaza; the center road stays a fair tutorial run
  npcs.push(
    { id: 'npcA1', type: 'police', x: -20, z: -40, patrol: [[-20, -38], [-28, -42], [-28, -58], [-18, -56]], zone: 0 },
    { id: 'npcA2', type: 'police', x: 20, z: -30, patrol: [[20, -28], [26, -34], [26, -50], [16, -48]], zone: 0 },
  )

  // ================= ZONE B — BUSY MARKET STREETS (z -80 .. -200) =================
  // Narrow road: buildings closer, dense stalls. Rows stop short of the Market
  // Exit cross road (z -198) so the junction stays open.
  for (let i = 0; i < 8; i++) {
    const w = 8 + rnd() * 6, d = 7 + rnd() * 5, h = 7 + rnd() * 9
    const x = -(11 + w / 2 + rnd() * 4), z = -86 - i * 13
    deco({ kind: 'building', x, z, w, d, h, color: BLD[Math.floor(rnd() * BLD.length)], variant: 1, sign: SHOPS[(i + 3) % SHOPS.length] })
    box(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2)
  }
  for (let i = 0; i < 8; i++) {
    const w = 8 + rnd() * 6, d = 7 + rnd() * 5, h = 7 + rnd() * 9
    const x = 11 + w / 2 + rnd() * 4, z = -88 - i * 13
    deco({ kind: 'building', x, z, w, d, h, color: BLD[Math.floor(rnd() * BLD.length)], variant: 2, sign: SHOPS[(i + 11) % SHOPS.length] })
    box(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2)
  }
  // Dense market stalls along road edges
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1
    const x = side * (7.5 + (i % 3) * 1.6), z = -86 - i * 8.4
    deco({ kind: 'stall', x, z, ry: side > 0 ? Math.PI / 2 : -Math.PI / 2, variant: i % 4, sign: SHOPS[(i * 3 + 2) % SHOPS.length] })
    box(x - 1.7, 0, z - 1.7, x + 1.7, 2.4, z + 1.7)
  }
  // Overhead banners across the market street
  for (let i = 0; i < 5; i++) deco({ kind: 'banner', x: 0, z: -96 - i * 24, ry: 0, sign: SIGNS[(i * 3 + 1) % SIGNS.length] })
  // Carts and scooters blocking lanes
  for (let i = 0; i < 8; i++) {
    const x = -4 + rnd() * 8, z = -92 - i * 13 - rnd() * 4
    if (i % 3 === 0) { deco({ kind: 'cart', x, z, ry: rnd() * 3, collider: true }); box(x - 1.2, 0, z - 1.2, x + 1.2, 1.5, z + 1.2) }
    else { const sx2 = x > 0 ? x + 3 : x - 3; deco({ kind: 'scooter', x: sx2, z, ry: rnd() * 6.28 }); scooterBox(sx2, z) }
  }
  for (let i = 0; i < 10; i++) {
    const x = -20 + rnd() * 40, z = -84 - rnd() * 104
    if (Math.abs(x) < 9.5) continue
    if (inCrossRoad(z)) continue
    deco({ kind: 'crowd', x, z, ry: rnd() * 6.28, variant: Math.floor(rnd() * 6), sign: rnd() < 0.3 ? SIGNS[Math.floor(rnd() * SIGNS.length)] : undefined })
  }
  for (let i = 0; i < 6; i++) { const x = i % 2 ? 10.5 : -10.5, z = -90 - i * 18; deco({ kind: 'lamp', x, z }) }
  landmarks.push({ name: 'Chowk Market', x: 0, z: -140 })

  items.push(
    { id: 'B_tok_1', type: 'token', x: -13, y: 1, z: -104 },
    { id: 'B_tok_2', type: 'token', x: 14.5, y: 1, z: -152 },
    { id: 'B_tok_3', type: 'token', x: 0, y: 1, z: -186 },
    { id: 'B_chai_1', type: 'chai', x: 8.9, y: 1, z: -120 },
    { id: 'B_chai_2', type: 'chai', x: -9.3, y: 1, z: -164 },
    { id: 'B_bot_1', type: 'bottle', x: 3, y: 1, z: -96 },
    { id: 'B_bot_2', type: 'bottle', x: -5, y: 1, z: -132 },
    { id: 'B_bot_3', type: 'bottle', x: 6, y: 1, z: -172 },
    { id: 'B_sign_1', type: 'sign', x: -6, y: 1, z: -110 },
    { id: 'B_snack_1', type: 'snack', x: 12, y: 1, z: -136 },
    { id: 'B_snack_2', type: 'snack', x: -15, y: 1, z: -178 },
    { id: 'B_aid_1', type: 'firstaid', x: -13, y: 1, z: -146 },
    { id: 'B_joke_1', type: 'joke', x: 15, y: 1, z: -192 },
    { id: 'B_snack_3', type: 'snack', x: 2, y: 1, z: -116 },
    { id: 'B_aid_2', type: 'firstaid', x: -2, y: 1, z: -148 },
    { id: 'B_chai_3', type: 'chai', x: 3, y: 1, z: -180 },
    { id: 'B_joke_2', type: 'joke', x: -2, y: 1, z: -104 },
  )

  npcs.push(
    { id: 'npcB1', type: 'police', x: -4, z: -100, patrol: [[-4, -100], [4, -112], [-4, -124], [4, -136]], zone: 1 },
    { id: 'npcB2', type: 'police', x: 5, z: -130, patrol: [[5, -130], [-5, -142], [5, -154], [-5, -166]], zone: 1 },
    { id: 'npcB3', type: 'police', x: -12, z: -150, patrol: [[-12, -150], [-12, -176], [12, -180], [12, -152]], zone: 1 },
    { id: 'npcB4', type: 'police', x: 0, z: -176, patrol: [[0, -176], [8, -186], [-8, -194], [0, -166]], zone: 1 },
  )

  // ================= SIDE CITY — WEST, BAND 0 (z -10 .. -72, x -114 .. -42) =================
  // Purani Gali upper rows + a dusty maidan (open ground) behind the plaza.
  {
    for (let r = 0; r < 2; r++) {
      const zRow = -14 - r * 10
      for (let k = 0; k < 7; k++) {
        const w = 6 + rnd() * 1.6
        const x = -110 + k * 9.4 + rnd() * 1.2
        home(x, zRow, w, 6.4, 3.4 + rnd() * 1.6, k % 3 === 1 ? 1 : 0)
      }
    }
    // maidan — open ground with neem trees, benches and a chai cart
    for (let i = 0; i < 6; i++) {
      const x = -108 + i * 12 + rnd() * 4, z = -38 - (i % 3) * 9
      deco({ kind: 'tree', x, z, s: 0.9 + rnd() * 0.5, variant: i % 2 })
      box(x - 0.35, 0, z - 0.35, x + 0.35, 3, z + 0.35)
    }
    for (let i = 0; i < 3; i++) { const bx = -96 + i * 14; deco({ kind: 'bench', x: bx, z: -46, ry: rnd() * 3 }); benchBox(bx, -46) }
    deco({ kind: 'teaKettle', x: -66, z: -58.6, ry: 0.8 }); kettleBox(-66, -58.6) // v47 — nudged clear of the cow route
    deco({ kind: 'cart', x: -88, z: -60, ry: -0.4 }); solidBox(-88, -60, 2.4, 2.4, 1.5)
    for (let i = 0; i < 4; i++) { const sx = -106 + i * 15, sz = -64 - rnd() * 3; deco({ kind: 'scooter', x: sx, z: sz, ry: rnd() * 6.28 }); scooterBox(sx, sz) }
    for (let i = 0; i < 4; i++) deco({ kind: 'crowd', x: -100 + i * 16 + rnd() * 5, z: -36 - rnd() * 24, ry: rnd() * 6.28, variant: i % 6 })
    // low wall with a gate gap facing the plaza margin
    wall(-42, -34, -42, -50); wall(-42, -56, -42, -70)
    clothesline(-90, -22, 8)
    clothesline(-60, -30, 7, Math.PI / 2)
  }

  // ================= SIDE CITY — WEST, BAND 1 (z -86 .. -190) — PURANI GALI MOHALLA ====
  {
    landmarks.push({ name: 'Purani Gali', x: -78, z: -120 })
    const rowPitch = 9.7
    for (let r = 0; r < 8; r++) {
      const zRow = -88 - r * rowPitch
      for (let k = 0; k < 8; k++) {
        // two north-south galis cut through the block at k 2 and k 5
        if (k === 2 || k === 5) continue
        const w = 6 + rnd() * 1.8
        const x = -111 + k * 9.3 + rnd()
        home(x, zRow, w, 6.5, 3.2 + rnd() * 1.8, (r + k) % 3 === 2 ? 1 : 0, k % 2 ? Math.PI : 0)
      }
      // clotheslines strung across the row galis + alley clutter
      if (r % 2 === 0) clothesline(-102.5, zRow + rowPitch / 2 - 3.25, 6)
      if (r % 2 === 1) clothesline(-75.5, zRow + rowPitch / 2 - 3.25, 7)
      if (r % 3 === 1) { deco({ kind: 'crate', x: -49, z: zRow + 4.8, ry: rnd(), s: 0.8 }); box(-50, 0, zRow + 3.8, -48, 1.3, zRow + 5.8) }
      if (r % 4 === 2) { deco({ kind: 'scooter', x: -66.5, z: zRow + rowPitch / 2, ry: rnd() * 6.28 }); scooterBox(-66.5, zRow + rowPitch / 2) }
      if (r === 5) { deco({ kind: 'cart', x: -89.5, z: zRow + rowPitch / 2, ry: 1.2, collider: true }); box(-90.7, 0, zRow + 3.6, -88.3, 1.5, zRow + 6) }
    }
    // courtyard compound mid-block: walls with a narrow entrance
    wall(-96, -115.8, -80, -115.8); wall(-96, -115.8, -96, -128.6); wall(-80, -115.8, -80, -123)
    home(-88, -122, 7, 6, 3.6, 0)
    deco({ kind: 'planter', x: -94, z: -124 }); planterBox(-94, -124)
    deco({ kind: 'planter', x: -82, z: -124 }); planterBox(-82, -124)
    // south garden (bageecha) between the last row and the checkpoint zone
    for (let i = 0; i < 5; i++) {
      const x = -108 + i * 16 + rnd() * 5, z = -168 - rnd() * 14
      deco({ kind: 'tree', x, z, s: 1 + rnd() * 0.5, variant: i % 2 })
      box(x - 0.35, 0, z - 0.35, x + 0.35, 3, z + 0.35)
    }
    deco({ kind: 'bench', x: -92, z: -174, ry: 0.4 }); benchBox(-92, -174)
    deco({ kind: 'bench', x: -64, z: -178, ry: -1.2 }); benchBox(-64, -178)
    deco({ kind: 'teaKettle', x: -52, z: -166, ry: -0.6 }); kettleBox(-52, -166)
    for (let i = 0; i < 4; i++) deco({ kind: 'crowd', x: -108 + i * 18 + rnd() * 6, z: -164 - rnd() * 20, ry: rnd() * 6.28, variant: (i + 2) % 6, sign: rnd() < 0.4 ? SIGNS[i * 3 % SIGNS.length] : undefined })
    // lamps lighting the two long galis
    deco({ kind: 'lamp', x: -66.5, z: -102, ry: Math.PI / 2 })
    deco({ kind: 'lamp', x: -93.5, z: -140, ry: -Math.PI / 2 })
    items.push(
      { id: 'S1_tok', type: 'token', x: -66.5, y: 1, z: -121 },   // hidden in the N-S gali
      { id: 'S1_chai', type: 'chai', x: -76, y: 1, z: -176 },
      { id: 'S1_bot', type: 'bottle', x: -88.9, y: 1, z: -93 },
      { id: 'S1_aid', type: 'firstaid', x: -92.4, y: 1, z: -146.4 },
      { id: 'S1_joke', type: 'joke', x: -48, y: 1, z: -170 },
    )
    npcs.push({ id: 'npcS1', type: 'police', x: -66, z: -92, patrol: [[-66, -92], [-92, -94], [-94, -120], [-66, -118]], zone: 1 })
  }

  // ================= SIDE CITY — EAST, BAND 0+1 (z -10 .. -190) — NAYA BAZAAR ========
  {
    landmarks.push({ name: 'Naya Bazaar', x: 78, z: -104 })
    // shop row A facing the Plaza Cross Road
    for (let k = 0; k < 5; k++) {
      const w = 8 + rnd() * 3, d = 7 + rnd() * 2, h = 5 + rnd() * 2.5
      const x = 50 + k * 12.6 + rnd()
      deco({ kind: 'building', x, z: -91, w, d, h, color: BLD[(k + 2) % BLD.length], variant: 2, sign: SHOPS[(k + 5) % SHOPS.length] })
      box(x - w / 2, 0, -94.5, x + w / 2, h, -87.5)
    }
    // shop row B across the bazaar lane
    for (let k = 0; k < 5; k++) {
      const w = 8 + rnd() * 3, d = 7 + rnd() * 2, h = 5 + rnd() * 3
      const x = 52 + k * 12.4 + rnd()
      deco({ kind: 'building', x, z: -112, w, d, h, color: BLD[(k + 6) % BLD.length], variant: 1, sign: SHOPS[(k + 13) % SHOPS.length] })
      box(x - w / 2, 0, -115.5, x + w / 2, h, -108.5)
    }
    // back alley behind row B: crates, scooters, clotheslines — the shortcut gali
    for (let i = 0; i < 5; i++) {
      const x = 48 + i * 14 + rnd() * 4, z = -121.5
      deco({ kind: 'crate', x, z, ry: rnd(), s: 0.9 + rnd() * 0.4 })
      box(x - 0.9, 0, z - 0.9, x + 0.9, 1.5, z + 0.9)
    }
    deco({ kind: 'scooter', x: 58, z: -119, ry: 0.4 }); scooterBox(58, -119)
    deco({ kind: 'scooter', x: 86, z: -123, ry: 2.2 }); scooterBox(86, -123)
    clothesline(70, -122, 9)
    // homes row closing the block, then the school
    for (let k = 0; k < 6; k++) {
      const x = 48 + k * 11 + rnd(), z = -131
      home(x, z, 6.4 + rnd(), 6.2, 3.3 + rnd() * 1.4, k % 2)
    }
    // Saraswati school with a front yard wall + gate
    deco({ kind: 'building', x: 78, z: -150, w: 26, d: 9, h: 6, color: '#c9a86a', variant: 0, sign: 'SARASWATI PUBLIC SCHOOL' })
    box(65, 0, -154.5, 91, 6, -145.5)
    wall(64, -141, 68, -141); wall(88, -141, 92, -141) // yard wall, gate in the middle
    deco({ kind: 'flagpole', x: 78, z: -143.5, variant: 1 })
    // playground
    for (let i = 0; i < 5; i++) deco({ kind: 'crowd', x: 66 + i * 7 + rnd() * 3, z: -158 - rnd() * 10, ry: rnd() * 6.28, variant: i % 6, sign: rnd() < 0.3 ? SIGNS[(i + 7) % SIGNS.length] : undefined })
    deco({ kind: 'bench', x: 62, z: -166, ry: 1.5 }); benchBox(62, -166)
    deco({ kind: 'tree', x: 92, z: -166, s: 1.1, variant: 0 })
    box(91.6, 0, -166.4, 92.4, 3, -165.6)
    // homes rows facing the Market Exit cross road
    for (let k = 0; k < 6; k++) home(50 + k * 11 + rnd(), -178, 6.5 + rnd(), 6.4, 3.4 + rnd() * 1.5, k % 3 === 0 ? 1 : 0)
    for (let k = 0; k < 5; k++) home(55 + k * 12 + rnd(), -187.5, 6.5 + rnd(), 6.2, 3.2 + rnd() * 1.6, (k + 1) % 3)
    clothesline(74, -182.6, 8)
    items.push(
      { id: 'S2_tok', type: 'token', x: 58, y: 1, z: -121 },      // behind the bazaar shops
      { id: 'S2_snack', type: 'snack', x: 84, y: 1, z: -164 },
      { id: 'S2_bot', type: 'bottle', x: 70, y: 1, z: -182.6 },
      { id: 'S2_chai', type: 'chai', x: 76, y: 1, z: -137 },
    )
    npcs.push({ id: 'npcS2', type: 'police', x: 52, z: -100, patrol: [[52, -100], [104, -102], [104, -118], [52, -116]], zone: 1 })
  }

  // ================= ZONE C — SECURITY CHECKPOINT (z -200 .. -280) =================
  // Fence corridors funneling through barricade maze, watchtowers + searchlights.
  // Round 19: every fence line now runs the FULL city width so the outer mohalla
  // blocks can't be used to walk around the checkpoint.
  // Fence walls (with gaps)
  const fence = (x1: number, z1: number, x2: number, z2: number) => {
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2), minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2)
    deco({ kind: 'barrier', x: (x1 + x2) / 2, z: (z1 + z2) / 2, w: Math.max(2, maxX - minX), d: Math.max(2, maxZ - minZ) })
    box(minX, 0, minZ, maxX, 1.15, maxZ)
  }
  fence(-122, -206, -12, -207.6); fence(12, -206, 122, -207.6)
  fence(-122, -222, -26, -223.6); fence(26, -222, 122, -223.6)
  fence(-12, -222, -6, -223.6); fence(6, -222, 12, -223.6)
  fence(-122, -238, -18, -239.6); fence(18, -238, 122, -239.6)
  fence(-6, -238, 18, -239.6)
  fence(-122, -254, -8, -255.6); fence(8, -254, 122, -255.6)
  fence(-122, -270, -20, -271.6); fence(20, -270, 122, -271.6)
  fence(-8, -270, 20, -271.6)
  // Watchtowers with searchlights
  const towers: [number, number][] = [[-20, -214], [20, -214], [-24, -246], [24, -246]]
  towers.forEach(([x, z], i) => {
    deco({ kind: 'tower', x, z, variant: i })
    box(x - 2, 0, z - 2, x + 2, 5.2, z + 2)
    searchlights.push({ id: `sl${i}`, x, z, ry: Math.PI + (i % 2 ? -0.5 : 0.5), speed: (i % 2 ? -1 : 1) * 0.55 })
  })
  landmarks.push({ name: 'Security Checkpoint', x: 0, z: -240 })
  // Guard huts + crates for hiding
  for (let i = 0; i < 5; i++) { deco({ kind: 'crate', x: -30 + i * 13 + rnd() * 4, z: -216 - (i % 3) * 18, ry: rnd() * 1.5, s: 1.2 }); box(-30 + i * 13 - 1, 0, -217 - (i % 3) * 18, -30 + i * 13 + 1, 2.2, -215 - (i % 3) * 18) }
  // Checkpoint road barriers — v47: these concrete blockers LOOKED solid but had
  // no collider (free walk-through at the most guarded spot in the city)
  for (let i = 0; i < 4; i++) { const bx = i % 2 ? -14 : 14, bz = -228 - i * 10; deco({ kind: 'barrier', x: bx, z: bz, ry: 0.2, w: 6, d: 2 }); solidBox(bx, bz, 6.3, 3.2, 1.15) }
  // outer corridor hiding spots (west + east dead-end pockets between fence lines)
  for (let i = 0; i < 3; i++) { const x = -84 - i * 14; const z = -216 + i * 16; deco({ kind: 'crate', x, z, ry: rnd(), s: 1.1 }); box(x - 1, 0, z - 1, x + 1, 2, z + 1) }
  for (let i = 0; i < 3; i++) { const x = 76 + i * 14; const z = -220 + i * 15; deco({ kind: 'crate', x, z, ry: rnd(), s: 1.2 }); box(x - 1.1, 0, z - 1.1, x + 1.1, 2.2, z + 1.1) }
  deco({ kind: 'cart', x: -56, z: -262, ry: 0.7, collider: true }); box(-57.2, 0, -263.2, -54.8, 1.5, -260.8)
  for (let i = 0; i < 3; i++) deco({ kind: 'crowd', x: -90 + i * 70, z: -230 - i * 14, ry: rnd() * 6.28, variant: i % 6 })

  items.push(
    { id: 'C_tok_1', type: 'token', x: -34, y: 1, z: -216 },
    { id: 'C_tok_2', type: 'token', x: 33, y: 1, z: -232 },
    { id: 'C_tok_3', type: 'token', x: -2, y: 1, z: -260 },
    { id: 'C_tok_4', type: 'token', x: 36, y: 1, z: -266 },
    { id: 'C_chai_1', type: 'chai', x: -14, y: 1, z: -224 },
    { id: 'C_chai_2', type: 'chai', x: 16, y: 1, z: -252 },
    { id: 'C_bot_1', type: 'bottle', x: 6, y: 1, z: -212 },
    { id: 'C_bot_2', type: 'bottle', x: -22, y: 1, z: -244 },
    { id: 'C_aid_1', type: 'firstaid', x: -36, y: 1, z: -252 },
    { id: 'C_snack_1', type: 'snack', x: 8, y: 1, z: -240 },
    { id: 'C_aid_2', type: 'firstaid', x: -6, y: 1, z: -212 },
    { id: 'C_snack_2', type: 'snack', x: -6, y: 1, z: -246 },
    { id: 'C_aid_3', type: 'firstaid', x: -20, y: 1, z: -270 },
    { id: 'C_foam_1', type: 'foam', x: -10, y: 1, z: -264 },
    { id: 'S6_foam', type: 'foam', x: -80, y: 1, z: -246 },
    { id: 'S6_bot', type: 'bottle', x: 80, y: 1, z: -256 },
  )

  npcs.push(
    { id: 'npcC1', type: 'police', x: -8, z: -212, patrol: [[-8, -212], [8, -214], [10, -220], [-10, -220]], zone: 2 },
    { id: 'npcC2', type: 'police', x: 14, z: -226, patrol: [[14, -226], [-14, -228], [-16, -236], [16, -234]], zone: 2 },
    { id: 'npcC3', type: 'security', x: 0, z: -232, patrol: [[0, -232], [0, -246]], zone: 2 },
    { id: 'npcC4', type: 'police', x: -18, z: -244, patrol: [[-18, -244], [18, -246], [18, -252], [-18, -250]], zone: 2 },
    { id: 'npcC5', type: 'security', x: -6, z: -258, patrol: [[-6, -258], [-6, -268]], zone: 2 },
    { id: 'npcC6', type: 'police', x: 10, z: -262, patrol: [[10, -262], [-10, -264], [-12, -274], [12, -276]], zone: 2 },
    { id: 'npcC7', type: 'police', x: -30, z: -230, patrol: [[-30, -230], [-34, -268], [-24, -266]], zone: 2 },
    { id: 'npcC8', type: 'police', x: 30, z: -234, patrol: [[30, -234], [34, -270], [24, -268]], zone: 2 },
  )

  // ================= ZONE D — MAJOR AVENUE (z -280 .. -420) =================
  // Wide road, flyover with ramps on the right, roadworks, moving traffic.
  // Rows shifted south (round 19) so the Avenue Cross Road at z -286 stays open.
  for (let i = 0; i < 6; i++) {
    const w = 9 + rnd() * 7, d = 10 + rnd() * 6, h = 12 + rnd() * 10
    const x = -(20 + w / 2), z = -302 - i * 20
    deco({ kind: 'building', x, z, w, d, h, color: BLD[Math.floor(rnd() * BLD.length)], variant: 1, sign: SHOPS[(i * 4) % SHOPS.length] })
    box(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2)
    const x2 = 20 + w / 2, z2 = -308 - i * 20
    deco({ kind: 'building', x: x2, z: z2, w, d, h: 10 + rnd() * 12, color: BLD[Math.floor(rnd() * BLD.length)], variant: 2, sign: SHOPS[(i * 4 + 1) % SHOPS.length] })
    box(x2 - w / 2, 0, z2 - d / 2, x2 + w / 2, 12, z2 + d / 2)
  }
  // Flyover: deck + ramps (walkable)
  const fy = 5.2 // deck height
  box(6, 0, -392, 18, fy, -380) // south ramp base
  box(6, 0, -368, 18, fy, -356) // north ramp base
  // stepped ramps (each step 0.5m tall -> walkable step-up)
  for (let s = 0; s < 10; s++) {
    const z0 = -380 + s * 1.2
    box(6, 0, z0, 18, (fy * (s + 1)) / 10, z0 + 1.2, true)
  }
  for (let s = 0; s < 10; s++) {
    const z0 = -368 - s * 1.2
    box(6, 0, z0 - 1.2, 18, (fy * (s + 1)) / 10, z0, true)
  }
  box(6, fy, -380, 18, fy + 0.6, -368, true) // deck
  // v47 — billboard shifted to x 15.5 so the deck's vote token (12, -374) stays collectable
  deco({ kind: 'billboard', x: 15.5, y: fy + 0.6, z: -374, ry: 0, sign: 'AVENUE FLYOVER — USE AT OWN RISK' })
  solidBox(15.5, -374, 4.6, 1.6, 3.4, fy + 0.6) // the flyover hoarding is solid on the deck
  landmarks.push({ name: 'Flyover', x: 12, z: -374 })
  // Roadworks + barriers
  for (let i = 0; i < 6; i++) {
    const x = -16 + i * 6.4
    deco({ kind: 'barrier', x, z: -302 - (i % 2) * 40, ry: 0.1, w: 4, d: 1.6 })
    box(x - 2, 0, -303 - (i % 2) * 40, x + 2, 1.1, -301 - (i % 2) * 40)
  }
  for (let i = 0; i < 4; i++) { deco({ kind: 'crate', x: -18 + i * 11, z: -344 - (i % 2) * 22, ry: rnd(), s: 1.1 }); box(-19 + i * 11, 0, -345 - (i % 2) * 22, -17 + i * 11, 2, -343 - (i % 2) * 22) }
  for (let i = 0; i < 5; i++) { const x = i % 2 ? 16 : -16, z = -296 - i * 26; deco({ kind: 'lamp', x, z }) }
  const HOARD = mapDef.hoardings ?? HOARDING_TEXTS
  for (let i = 0; i < 4; i++) deco({ kind: 'hoarding', x: i % 2 ? 15 : -15, z: -316 - i * 24, ry: i % 2 ? -0.4 : 0.4, sign: HOARD[i % HOARD.length] })
  for (let i = 0; i < 10; i++) { const x = -18 + rnd() * 36, z = -294 - rnd() * 118; if (Math.abs(x) < 17) continue; if (inCrossRoad(z)) continue; deco({ kind: 'crowd', x, z, ry: rnd() * 6.28, variant: Math.floor(rnd() * 6), sign: rnd() < 0.25 ? SIGNS[Math.floor(rnd() * SIGNS.length)] : undefined }) }

  // Moving vehicles (server + client simulate identically: deterministic polyline
  // ping-pong from shared world time). v37 — routes ROAM: multi-leg paths turn
  // through junctions and loop around blocks instead of straight left-right shuttles.
  // Road-network facts this table must respect (see CROSS_ROADS + world.ts):
  //  - main avenue asphalt x -8.5..8.5 (widening x ±19 in zone D, z -275..-425)
  //  - cross roads A z=-78 (halfW 4.8), B z=-198 (5), C z=-286 (4), D z=-452 (5),
  //    each paved the full map width (x ±114)
  //  - checkpoint gates flank cross roads A and B at x ±8.5 → vehicles on those
  //    cross roads keep |x| >= 14 and never enter the gate span
  //  - zone D clutter: barrier rows z -302/-342 (gaps only 11.6 < |x| < 14),
  //    crates z -344/-366, flyover x 6..18 z -356..-392 → the zone-D loop keeps to
  //    the clear north half (z -308..-347), lanes x ±12.8 through the roadworks gap
  //  - boss gate blocks the avenue at z -478 (x -10..10) → car4's grand-avenue
  //    leg turns around at z -470 on the Parliament Plaza approach
  vehicles.push(
    // zone-D block loop — the auto circles the north half of the widened avenue
    // (east side south of z -356 is blocked by the flyover ramp, x 6..18)
    { id: 'veh_auto1', kind: 'auto', speed: 7.2, path: [[-12.8, -308], [12.8, -308], [12.8, -347], [-12.8, -347]] },
    // Avenue Cross Road (C, no gate) — full-map crossers through the junction:
    // car westbound north lane, auto centre lane, bike eastbound south lane
    { id: 'veh_auto2', kind: 'auto', speed: 6.5, path: [[-100, -286], [100, -286]] },
    { id: 'veh_auto3', kind: 'auto', speed: 6, path: [[-16, -455.2], [-100, -455.2]] },
    { id: 'veh_bus1', kind: 'bus', speed: 6, path: [[0, -300], [0, -415]] },
    { id: 'veh_cow1', kind: 'cow', speed: 1.2, path: [[-10, -330], [10, -395]] },
    // cross streets A + B carry checkpoint gate pillars at x ±8.5 — roamers stay
    // on their own half (|x| >= 14) and never clip the gates
    { id: 'veh_auto4', kind: 'auto', speed: 6, path: [[-96, -198], [-14, -198]] },
    { id: 'veh_auto6', kind: 'auto', speed: 6.4, path: [[14, -198], [96, -198]] },
    { id: 'veh_auto5', kind: 'auto', speed: 6.2, path: [[-100, -78], [-14, -78]] },
    { id: 'veh_auto7', kind: 'auto', speed: 6, path: [[14, -78], [96, -78]] },
    // Colony Cross Road (D, no gate) — the bus crosses the WHOLE map, the car
    // turns off the junction and roams down the grand avenue (U-turn before the
    // boss gate at z -478)
    { id: 'veh_bus2', kind: 'bus', speed: 5.5, path: [[-100, -452], [100, -452]] },
    { id: 'veh_cow2', kind: 'cow', speed: 1.1, path: [[-96, -44], [-52, -58]] },
    { id: 'veh_car1', kind: 'car', speed: 10.5, path: [[-88, -79.0], [-16, -79.0]] },    // Plaza Cross Rd westbound (lane north of the row-A shopfront corner)
    { id: 'veh_car2', kind: 'car', speed: 9.5, path: [[16, -195.5], [94, -195.5]] },     // Market Exit eastbound
    { id: 'veh_car3', kind: 'car', speed: 9, path: [[-100, -283.5], [100, -283.5]] },    // Avenue Cross Rd westbound — full map
    { id: 'veh_car4', kind: 'car', speed: 8.6, path: [[-88, -449.4], [-4, -449.4], [-4, -470]] }, // Colony Rd → grand avenue, 90° turn at the junction
    { id: 'veh_bike1', kind: 'bike', speed: 8.5, path: [[16, -75.5], [92, -75.5]] },     // Plaza Cross Rd eastbound
    { id: 'veh_bike2', kind: 'bike', speed: 9, path: [[-92, -200.5], [-16, -200.5]] },   // Market Exit westbound
    { id: 'veh_bike3', kind: 'bike', speed: 8.2, path: [[-100, -288.5], [100, -288.5]] }, // Avenue Cross Rd eastbound — full map
    { id: 'veh_bike4', kind: 'bike', speed: 7.6, path: [[16, -455.2], [92, -455.2]] },   // Colony Cross Rd eastbound
  )

  // Street trees lining the avenue sidewalks (zones B+C) — every spot verified
  // clear of all decos/colliders/gates via tests/tree-spot-check.ts
  const STREET_TREES: Array<[number, number]> = [
    [11.5, -100], [11.5, -140], [11.5, -164], [11.5, -226], [11.5, -262],
    [-11.5, -132], [-11.5, -158], [-11.5, -178], [-11.5, -210], [-11.5, -240], [-11.5, -268],
  ]
  STREET_TREES.forEach(([x, z], i) => {
    deco({ kind: 'tree', x, z, s: 1 + (i % 3) * 0.15, variant: i % 2 })
    box(x - 0.35, 0, z - 0.35, x + 0.35, 3, z + 0.35)
  })

  items.push(
    { id: 'D_tok_1', type: 'token', x: 12, y: 5.9, z: -374 },   // on flyover deck
    { id: 'D_tok_2', type: 'token', x: -34, y: 1, z: -318 },
    { id: 'D_tok_3', type: 'token', x: -6, y: 1, z: -352 },
    { id: 'D_tok_4', type: 'token', x: 33, y: 1, z: -400 },
    { id: 'D_chai_1', type: 'chai', x: -16, y: 1, z: -304 },
    { id: 'D_chai_2', type: 'chai', x: 12, y: 5.9, z: -376 },
    { id: 'D_bot_1', type: 'bottle', x: 4, y: 1, z: -310 },
    { id: 'D_bot_2', type: 'bottle', x: -4, y: 1, z: -366 },
    { id: 'D_snack_1', type: 'snack', x: 16, y: 5.9, z: -370 },
    { id: 'D_aid_1', type: 'firstaid', x: -33, y: 1, z: -384 },
    { id: 'D_foam_1', type: 'foam', x: 30, y: 1, z: -330 },
    { id: 'D_joke_1', type: 'joke', x: -12, y: 1, z: -404 },
    { id: 'D_aid_2', type: 'firstaid', x: 8, y: 1, z: -312 },
    { id: 'D_snack_2', type: 'snack', x: -10, y: 1, z: -356 },
    { id: 'D_chai_3', type: 'chai', x: 14, y: 1, z: -396 },
  )

  npcs.push(
    { id: 'npcD1', type: 'police', x: -8, z: -298, patrol: [[-8, -298], [8, -300], [8, -312], [-8, -310]], zone: 3 },
    { id: 'npcD2', type: 'police', x: 12, z: -316, patrol: [[12, -316], [-12, -318], [-14, -330], [14, -328]], zone: 3 },
    { id: 'npcD3', type: 'security', x: 0, z: -340, patrol: [[0, -340], [-4, -356]], zone: 3 },
    { id: 'npcD4', type: 'police', x: -14, z: -362, patrol: [[-14, -362], [14, -364], [14, -380], [-14, -378]], zone: 3 },
    { id: 'npcD5', type: 'police', x: 6, z: -392, patrol: [[6, -392], [-6, -394], [-8, -408], [8, -410]], zone: 3 },
  )

  // ================= SIDE CITY — WEST, BAND 3 (z -290 .. -447) — APARTMENTS + NEEM PARK ==
  {
    landmarks.push({ name: 'Neem Park', x: -78, z: -360 })
    // apartment row fronting the avenue margin
    const aptX = [-104, -78, -52]
    aptX.forEach((x, i) => {
      const w = 14 + rnd() * 4, d = 10, h = 11 + i * 2
      deco({ kind: 'building', x, z: -314, w, d, h, color: BLD[(i + 3) % BLD.length], variant: 2, sign: SHOPS[(i + 16) % SHOPS.length] })
      box(x - w / 2, 0, -319, x + w / 2, h, -309)
    })
    for (let i = 0; i < 3; i++) { const sx = -108 + i * 26; deco({ kind: 'scooter', x: sx, z: -304, ry: rnd() * 6.28 }); scooterBox(sx, -304) }
    // Neem Park — the green lung of the west city
    for (let i = 0; i < 10; i++) {
      const x = -110 + (i % 5) * 14 + rnd() * 5, z = -332 - Math.floor(i / 5) * 30 - rnd() * 10
      deco({ kind: 'tree', x, z, s: 1 + rnd() * 0.6, variant: i % 2 })
      box(x - 0.35, 0, z - 0.35, x + 0.35, 3, z + 0.35)
    }
    for (let i = 0; i < 5; i++) { const bx = -100 + i * 13, bz = -348 - (i % 2) * 26; deco({ kind: 'bench', x: bx, z: bz, ry: rnd() * 3 }); benchBox(bx, bz) }
    for (let i = 0; i < 6; i++) { const px = -106 + i * 12, pz = -340 + (i % 2) * 44; deco({ kind: 'planter', x: px, z: pz }); planterBox(px, pz) }
    for (let i = 0; i < 6; i++) deco({ kind: 'crowd', x: -108 + i * 12 + rnd() * 5, z: -330 - rnd() * 70, ry: rnd() * 6.28, variant: (i + 1) % 6, sign: rnd() < 0.45 ? SIGNS[(i * 4 + 2) % SIGNS.length] : undefined })
    deco({ kind: 'teaKettle', x: -58, z: -380, ry: -1 }); kettleBox(-58, -380)
    // homes row closing the block, facing Colony Cross Road
    for (let k = 0; k < 6; k++) home(-108 + k * 11.4 + rnd(), -416, 6.6 + rnd(), 6.4, 3.4 + rnd() * 1.6, k % 2)
    clothesline(-86, -422.6, 8)
    items.push(
      { id: 'S3_tok', type: 'token', x: -84, y: 1, z: -360 },
      { id: 'S3_chai', type: 'chai', x: -100, y: 1, z: -304 },
    )
    npcs.push({ id: 'npcS4', type: 'police', x: -100, z: -344, patrol: [[-100, -344], [-56, -344], [-56, -392], [-100, -390]], zone: 3 })
  }

  // ================= SIDE CITY — EAST, BAND 3 (z -290 .. -447) — CITY DEPOT ===========
  {
    landmarks.push({ name: 'City Depot', x: 80, z: -330 })
    const warehouses: [number, number, number, number][] = [[64, -314, 20, 8], [94, -316, 18, 7.5], [70, -344, 22, 9]]
    warehouses.forEach(([x, z, w, h], i) => {
      deco({ kind: 'building', x, z, w, d: 13, h, color: ['#8d9a8c', '#9a8d7a', '#8c8d9a'][i], variant: 1, sign: ['CITY TRANSPORT DEPOT', 'GODOWN No. 4 — LOADING ONLY', 'ZILLA WORKS & STORAGE'][i] })
      box(x - w / 2, 0, z - 6.5, x + w / 2, h, z + 6.5)
    })
    // shipping-container stacks
    for (let i = 0; i < 8; i++) {
      const x = 48 + (i % 4) * 15 + rnd() * 3, z = -364 - Math.floor(i / 4) * 12
      const s = 1.5 + rnd() * 0.3
      deco({ kind: 'crate', x, z, ry: rnd() * 0.4, s })
      box(x - 1.2 * s, 0, z - 1.2 * s, x + 1.2 * s, 2.6 * s, z + 1.2 * s)
    }
    // auto-stand scooter row + chai point
    for (let i = 0; i < 5; i++) { deco({ kind: 'scooter', x: 100, z: -306 - i * 4.4, ry: Math.PI / 2 + rnd() * 0.3 }); scooterBox(100, -306 - i * 4.4) }
    deco({ kind: 'teaKettle', x: 58, z: -306, ry: Math.PI }); kettleBox(58, -306)
    deco({ kind: 'stall', x: 92, z: -330, ry: -Math.PI / 2, variant: 2, sign: 'Depot Chai Point' })
    box(90.3, 0, -331.7, 93.7, 2.4, -328.3)
    for (let i = 0; i < 5; i++) deco({ kind: 'crowd', x: 50 + i * 14 + rnd() * 4, z: -312 - rnd() * 60, ry: rnd() * 6.28, variant: (i + 3) % 6 })
    // homes row facing the Colony Cross Road
    for (let k = 0; k < 5; k++) home(52 + k * 12.2 + rnd(), -416, 6.5 + rnd(), 6.3, 3.3 + rnd() * 1.5, (k + 1) % 2)
    items.push(
      { id: 'S4_chai', type: 'chai', x: 60, y: 1, z: -310 },
      { id: 'S4_snack', type: 'snack', x: 94, y: 1, z: -344 },
      { id: 'S4_bot', type: 'bottle', x: 76, y: 1, z: -332 },
      { id: 'S4_aid', type: 'firstaid', x: 66, y: 1, z: -330 },
    )
    npcs.push({ id: 'npcS5', type: 'police', x: 60, z: -312, patrol: [[60, -312], [104, -312], [104, -356], [60, -356]], zone: 3 })
  }

  // ================= ZONE E — GOVERNMENT DISTRICT (z -420 .. -572) =================
  // Monumental buildings + grand avenue to boss arena
  const monuments: [number, number, number][] = [[-30, -436, 14], [30, -436, 14], [-32, -466, 18], [32, -466, 18]]
  monuments.forEach(([x, z, h]) => {
    deco({ kind: 'monument', x, z, h, color: '#d8cfc0' })
    box(x - 8, 0, z - 8, x + 8, h, z + 8)
  })
  // Flag poles + gardens (shifted clear of the Colony Cross Road at z -452)
  for (let i = 0; i < 6; i++) { deco({ kind: 'flagpole', x: i % 2 ? -12 : 12, z: -424 - Math.floor(i / 2) * 10, variant: i % 3 }) }
  // v47 — planter ladder starts at -426 (was -428) so the deepest row (-461) stays
  // ≥0.3 m clear of the azad celebration-stall extras at z -465
  for (let i = 0; i < 8; i++) { const x = i % 2 ? -20 - rnd() * 8 : 20 + rnd() * 8, z = -426 - i * 5; if (inCrossRoad(z)) continue; deco({ kind: 'planter', x, z }); planterBox(x, z) }
  for (let i = 0; i < 12; i++) { const x = -26 + rnd() * 52, z = -424 - rnd() * 46; if (Math.abs(x) < 10) continue; if (inCrossRoad(z)) continue; deco({ kind: 'crowd', x, z, ry: rnd() * 6.28, variant: Math.floor(rnd() * 6), sign: rnd() < 0.5 ? SIGNS[Math.floor(rnd() * SIGNS.length)] : undefined }) }
  for (let i = 0; i < 4; i++) { const x = i % 2 ? -14 : 14, z = -430 - i * 8; if (inCrossRoad(z)) continue; deco({ kind: 'lamp', x, z }) }
  // Grand Parliament building backdrop
  deco({ kind: 'monument', x: 0, z: -566, h: 26, w: 70, d: 26, color: '#e2d8c3', sign: 'SANSAD SABHA (FICTIONAL)' })
  box(-35, 0, -580, 35, 26, -552)
  landmarks.push({ name: 'Parliament Plaza', x: 0, z: -520 })

  // Boss gate (removed when tokens >= TOKENS_NEEDED) — renderer draws energy barrier
  box(-10, 0, -479.2, 10, 7, -477.2)
  deco({ kind: 'barrier', x: 0, z: -478.2, w: 20, d: 2 })

  items.push(
    { id: 'E_tok_1', type: 'token', x: -20, y: 1, z: -430 },
    { id: 'E_tok_2', type: 'token', x: 21, y: 1, z: -448 },
    { id: 'E_chai_1', type: 'chai', x: -14, y: 1, z: -440 },
    { id: 'E_chai_2', type: 'chai', x: 14, y: 1, z: -462 },
    { id: 'E_bot_1', type: 'bottle', x: 8, y: 1, z: -430 },
    { id: 'E_bot_2', type: 'bottle', x: -8, y: 1, z: -468 },
    { id: 'E_aid_1', type: 'firstaid', x: -24, y: 1, z: -470 },
    { id: 'E_snack_1', type: 'snack', x: 24, y: 1, z: -426 },
    { id: 'E_foam_1', type: 'foam', x: 18, y: 1, z: -470 },
    { id: 'E_aid_2', type: 'firstaid', x: 12, y: 1, z: -446 },
    { id: 'E_snack_2', type: 'snack', x: -8, y: 1, z: -420 },
    { id: 'E_joke_2', type: 'joke', x: 18, y: 1, z: -440 },
  )

  npcs.push(
    { id: 'npcE1', type: 'police', x: -8, z: -428, patrol: [[-8, -428], [8, -430], [8, -442], [-8, -440]], zone: 4 },
    { id: 'npcE2', type: 'police', x: 10, z: -452, patrol: [[10, -452], [-10, -454], [-12, -466], [12, -468]], zone: 4 },
    { id: 'npcE3', type: 'guard', x: -14, z: -486, patrol: [[-14, -486], [-14, -496]], zone: 4 },
    { id: 'npcE4', type: 'guard', x: 14, z: -486, patrol: [[14, -486], [14, -496]], zone: 4 },
    { id: 'npcE5', type: 'police', x: -20, z: -500, patrol: [[-20, -500], [-20, -520], [-8, -522]], zone: 4 },
    { id: 'npcE6', type: 'police', x: 20, z: -500, patrol: [[20, -500], [20, -520], [8, -522]], zone: 4 },
  )
  searchlights.push({ id: 'slE1', x: -18, z: -482, ry: 0.9, speed: 0.5 }, { id: 'slE2', x: 18, z: -482, ry: Math.PI - 0.9, speed: -0.5 })

  // ================= SIDE CITY — WEST, BAND 4 (z -457 .. -568) — GOVT QUARTERS ========
  {
    // bungalow rows on tree-lined plots
    for (let k = 0; k < 5; k++) home(-108 + k * 15 + rnd(), -470, 9, 8, 3.8, 1)
    for (let k = 0; k < 4; k++) home(-104 + k * 16 + rnd(), -488, 9, 8, 3.6, 1)
    // plot walls with street gaps
    wall(-114, -462, -114, -500, 1.2)
    wall(-42, -462, -42, -478, 1.2); wall(-42, -484, -42, -500, 1.2)
    for (let i = 0; i < 6; i++) {
      const x = -110 + i * 14 + rnd() * 4, z = -508 - rnd() * 40
      deco({ kind: 'tree', x, z, s: 1 + rnd() * 0.5, variant: i % 2 })
      box(x - 0.35, 0, z - 0.35, x + 0.35, 3, z + 0.35)
    }
    for (let i = 0; i < 3; i++) deco({ kind: 'crowd', x: -100 + i * 26 + rnd() * 6, z: -510 - rnd() * 30, ry: rnd() * 6.28, variant: i % 6 })
    items.push({ id: 'S5_joke', type: 'joke', x: -64, y: 1, z: -500 })
  }

  // ================= SIDE CITY — EAST, BAND 4 (z -457 .. -568) — AZAD COLONY ==========
  {
    landmarks.push({ name: 'Azad Colony Park', x: 78, z: -486 })
    // colony park with a small samarak (memorial)
    deco({ kind: 'monument', x: 78, z: -486, h: 7, w: 5, d: 5, color: '#d8cfc0' })
    box(75.5, 0, -488.5, 80.5, 7, -483.5)
    for (let i = 0; i < 8; i++) {
      const x = 48 + (i % 4) * 18 + rnd() * 5, z = -464 - Math.floor(i / 4) * 26 - rnd() * 8
      deco({ kind: 'tree', x, z, s: 1 + rnd() * 0.5, variant: i % 2 })
      box(x - 0.35, 0, z - 0.35, x + 0.35, 3, z + 0.35)
    }
    for (let i = 0; i < 4; i++) { const bx = 56 + i * 14, bz = -476 - (i % 2) * 18; deco({ kind: 'bench', x: bx, z: bz, ry: rnd() * 3 }); benchBox(bx, bz) }
    for (let i = 0; i < 5; i++) deco({ kind: 'crowd', x: 50 + i * 14 + rnd() * 5, z: -464 - rnd() * 40, ry: rnd() * 6.28, variant: (i + 4) % 6, sign: rnd() < 0.4 ? SIGNS[(i * 5 + 3) % SIGNS.length] : undefined })
    // colony homes rows facing the park
    for (let k = 0; k < 6; k++) home(50 + k * 11 + rnd(), -518, 6.5 + rnd(), 6.4, 3.3 + rnd() * 1.5, k % 2)
    for (let k = 0; k < 6; k++) home(50 + k * 11 + rnd(), -532, 6.5 + rnd(), 6.2, 3.2 + rnd() * 1.6, (k + 2) % 3)
    clothesline(72, -525.4, 8)
    deco({ kind: 'lamp', x: 72, z: -510, ry: Math.PI / 2 })
    items.push(
      { id: 'S5_tok', type: 'token', x: 54, y: 1, z: -539 },     // behind the colony homes
      { id: 'S5_aid', type: 'firstaid', x: 90, y: 1, z: -474 },
      { id: 'S5_chai', type: 'chai', x: 86, y: 1, z: -480 },
    )
    npcs.push({ id: 'npcS6', type: 'police', x: 56, z: -464, patrol: [[56, -464], [104, -464], [104, -506], [56, -506]], zone: 4 })
  }

  // Boss arena (center z=-520)
  landmarks.push({ name: 'BOSS: Vote Collector', x: 0, z: -520 })

  // ================= v43 LEVEL-MAP EXTRAS — appended strictly AFTER the skeleton =====
  // Variant-only props: palettes/signage above already differ; these add the
  // district's landmarks + navigation hazards. Ground colliders here are CLIENT
  // physics only (the server never validates static collisions), but placements
  // are still kept clear of the synced skeleton (vehicle lanes, items,
  // checkpoints) — asserted by tests/maps-test.ts.
  for (const ex of mapDef.extras) {
    decorations.push(ex.deco)
    if (ex.box) {
      const [minX, minY, minZ, maxX, maxY, maxZ] = ex.box
      colliders.push({ minX, minY, minZ, maxX, maxY, maxZ })
    }
  }

  return {
    bounds: { minX: -120, maxX: 120, minZ: -572, maxZ: 10 },
    spawn: { x: 0, z: -8 },
    zones: [
      { name: 'Protest Plaza', hint: 'Practice here. The cross road south leads to the old galis.', zStart: 4, zEnd: -80 },
      { name: 'Chowk Market', hint: 'Dense stalls. Purani Gali west + Naya Bazaar east hide loot.', zStart: -80, zEnd: -200 },
      { name: 'Security Checkpoint', hint: 'Fences span the whole city now. No walking around.', zStart: -200, zEnd: -280 },
      { name: 'Grand Avenue', hint: 'Mind the traffic! Neem Park west, City Depot east.', zStart: -280, zEnd: -420 },
      { name: 'Government District', hint: 'The Vote Collector awaits beyond the gate.', zStart: -420, zEnd: -572 },
    ],
    crossRoads: CROSS_ROADS,
    colliders, decorations, items, npcs, checkpoints: [
      { id: 1, name: 'Plaza Gate', x: 0, z: -78, radius: 6, detention: { x: 10, z: -70 } },
      { id: 2, name: 'Market Exit', x: 0, z: -198, radius: 6, detention: { x: 12, z: -190 } },
      { id: 3, name: 'Security Gate', x: 0, z: -278, radius: 6, detention: { x: 10, z: -268 } },
      { id: 4, name: 'Avenue Junction', x: 0, z: -418, radius: 6, detention: { x: 14, z: -408 } },
    ],
    searchlights, vehicles,
    bossArena: { x: 0, z: -520, radius: 26, gateZ: -478 },
    landmarks,
    mapId: mapDef.id,
    mapName: mapDef.name,
    mapTagline: mapDef.tagline,
    xpMul: mapDef.xpMul,
    difficulty: mapDef.difficulty,
    groundTint: mapDef.ground,
    roadTint: mapDef.road,
  }
}
