// VoteChor world definition — deterministic procedural city data.
// PURE data generation (seeded RNG) so browser client and game server build identical worlds.
import type { AABB, Deco, DecoKind, ItemSpawn, NpcSpawn, VehicleDef, WorldDef, SearchlightDef } from './types'

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

let idc = 0
const nid = (p: string) => `${p}_${(idc++).toString(36)}`

export function buildWorldDef(): WorldDef {
  idc = 0
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

  // Invisible world walls
  box(-50, 0, 10, 50, 14, 12)          // back wall
  box(-50, 0, -576, 50, 14, -572)      // far wall
  box(-52, 0, -576, -48, 14, 12)       // left wall
  box(48, 0, -576, 52, 14, 12)         // right wall

  // ================= ZONE A — PROTEST GATHERING PLAZA (z 0 .. -80) =================
  const plazaBuilding = (x: number, z: number, i: number) => {
    const w = 10 + rnd() * 8
    const d = 8 + rnd() * 6
    const h = 8 + rnd() * 8
    const color = BUILDING_COLORS[Math.floor(rnd() * BUILDING_COLORS.length)]
    deco({ kind: 'building', x, z, w, d, h, color, variant: Math.floor(rnd() * 3), sign: SHOP_NAMES[i % SHOP_NAMES.length] })
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
  // Food stalls row
  const stallKinds: DecoKind[] = ['stall', 'cart', 'teaKettle']
  for (let i = 0; i < 6; i++) {
    const x = -10 + i * 4.2, z = -52
    deco({ kind: stallKinds[i % 3], x, z, ry: Math.PI, variant: i, sign: SHOP_NAMES[(i + 8) % SHOP_NAMES.length], collider: i % 2 === 0 })
    if (i % 2 === 0) box(x - 1.6, 0, z - 1.6, x + 1.6, 2.4, z + 1.6)
  }
  // Street props
  for (let i = 0; i < 8; i++) {
    const x = -26 + rnd() * 52, z = -4 - rnd() * 72
    if (Math.abs(x) < 9) continue
    deco({ kind: 'tree', x, z, s: 0.8 + rnd() * 0.6, variant: Math.floor(rnd() * 2) })
    box(x - 0.35, 0, z - 0.35, x + 0.35, 3, z + 0.35)
  }
  for (let i = 0; i < 6; i++) deco({ kind: 'bench', x: -14 + i * 5.6, z: -12, ry: Math.PI })
  for (let i = 0; i < 5; i++) deco({ kind: 'scooter', x: -30 + rnd() * 8, z: -30 - i * 9, ry: 0.3 + rnd() * 0.4 })
  for (let i = 0; i < 4; i++) deco({ kind: 'lamp', x: i % 2 ? 9 : -9, z: -10 - i * 20 })
  // Tutorial ring (train area)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    deco({ kind: 'crate', x: 16 + Math.cos(a) * 6, z: -64 + Math.sin(a) * 6, ry: a, s: 0.9 })
  }
  box(10, 0, -70, 22, 1.1, -58) // tutorial platform to jump on
  landmarks.push({ name: 'Training Ring', x: 16, z: -64 })
  // Crowd of ambient protesters in plaza
  for (let i = 0; i < 24; i++) {
    const x = -20 + rnd() * 40, z = -6 - rnd() * 60
    if (Math.abs(x) < 5 && z > -20) continue
    deco({ kind: 'crowd', x, z, ry: rnd() * Math.PI * 2, variant: Math.floor(rnd() * 6), sign: rnd() < 0.55 ? SIGN_TEXTS[Math.floor(rnd() * SIGN_TEXTS.length)] : undefined })
  }
  for (let i = 0; i < 3; i++) deco({ kind: 'billboard', x: i % 2 ? 14 : -14, z: -20 - i * 18, ry: i % 2 ? -0.6 : 0.6, sign: SIGN_TEXTS[(i * 5) % SIGN_TEXTS.length] })
  deco({ kind: 'toilet', x: 30, z: -70 })

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
  )

  // Plaza NPCs (light) — patrol the SIDES of the plaza; the center road stays a fair tutorial run
  npcs.push(
    { id: 'npcA1', type: 'police', x: -20, z: -40, patrol: [[-20, -38], [-28, -42], [-28, -58], [-18, -56]], zone: 0 },
    { id: 'npcA2', type: 'police', x: 20, z: -30, patrol: [[20, -28], [26, -34], [26, -50], [16, -48]], zone: 0 },
  )

  // ================= ZONE B — BUSY MARKET STREETS (z -80 .. -200) =================
  // Narrow road: buildings closer, dense stalls
  for (let i = 0; i < 9; i++) {
    const w = 8 + rnd() * 6, d = 7 + rnd() * 5, h = 7 + rnd() * 9
    const x = -(11 + w / 2 + rnd() * 4), z = -86 - i * 13
    deco({ kind: 'building', x, z, w, d, h, color: BUILDING_COLORS[Math.floor(rnd() * BUILDING_COLORS.length)], variant: 1, sign: SHOP_NAMES[(i + 3) % SHOP_NAMES.length] })
    box(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2)
  }
  for (let i = 0; i < 9; i++) {
    const w = 8 + rnd() * 6, d = 7 + rnd() * 5, h = 7 + rnd() * 9
    const x = 11 + w / 2 + rnd() * 4, z = -88 - i * 13
    deco({ kind: 'building', x, z, w, d, h, color: BUILDING_COLORS[Math.floor(rnd() * BUILDING_COLORS.length)], variant: 2, sign: SHOP_NAMES[(i + 11) % SHOP_NAMES.length] })
    box(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2)
  }
  // Dense market stalls along road edges
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1
    const x = side * (7.5 + (i % 3) * 1.6), z = -86 - i * 8.4
    deco({ kind: 'stall', x, z, ry: side > 0 ? Math.PI / 2 : -Math.PI / 2, variant: i % 4, sign: SHOP_NAMES[(i * 3 + 2) % SHOP_NAMES.length] })
    box(x - 1.7, 0, z - 1.7, x + 1.7, 2.4, z + 1.7)
  }
  // Overhead banners across the market street
  for (let i = 0; i < 5; i++) deco({ kind: 'banner', x: 0, z: -96 - i * 24, ry: 0, sign: SIGN_TEXTS[(i * 3 + 1) % SIGN_TEXTS.length] })
  // Carts and scooters blocking lanes
  for (let i = 0; i < 8; i++) {
    const x = -4 + rnd() * 8, z = -92 - i * 13 - rnd() * 4
    if (i % 3 === 0) { deco({ kind: 'cart', x, z, ry: rnd() * 3, collider: true }); box(x - 1.2, 0, z - 1.2, x + 1.2, 1.5, z + 1.2) }
    else deco({ kind: 'scooter', x: x > 0 ? x + 3 : x - 3, z, ry: rnd() * 6.28 })
  }
  for (let i = 0; i < 10; i++) {
    const x = -20 + rnd() * 40, z = -84 - rnd() * 112
    if (Math.abs(x) < 9.5) continue
    deco({ kind: 'crowd', x, z, ry: rnd() * 6.28, variant: Math.floor(rnd() * 6), sign: rnd() < 0.3 ? SIGN_TEXTS[Math.floor(rnd() * SIGN_TEXTS.length)] : undefined })
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
  )

  npcs.push(
    { id: 'npcB1', type: 'police', x: -4, z: -100, patrol: [[-4, -100], [4, -112], [-4, -124], [4, -136]], zone: 1 },
    { id: 'npcB2', type: 'police', x: 5, z: -130, patrol: [[5, -130], [-5, -142], [5, -154], [-5, -166]], zone: 1 },
    { id: 'npcB3', type: 'police', x: -12, z: -150, patrol: [[-12, -150], [-12, -176], [12, -180], [12, -152]], zone: 1 },
    { id: 'npcB4', type: 'police', x: 0, z: -176, patrol: [[0, -176], [8, -186], [-8, -194], [0, -166]], zone: 1 },
  )

  // ================= ZONE C — SECURITY CHECKPOINT (z -200 .. -280) =================
  // Fence corridors funneling through barricade maze, watchtowers + searchlights
  // Fence walls (with gaps)
  const fence = (x1: number, z1: number, x2: number, z2: number) => {
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2), minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2)
    deco({ kind: 'barrier', x: (x1 + x2) / 2, z: (z1 + z2) / 2, w: Math.max(2, maxX - minX), d: Math.max(2, maxZ - minZ) })
    box(minX, 0, minZ, maxX, 1.15, maxZ)
  }
  fence(-46, -206, -12, -207.6); fence(12, -206, 46, -207.6)
  fence(-46, -222, -26, -223.6); fence(26, -222, 46, -223.6)
  fence(-12, -222, -6, -223.6); fence(6, -222, 12, -223.6)
  fence(-46, -238, -18, -239.6); fence(18, -238, 46, -239.6)
  fence(-6, -238, 18, -239.6)
  fence(-46, -254, -8, -255.6); fence(8, -254, 46, -255.6)
  fence(-46, -270, -20, -271.6); fence(20, -270, 46, -271.6)
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
  for (let i = 0; i < 4; i++) deco({ kind: 'barrier', x: i % 2 ? -14 : 14, z: -228 - i * 10, ry: 0.2, w: 6, d: 2 })

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
    { id: 'C_foam_1', type: 'foam', x: -10, y: 1, z: -264 },
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
  // Wide road, flyover with ramps on the right, roadworks, moving traffic
  for (let i = 0; i < 6; i++) {
    const w = 9 + rnd() * 7, d = 10 + rnd() * 6, h = 12 + rnd() * 10
    const x = -(20 + w / 2), z = -290 - i * 22
    deco({ kind: 'building', x, z, w, d, h, color: BUILDING_COLORS[Math.floor(rnd() * BUILDING_COLORS.length)], variant: 1, sign: SHOP_NAMES[(i * 4) % SHOP_NAMES.length] })
    box(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2)
    const x2 = 20 + w / 2, z2 = -296 - i * 22
    deco({ kind: 'building', x: x2, z: z2, w, d, h: 10 + rnd() * 12, color: BUILDING_COLORS[Math.floor(rnd() * BUILDING_COLORS.length)], variant: 2, sign: SHOP_NAMES[(i * 4 + 1) % SHOP_NAMES.length] })
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
  deco({ kind: 'billboard', x: 12, y: fy + 0.6, z: -374, ry: 0, sign: 'AVENUE FLYOVER — USE AT OWN RISK' })
  landmarks.push({ name: 'Flyover', x: 12, z: -374 })
  // Roadworks + barriers
  for (let i = 0; i < 6; i++) {
    const x = -16 + i * 6.4
    deco({ kind: 'barrier', x, z: -300 - (i % 2) * 40, ry: 0.1, w: 4, d: 1.6 })
    box(x - 2, 0, -301 - (i % 2) * 40, x + 2, 1.1, -299 - (i % 2) * 40)
  }
  for (let i = 0; i < 4; i++) { deco({ kind: 'crate', x: -18 + i * 11, z: -344 - (i % 2) * 22, ry: rnd(), s: 1.1 }); box(-19 + i * 11, 0, -345 - (i % 2) * 22, -17 + i * 11, 2, -343 - (i % 2) * 22) }
  for (let i = 0; i < 5; i++) { const x = i % 2 ? 16 : -16, z = -290 - i * 28; deco({ kind: 'lamp', x, z }) }
  for (let i = 0; i < 4; i++) deco({ kind: 'hoarding', x: i % 2 ? 15 : -15, z: -310 - i * 26, ry: i % 2 ? -0.4 : 0.4, sign: ['VOTE RESPONSIBLY', 'HONK IF YOU LOVE FORMS', 'SPEED THRILLS BUT PAPERWORK KILLS', 'DEMOTE DAMAD, PROMOTE DEMOCRACY'][i] })
  for (let i = 0; i < 10; i++) { const x = -18 + rnd() * 36, z = -288 - rnd() * 128; if (Math.abs(x) < 17) continue; deco({ kind: 'crowd', x, z, ry: rnd() * 6.28, variant: Math.floor(rnd() * 6), sign: rnd() < 0.25 ? SIGN_TEXTS[Math.floor(rnd() * SIGN_TEXTS.length)] : undefined }) }

  // Moving vehicles (server + client simulate identically: ping-pong along path)
  vehicles.push(
    { id: 'veh_auto1', kind: 'auto', speed: 7, path: [[-12, -292], [-12, -352]] },
    { id: 'veh_auto2', kind: 'auto', speed: 7.5, path: [[12, -312], [12, -372]] },
    { id: 'veh_auto3', kind: 'auto', speed: 8, path: [[-12, -340], [-12, -410]] },
    { id: 'veh_bus1', kind: 'bus', speed: 6, path: [[0, -290], [0, -415]] },
    { id: 'veh_cow1', kind: 'cow', speed: 1.2, path: [[-10, -330], [10, -395]] },
  )

  items.push(
    { id: 'D_tok_1', type: 'token', x: 12, y: 5.9, z: -374 },   // on flyover deck
    { id: 'D_tok_2', type: 'token', x: -34, y: 1, z: -312 },
    { id: 'D_tok_3', type: 'token', x: -6, y: 1, z: -352 },
    { id: 'D_tok_4', type: 'token', x: 33, y: 1, z: -400 },
    { id: 'D_chai_1', type: 'chai', x: -16, y: 1, z: -296 },
    { id: 'D_chai_2', type: 'chai', x: 12, y: 5.9, z: -376 },
    { id: 'D_bot_1', type: 'bottle', x: 4, y: 1, z: -306 },
    { id: 'D_bot_2', type: 'bottle', x: -4, y: 1, z: -366 },
    { id: 'D_snack_1', type: 'snack', x: 16, y: 5.9, z: -370 },
    { id: 'D_aid_1', type: 'firstaid', x: -33, y: 1, z: -384 },
    { id: 'D_foam_1', type: 'foam', x: 30, y: 1, z: -330 },
    { id: 'D_joke_1', type: 'joke', x: -12, y: 1, z: -404 },
  )

  npcs.push(
    { id: 'npcD1', type: 'police', x: -8, z: -290, patrol: [[-8, -290], [8, -292], [8, -306], [-8, -304]], zone: 3 },
    { id: 'npcD2', type: 'police', x: 12, z: -316, patrol: [[12, -316], [-12, -318], [-14, -330], [14, -328]], zone: 3 },
    { id: 'npcD3', type: 'security', x: 0, z: -340, patrol: [[0, -340], [-4, -356]], zone: 3 },
    { id: 'npcD4', type: 'police', x: -14, z: -362, patrol: [[-14, -362], [14, -364], [14, -380], [-14, -378]], zone: 3 },
    { id: 'npcD5', type: 'police', x: 6, z: -392, patrol: [[6, -392], [-6, -394], [-8, -408], [8, -410]], zone: 3 },
  )

  // ================= ZONE E — GOVERNMENT DISTRICT (z -420 .. -572) =================
  // Monumental buildings + grand avenue to boss arena
  const monuments: [number, number, number][] = [[-30, -436, 14], [30, -436, 14], [-32, -466, 18], [32, -466, 18]]
  monuments.forEach(([x, z, h]) => {
    deco({ kind: 'monument', x, z, h, color: '#d8cfc0' })
    box(x - 8, 0, z - 8, x + 8, h, z + 8)
  })
  // Flag poles + gardens
  for (let i = 0; i < 6; i++) { deco({ kind: 'flagpole', x: i % 2 ? -12 : 12, z: -426 - Math.floor(i / 2) * 12, variant: i % 3 }) }
  for (let i = 0; i < 8; i++) { const x = i % 2 ? -20 - rnd() * 8 : 20 + rnd() * 8, z = -430 - i * 6; deco({ kind: 'planter', x, z }) }
  for (let i = 0; i < 12; i++) { const x = -26 + rnd() * 52, z = -424 - rnd() * 46; if (Math.abs(x) < 10) continue; deco({ kind: 'crowd', x, z, ry: rnd() * 6.28, variant: Math.floor(rnd() * 6), sign: rnd() < 0.5 ? SIGN_TEXTS[Math.floor(rnd() * SIGN_TEXTS.length)] : undefined }) }
  for (let i = 0; i < 4; i++) { const x = i % 2 ? -14 : 14, z = -432 - i * 10; deco({ kind: 'lamp', x, z }) }
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

  // Boss arena (center z=-520)
  landmarks.push({ name: 'BOSS: Vote Collector', x: 0, z: -520 })

  return {
    bounds: { minX: -48, maxX: 48, minZ: -572, maxZ: 10 },
    spawn: { x: 0, z: -8 },
    zones: [
      { name: 'Protest Plaza', hint: 'Practice here. Grab chai. Join the crowd.', zStart: 4, zEnd: -80 },
      { name: 'Chowk Market', hint: 'Dense stalls. Use bottles to distract patrols.', zStart: -80, zEnd: -200 },
      { name: 'Security Checkpoint', hint: 'Avoid searchlights and patrols. Hide behind crates.', zStart: -200, zEnd: -280 },
      { name: 'Grand Avenue', hint: 'Mind the traffic! Flyover route has loot.', zStart: -280, zEnd: -420 },
      { name: 'Government District', hint: 'The Vote Collector awaits beyond the gate.', zStart: -420, zEnd: -572 },
    ],
    colliders, decorations, items, npcs, checkpoints: [
      { id: 1, name: 'Plaza Gate', x: 0, z: -78, radius: 6, detention: { x: 10, z: -70 } },
      { id: 2, name: 'Market Exit', x: 0, z: -198, radius: 6, detention: { x: 12, z: -190 } },
      { id: 3, name: 'Security Gate', x: 0, z: -278, radius: 6, detention: { x: 10, z: -268 } },
      { id: 4, name: 'Avenue Junction', x: 0, z: -418, radius: 6, detention: { x: 14, z: -408 } },
    ],
    searchlights, vehicles,
    bossArena: { x: 0, z: -520, radius: 26, gateZ: -478 },
    landmarks,
  }
}
