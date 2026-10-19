// VoteChor LEVEL MAPS (Task 43) — the campaign districts.
//
// Every profile level tier plays a DIFFERENT district of Greater VoteChor City:
// finish a level and the next solo match drops you into a new map with its own
// palette, signage, weather, time-of-day, landmarks and difficulty.
//
// ARCHITECTURE CONTRACT (do not break):
//  - The world SKELETON (spawn, zones, checkpoints, cross roads, boss arena,
//    item/npc/vehicle/searchlight ids + positions) is IDENTICAL in every
//    variant. Solo runs on a shared persistent Season room, so every
//    server-authoritative system sees the same classic skeleton.
//  - A variant may only change CLIENT-SIDE experience: palettes, signage,
//    extra decor (client colliders are local physics, always safe), ground/road
//    tint, and the sky bias (applied only while the user's settings are on the
//    'cycle'/'auto' defaults — a pinned user choice always wins).
//  - Difficulty is honest: visibility (night / monsoon rain / depot fog),
//    navigation (extra barricades narrowing lanes) and stakes (district XP
//    multiplier, applied client-side at match end — the server trusts xpEarned).
import type { Deco } from './types'

/** Sky weather modes accepted by SkySystem.setWeatherMode (mirrors settings union). */
export type MapWeather = 'clear' | 'cloudy' | 'overcast' | 'rain' | 'storm' | 'fog'

/** A variant-only prop: deco + optional local physics box (ground props only). */
export interface ExtraProp {
  deco: Deco
  /** local collider [minX, minY, minZ, maxX, maxY, maxZ] — client physics only */
  box?: [number, number, number, number, number, number]
}

export interface MapVariant {
  id: string
  name: string
  tagline: string
  /** first profile level that plays this district */
  minLevel: number
  /** 1..5 difficulty pips shown in the UI */
  difficulty: number
  /** XP multiplier applied at match end (higher risk districts pay better) */
  xpMul: number
  /** pinned time window [min, max] hours — applied only when settings.timeMode is 'cycle' */
  timeOfDay: [number, number] | null
  /** pinned weather — applied only when settings.weatherMode is 'auto' */
  weather: MapWeather | null
  /** building + mohalla home palettes */
  building: string[]
  homes: string[]
  /** ground base tint + asphalt tint (renderer derives shading) */
  ground: string
  road: string
  /** signage pools (fall back to the classic pools when omitted) */
  shops?: string[]
  signs?: string[]
  hoardings?: string[]
  /** variant-only props appended AFTER the skeleton (ids/colliders of the skeleton untouched) */
  extras: ExtraProp[]
}

// ---------- shared sign pools for the themed districts ----------
const BAZAAR_SHOPS = [
  'Utsav Sweets & Mithai', 'Bandarwala Fireworks', 'Chappal Bazaar Emporium', 'Rangoli Saree Palace',
  'Jalebi Junction', 'Dhol House Sound System', 'Marigold Flower Mart', 'Chaat Chowk',
  'Bangles & Bangara', 'Puppetwala Bhandar', 'Festival Lighting Co.', 'Halwai No. 1',
]
const MONSOON_SHOPS = [
  'Chhata Umbrella Works', 'Adrak Chai Point', 'Raincoat Rental', 'Pakoda Platform',
  'Bundi Purwala', 'Kagaz Boat Works', 'Mosquito Coil Co.', 'Neem & Neem Ayurveda',
  'Flood-Proof Electronics', 'Bheegi Saree Dry Cleaners',
]
const DEPOT_SHOPS = [
  'Zilla Transport Godown', 'Cast-Iorn & Sons', 'Welding Works No. 7', 'Scrap Kings',
  'Iron Ladder Depot', 'Chain & Pulley Co.', 'Diesel Pump Repair', 'Rust-Proof Paint Mart',
  'Night-Shift Tiffin', 'Foreman Chai Stall', 'Bolt & Nut House', 'Crane Rentals (Ask for Bhai)',
]
const RAAT_SHOPS = [
  'Raat Rani Hotel', 'Owl News Agency', 'Midnight Chai Stall', 'Chandni Cycle Works',
  'Nightwatch Security', 'Twenty-Four Hour Bakery', 'Moth & Lamp Books', 'Hooter_parts & Sons',
  'Curfew Curries', 'Starlight Sarees', 'Shift-Change Tailors', 'Insomnia Internet Café',
]
const AZAD_SHOPS = [
  'Azad Mithai Mandir', 'Jhanda Bhandar Flags', 'Freedom Fountain Drinks', 'Nagada Drum Works',
  'Kite Fighter Supplies', 'Ferris Snack Wheel', 'Maidan Merchandise', 'Victory Sweets',
  'Tricolor Tailors', 'Parade Practice Academy', 'Balloons & Bannerwala', 'Phoolwala Farms',
]

const BAZAAR_SIGNS = [
  'UTSAV MUBARAK!', 'THE COMMITTEE FEARS OUR FESTIVAL', 'DANCE > PAPERWORK',
  'MARIGOLDS FOR EVERYONE', 'VOTE, THEN EAT JALEBI', 'OUR STREETS OUR LIGHTS',
  'DHOL LOUDER THAN BUREAUCRACY', 'CHAI FOR ALL VOTERS',
]
const MONSOON_SIGNS = [
  'RAIN CANNOT CANCEL US', 'OUR VOTES ARE WATERPROOF', 'PAPER BALLOTS DISSOLVE — FIGURES',
  'MUD TODAY, MANDATE TOMORROW', 'THE MONSOON IS ON OUR SIDE', 'SINGING IN THE DETENTION',
  'UMBRELLAS UP, SPIRITS HIGHER', 'STORMS PASS, WE REMAIN',
]
const DEPOT_SIGNS = [
  'THE MACHINES NEED NEW MANAGERS', 'OVERTIME FOR WHOM?', 'GREASE THE WHEELS OF DEMOCRACY',
  'OUR SHIFT ENDS WHEN VOTES RETURN', 'CRANES LIFT, COMMITTEES LOOT', 'NO LOADING WITHOUT A MANDATE',
  'STEEL IS HONEST — FORMS ARE NOT', 'HONK FOR OVERTIME PAY',
]
const RAAT_SIGNS = [
  'THE NIGHT BELONGS TO VOTERS', 'COUNT VOTES, NOT SHEEP', 'STREETLIGHTS ON, COMMITTEE OFF',
  'WE DON\'T SLEEP ON DEMOCRACY', 'MIDNIGHT IS OUR CURFEW', 'OWL PARLIAMENT ASSEMBLED',
  'CHAI STEAM & CIVIC DREAMS', 'THE MOON SAW EVERYTHING',
]
const AZAD_SIGNS = [
  'AZAD MAIDAN SAYS: VOTE!', 'ONE NATION, ONE FAIR COUNT', 'THE FINALE IS FAMILY',
  'EVERY LANTERN IS A BALLOT', 'DANCE LIKE THE COUNT IS HONEST', 'FREQUENCY: FREEDOM FM 101.1',
  'GRANDMOTHERS FOR JUSTICE', 'THE WHEEL TURNS FOR EVERYONE',
]

const BAZAAR_HOARDINGS = ['FESTIVAL OF THE FAIR COUNT', 'EAT · DANCE · VOTE', 'LIGHTS ON, COMMITTEE OFF']
const MONSOON_HOARDINGS = ['RAIN OR SHINE, WE VOTE', 'SLIPPERY WHEN CORRUPT', 'DRAINS DON\'T LIE — LEADERS DO']
const DEPOT_HOARDINGS = ['DEPOT SHIFT CHANGE 6PM', 'HEAVY VOTES AHEAD', 'NO ENTRY WITHOUT A MANDATE']
const RAAT_HOARDINGS = ['NIGHT SHIFT OF THE REPUBLIC', 'STREETLIGHTS KEEP SECRETS', 'OWL-SHIFT DEMOCRACY']
const AZAD_HOARDINGS = ['THE GRAND FINALE OF THE FAIR COUNT', 'AZAD MAIDAN WELCOMES EVERY VOTER', 'HISTORY IS POLLING NOW']

// ---------- the six campaign districts ----------
export const MAP_VARIANTS: MapVariant[] = [
  {
    id: 'classic',
    name: 'Purani Sadak',
    tagline: 'The old road where every campaign begins',
    minLevel: 1,
    difficulty: 1,
    xpMul: 1,
    timeOfDay: null, // keeps the v38 morning roll
    weather: null,   // keeps the living weather machine
    building: ['#c96f4a', '#b85c3e', '#7f9a8c', '#c9a86a', '#9a7b5f', '#8d6e63', '#a3b18a', '#c2b280', '#b07d62', '#7e9bb0'],
    homes: ['#d9b98a', '#cfa477', '#d8c49a', '#c2926a', '#bfae8e', '#d3b193', '#b9a27f', '#c8b093', '#c4a484', '#d6c8a8'],
    ground: '#c9a97c',
    road: '#6d675f',
    extras: [],
  },
  {
    id: 'bazaar',
    name: 'Naya Bazaar Utsav',
    tagline: 'A festival market at high noon — loud, bright, packed',
    minLevel: 3,
    difficulty: 2,
    xpMul: 1.1,
    timeOfDay: [11.5, 12.9],
    weather: 'clear',
    building: ['#c9a227', '#b85c3e', '#2f7f6f', '#c96f4a', '#d8b13c', '#7f9a8c', '#b23a48', '#c2b280', '#a34a2a', '#3c8d6e'],
    homes: ['#d9a95c', '#c98a5c', '#d8b98a', '#c2926a', '#bfae8e', '#d3a193', '#b98a7f', '#c8a093', '#c4b484', '#d6b8a8'],
    ground: '#c9a06a',
    road: '#75695a',
    shops: BAZAAR_SHOPS,
    signs: BAZAAR_SIGNS,
    hoardings: BAZAAR_HOARDINGS,
    extras: [
      // festival string lights across the avenue (poles just off the runway edge)
      { deco: { kind: 'stringLights', x: 0, z: -110, w: 19.6, color: '#ffbe55' }, box: [-9.95, 0, -110.2, -9.65, 5.2, -109.8] },
      { deco: { kind: 'stringLights', x: 0, z: -124, w: 19.6, color: '#ff9d5c' }, box: [9.65, 0, -124.2, 9.95, 5.2, -123.8] },
      { deco: { kind: 'stringLights', x: 0, z: -150, w: 19.6, color: '#ffbe55' }, box: [-9.95, 0, -150.2, -9.65, 5.2, -149.8] },
      { deco: { kind: 'stringLights', x: 0, z: -170, w: 19.6, color: '#ffd27a' }, box: [9.65, 0, -170.2, 9.95, 5.2, -169.8] },
      { deco: { kind: 'stringLights', x: 0, z: -186, w: 19.6, color: '#ff9d5c' }, box: [-9.95, 0, -186.2, -9.65, 5.2, -185.8] },
      // welcome arch over the bazaar entrance (clear of the chai stand at (8.9,-120))
      { deco: { kind: 'archGate', x: 0, z: -114, w: 20.4, h: 6.2, sign: 'NAYA BAZAAR UTSAV', color: '#b23a48' },
        box: [9.9, 0, -114.9, 10.7, 6.2, -113.1] },
      // extra festival stalls crowding the plaza margins — positions probe-verified
      // clear of every base collider (plaza buildings reach x ±13, the tutorial
      // platform owns x 10..22 z -70..-58)
      { deco: { kind: 'stall', x: 12.5, z: -16, ry: -Math.PI / 2, variant: 1, sign: 'Jalebi Junction', collider: true }, box: [10.8, 0, -17.7, 14.2, 2.4, -14.3] },
      { deco: { kind: 'stall', x: -16.5, z: -25, ry: Math.PI / 2, variant: 2, sign: 'Chaat Chowk', collider: true }, box: [-18.2, 0, -26.7, -14.8, 2.4, -23.3] },
      { deco: { kind: 'stall', x: 12.5, z: -40, ry: -Math.PI / 2, variant: 3, sign: 'Marigold Flower Mart', collider: true }, box: [10.8, 0, -41.7, 14.2, 2.4, -38.3] },
      { deco: { kind: 'stall', x: -16.5, z: -61, ry: Math.PI / 2, variant: 0, sign: 'Bangles & Bangara', collider: true }, box: [-18.2, 0, -62.7, -14.8, 2.4, -59.3] },
      // festive flagpoles
      { deco: { kind: 'flagpole', x: 13.5, z: -108, variant: 2 } },
      { deco: { kind: 'flagpole', x: -13.5, z: -122, variant: 1 } },
      { deco: { kind: 'flagpole', x: 13.5, z: -146, variant: 0 } },
      { deco: { kind: 'flagpole', x: -13.5, z: -168, variant: 2 } },
      // extra festive crowds (ambient, no colliders)
      { deco: { kind: 'crowd', x: 12.4, z: -104, ry: 1.2, variant: 2, sign: 'UTSAV MUBARAK!' } },
      { deco: { kind: 'crowd', x: -12.6, z: -130, ry: 4.1, variant: 4, sign: 'DANCE > PAPERWORK' } },
      { deco: { kind: 'crowd', x: 12.8, z: -160, ry: 2.2, variant: 1, sign: 'VOTE, THEN EAT JALEBI' } },
      { deco: { kind: 'crowd', x: -12.2, z: -176, ry: 0.4, variant: 3 } },
      { deco: { kind: 'crowd', x: 13.8, z: -92, ry: 5.5, variant: 5, sign: 'DHOL LOUDER THAN BUREAUCRACY' } },
      { deco: { kind: 'crowd', x: -13.8, z: -148, ry: 3.0, variant: 0 } },
    ],
  },
  {
    id: 'monsoon',
    name: 'Monsoon Mohalla',
    tagline: 'Steady rain at dusk — slick streets, low visibility, high spirit',
    minLevel: 5,
    difficulty: 3,
    xpMul: 1.2,
    timeOfDay: [16.4, 17.4],
    weather: 'rain',
    building: ['#5f7f6f', '#4e6e63', '#7f9a8c', '#6d8b7a', '#5c7a6e', '#7a8d99', '#667f74', '#8a9a8c', '#54685e', '#6e8a80'],
    homes: ['#7a8a7c', '#8a9a8c', '#6d7d70', '#7d8d80', '#5f6f62', '#88988a', '#6a7a6d', '#7f8f82', '#5a6a5e', '#83938a'],
    ground: '#8a7d5f',
    road: '#4a4a4e',
    shops: MONSOON_SHOPS,
    signs: MONSOON_SIGNS,
    hoardings: MONSOON_HOARDINGS,
    extras: [
      // tarpaulin awnings strung over the market margins
      { deco: { kind: 'banner', x: 10.8, z: -96, ry: 0.5, sign: 'CHHATA UMBRELLA WORKS', color: '#3c6e5e' } },
      { deco: { kind: 'banner', x: -10.8, z: -118, ry: -0.4, sign: 'PAKODA PLATFORM', color: '#4e6e63' } },
      { deco: { kind: 'banner', x: 10.8, z: -144, ry: 0.35, sign: 'BHEEGI SAREE DRY CLEANERS', color: '#5f7f6f' } },
      { deco: { kind: 'banner', x: -10.8, z: -170, ry: -0.5, sign: 'ADRAK CHAI POINT', color: '#3c6e5e' } },
      // extra lush trees (monsoon growth) — plaza + avenue margins
      { deco: { kind: 'tree', x: 12.5, z: -16, s: 1.2, variant: 0 }, box: [12.15, 0, -16.35, 12.85, 3, -15.65] },
      { deco: { kind: 'tree', x: -13, z: -24, s: 1.1, variant: 1 }, box: [-13.35, 0, -24.35, -12.65, 3, -23.65] },
      { deco: { kind: 'tree', x: 14, z: -42, s: 1.3, variant: 0 }, box: [13.65, 0, -42.35, 14.35, 3, -41.65] },
      { deco: { kind: 'tree', x: -12.5, z: -58, s: 1.05, variant: 1 }, box: [-12.85, 0, -58.35, -12.15, 3, -57.65] },
      { deco: { kind: 'tree', x: 13.5, z: -322, s: 1.2, variant: 0 }, box: [13.15, 0, -322.35, 13.85, 3, -321.65] },
      { deco: { kind: 'tree', x: -13.5, z: -330, s: 1.25, variant: 1 }, box: [-13.85, 0, -330.35, -13.15, 3, -329.65] },
      { deco: { kind: 'tree', x: -13, z: -410, s: 1.15, variant: 0 }, box: [-13.35, 0, -410.35, -12.65, 3, -409.65] },
      // checkpoint gate arch — the rain-soaked crossing
      { deco: { kind: 'archGate', x: 0, z: -232, w: 20.4, h: 6.2, sign: 'SECURITY CHECKPOINT 3 — RAIN OR SHINE', color: '#4e6e63' },
        box: [9.9, 0, -232.9, 10.7, 6.2, -231.1] },
      // extra drowned crowds
      { deco: { kind: 'crowd', x: 12.2, z: -22, ry: 2.4, variant: 1, sign: 'RAIN CANNOT CANCEL US' } },
      { deco: { kind: 'crowd', x: -12.8, z: -44, ry: 0.9, variant: 3, sign: 'OUR VOTES ARE WATERPROOF' } },
      { deco: { kind: 'crowd', x: 13.2, z: -66, ry: 5.1, variant: 5 } },
      { deco: { kind: 'crowd', x: -12.4, z: -292, ry: 1.7, variant: 2, sign: 'MUD TODAY, MANDATE TOMORROW' } },
      { deco: { kind: 'crowd', x: 13.6, z: -338, ry: 3.6, variant: 4 } },
    ],
  },
  {
    id: 'depot',
    name: 'Loha Depot',
    tagline: 'Iron, cranes and fog — the industrial belt watches closely',
    minLevel: 7,
    difficulty: 4,
    xpMul: 1.3,
    timeOfDay: [15.2, 16.2],
    weather: 'fog',
    building: ['#7a6a5a', '#8d9a8c', '#6e6a62', '#9a8d7a', '#5f5a52', '#7f8a8d', '#8a7d6a', '#6a6f72', '#84796a', '#5c6460'],
    homes: ['#8a8078', '#9a9088', '#7d746c', '#8d847c', '#6f665e', '#948a82', '#7a7068', '#877d75', '#6a6058', '#90867e'],
    ground: '#9a8d72',
    road: '#57534d',
    shops: DEPOT_SHOPS,
    signs: DEPOT_SIGNS,
    hoardings: DEPOT_HOARDINGS,
    extras: [
      // container stacks barricading the avenue margins
      { deco: { kind: 'crate', x: 16.8, z: -318, ry: 0.2, s: 1.6, color: '#8a4a3a' }, box: [14.9, 0, -319.9, 18.7, 4.2, -316.1] },
      { deco: { kind: 'crate', x: -16.8, z: -324, ry: -0.15, s: 1.6, color: '#4a6a5a' }, box: [-18.7, 0, -325.9, -14.9, 4.2, -322.1] },
      { deco: { kind: 'crate', x: 16.8, z: -408, ry: 0.4, s: 1.5, color: '#4a5a7a' }, box: [15, 0, -409.8, 18.6, 3.9, -406.2] },
      { deco: { kind: 'crate', x: -16.8, z: -414, ry: 0.1, s: 1.55, color: '#8a6a3a' }, box: [-18.6, 0, -415.8, -15, 4, -412.2] },
      { deco: { kind: 'crate', x: 44, z: -386, ry: 0.3, s: 1.6, color: '#5a6a4a' }, box: [42.1, 0, -387.9, 45.9, 4.2, -384.1] },
      { deco: { kind: 'crate', x: 100, z: -380, ry: -0.2, s: 1.5, color: '#7a4a4a' }, box: [98.1, 0, -381.8, 101.9, 3.9, -378.2] },
      // work barriers narrowing the depot approaches (clear of the stray-cow lane from (-10,-330))
      { deco: { kind: 'barrier', x: -12.9, z: -322, ry: 0.1, w: 5, d: 1.6, color: '#c9622e' }, box: [-15.4, 0, -322.8, -10.4, 1.1, -321.2] },
      { deco: { kind: 'barrier', x: -12.9, z: -412, ry: -0.08, w: 5, d: 1.6, color: '#c9622e' }, box: [-15.4, 0, -412.8, -10.4, 1.1, -411.2] },
      { deco: { kind: 'barrier', x: 12.9, z: -266, ry: 0.12, w: 5, d: 1.6, color: '#c9622e' }, box: [10.4, 0, -266.8, 15.4, 1.1, -265.2] },
      { deco: { kind: 'barrier', x: 12.9, z: -296, ry: -0.05, w: 5, d: 1.6, color: '#c9622e' }, box: [10.4, 0, -296.8, 15.4, 1.1, -295.2] },
      // the gantry crane silhouette over the depot yard
      { deco: { kind: 'crane', x: 100, z: -398, ry: 0, color: '#c9622e' }, box: [98.2, 0, -400, 101.8, 1.2, -396] },
      // depot gate arch
      { deco: { kind: 'archGate', x: 0, z: -294, w: 20.4, h: 6.2, sign: 'LOHA DEPOT — HEAVY VOTES AHEAD', color: '#c9622e' },
        box: [9.9, 0, -294.9, 10.7, 6.2, -293.1] },
      // hard-hat crowds
      { deco: { kind: 'crowd', x: 14.2, z: -286, ry: 2.8, variant: 0, sign: 'OVERTIME FOR WHOM?' } },
      { deco: { kind: 'crowd', x: -14.4, z: -310, ry: 4.4, variant: 2, sign: 'CRANES LIFT, COMMITTEES LOOT' } },
      { deco: { kind: 'crowd', x: 14.8, z: -398, ry: 1.1, variant: 1 } },
      { deco: { kind: 'crowd', x: -14.2, z: -398, ry: 5.7, variant: 5, sign: 'OUR SHIFT ENDS WHEN VOTES RETURN' } },
    ],
  },
  {
    id: 'raat',
    name: 'Raat Ki Raaj',
    tagline: 'Curfew night in the capital — only the streetlights are neutral',
    minLevel: 9,
    difficulty: 4,
    xpMul: 1.45,
    timeOfDay: [21.6, 22.6],
    weather: 'clear',
    building: ['#3a4a5c', '#4a3f4e', '#2f3e46', '#4e4454', '#384a52', '#50404a', '#2e3e4e', '#44485a', '#3c3444', '#2c3a44'],
    homes: ['#4a4a52', '#5a5258', '#3e3e46', '#544e54', '#36363e', '#585060', '#42424a', '#50484e', '#3a3a42', '#565460'],
    ground: '#5a5348',
    road: '#3a3a3e',
    shops: RAAT_SHOPS,
    signs: RAAT_SIGNS,
    hoardings: RAAT_HOARDINGS,
    extras: [
      // extra street lamps — the night city runs on them
      { deco: { kind: 'lamp', x: -10, z: -20 } },
      { deco: { kind: 'lamp', x: 10, z: -36 } },
      { deco: { kind: 'lamp', x: -10, z: -68 } },
      { deco: { kind: 'lamp', x: 10, z: -96 } },
      { deco: { kind: 'lamp', x: -10, z: -118 } },
      { deco: { kind: 'lamp', x: 10, z: -146 } },
      { deco: { kind: 'lamp', x: -10, z: -186 } },
      { deco: { kind: 'lamp', x: 12, z: -236 } },
      { deco: { kind: 'lamp', x: -12, z: -306 } },
      { deco: { kind: 'lamp', x: 12, z: -342 } },
      // cool-white festival strings over the night market
      { deco: { kind: 'stringLights', x: 0, z: -60, w: 19.6, color: '#cfe4ff' }, box: [-9.95, 0, -60.2, -9.65, 5.2, -59.8] },
      { deco: { kind: 'stringLights', x: 0, z: -150, w: 19.6, color: '#cfe4ff' }, box: [9.65, 0, -150.2, 9.95, 5.2, -149.8] },
      { deco: { kind: 'stringLights', x: 0, z: -262, w: 19.6, color: '#aac8f0' }, box: [-9.95, 0, -262.2, -9.65, 5.2, -261.8] },
      // night-watch arch
      { deco: { kind: 'archGate', x: 0, z: -334, w: 20.4, h: 6.2, sign: 'RAAT KI RAAJ — OWL SHIFT ON DUTY', color: '#3a4a5c' },
        box: [9.9, 0, -334.9, 10.7, 6.2, -333.1] },
      // lantern crowds
      { deco: { kind: 'crowd', x: 12.6, z: -26, ry: 1.8, variant: 2, sign: 'THE NIGHT BELONGS TO VOTERS' } },
      { deco: { kind: 'crowd', x: -12.4, z: -52, ry: 3.9, variant: 4, sign: 'WE DON\'T SLEEP ON DEMOCRACY' } },
      { deco: { kind: 'crowd', x: 12.8, z: -108, ry: 5.2, variant: 0 } },
      { deco: { kind: 'crowd', x: -12.6, z: -162, ry: 0.6, variant: 1, sign: 'MIDNIGHT IS OUR CURFEW' } },
      { deco: { kind: 'crowd', x: 13.4, z: -224, ry: 2.5, variant: 3 } },
      { deco: { kind: 'crowd', x: -13.2, z: -344, ry: 4.8, variant: 5, sign: 'STREETLIGHTS ON, COMMITTEE OFF' } },
    ],
  },
  {
    id: 'azad',
    name: 'Azad Maidan',
    tagline: 'The golden-hour finale — ferris wheel, flags and the last stand',
    minLevel: 12,
    difficulty: 5,
    xpMul: 1.6,
    timeOfDay: [17.4, 18.1],
    weather: 'clear',
    building: ['#c96f4a', '#d8b13c', '#b23a48', '#c9a227', '#a34a2a', '#2f7f6f', '#d89a5c', '#c2b280', '#b23a68', '#c98a2a'],
    homes: ['#d9b98a', '#d8a95c', '#c98a5c', '#d8b98a', '#c2926a', '#d3a193', '#c98a7f', '#d8a093', '#c4a484', '#d6b88a'],
    ground: '#c9a97c',
    road: '#6d675f',
    shops: AZAD_SHOPS,
    signs: AZAD_SIGNS,
    hoardings: AZAD_HOARDINGS,
    extras: [
      // THE FINALE LANDMARK — ferris wheel on the parliament plaza's east flank
      { deco: { kind: 'ferrisWheel', x: 40, z: -540, s: 1, color: '#b23a48' }, box: [37.2, 0, -543, 42.8, 1.4, -537] },
      // grand avenue arches
      { deco: { kind: 'archGate', x: 0, z: -438, w: 20.4, h: 6.6, sign: 'AZAD MAIDAN — THE GRAND FINALE', color: '#c96f4a' },
        box: [9.9, 0, -438.9, 10.7, 6.6, -437.1] },
      { deco: { kind: 'archGate', x: 0, z: -470, w: 20.4, h: 6.6, sign: 'ONE NATION, ONE FAIR COUNT', color: '#b23a48' },
        box: [9.9, 0, -470.9, 10.7, 6.6, -469.1] },
      // festival strings lighting the avenue (the -458 one moved clear of the Colony Cross Road band)
      { deco: { kind: 'stringLights', x: 0, z: -428, w: 19.6, color: '#ffbe55' }, box: [-9.95, 0, -428.2, -9.65, 5.2, -427.8] },
      { deco: { kind: 'stringLights', x: 0, z: -466, w: 19.6, color: '#ff9d5c' }, box: [9.65, 0, -466.2, 9.95, 5.2, -465.8] },
      { deco: { kind: 'stringLights', x: 0, z: -486, w: 19.6, color: '#ffd27a' }, box: [-9.95, 0, -486.2, -9.65, 5.2, -485.8] },
      // flag rows for the finale parade
      { deco: { kind: 'flagpole', x: 22, z: -442, variant: 2 } },
      { deco: { kind: 'flagpole', x: -22, z: -442, variant: 0 } },
      { deco: { kind: 'flagpole', x: 22, z: -462, variant: 1 } },
      { deco: { kind: 'flagpole', x: -22, z: -462, variant: 2 } },
      // celebration stalls (clear of the monument footprints x ±24..40, the Colony
      // Cross Road band and the boss gate)
      { deco: { kind: 'stall', x: 20.5, z: -465, ry: -Math.PI / 2, variant: 1, sign: 'Ferris Snack Wheel', collider: true }, box: [18.8, 0, -466.7, 22.2, 2.4, -463.3] },
      { deco: { kind: 'stall', x: -20.5, z: -465, ry: Math.PI / 2, variant: 2, sign: 'Victory Sweets', collider: true }, box: [-22.2, 0, -466.7, -18.8, 2.4, -463.3] },
      { deco: { kind: 'stall', x: 26, z: -480, ry: -Math.PI / 2 + 0.3, variant: 3, sign: 'Balloons & Bannerwala', collider: true }, box: [24.3, 0, -481.7, 27.7, 2.4, -478.3] },
      { deco: { kind: 'stall', x: -26, z: -480, ry: Math.PI / 2 - 0.3, variant: 0, sign: 'Kite Fighter Supplies', collider: true }, box: [-27.7, 0, -481.7, -24.3, 2.4, -478.3] },
      // the finale crowd
      { deco: { kind: 'crowd', x: 14.2, z: -432, ry: 2.9, variant: 1, sign: 'THE FINALE IS FAMILY' } },
      { deco: { kind: 'crowd', x: -14.6, z: -446, ry: 0.8, variant: 4, sign: 'EVERY LANTERN IS A BALLOT' } },
      { deco: { kind: 'crowd', x: 15.2, z: -466, ry: 4.6, variant: 2, sign: 'DANCE LIKE THE COUNT IS HONEST' } },
      { deco: { kind: 'crowd', x: -15, z: -480, ry: 1.4, variant: 0 } },
      { deco: { kind: 'crowd', x: 24.6, z: -500, ry: 3.3, variant: 5, sign: 'GRANDMOTHERS FOR JUSTICE' } },
      { deco: { kind: 'crowd', x: -24.4, z: -506, ry: 5.9, variant: 3 } },
    ],
  },
]

/** Ordered fastest-first; mapForLevel picks the LAST variant whose minLevel ≤ level. */
export const MAP_ORDER = MAP_VARIANTS

/** The district a profile level plays (highest unlocked tier). */
export function mapForLevel(level: number): MapVariant {
  let picked = MAP_VARIANTS[0]
  for (const m of MAP_VARIANTS) if (level >= m.minLevel) picked = m
  return picked
}

/** Look up a variant by id (unknown ids fall back to classic — never throw). */
export function mapById(id: string | null | undefined): MapVariant {
  return MAP_VARIANTS.find((m) => m.id === id) ?? MAP_VARIANTS[0]
}

/** The next district that unlocks AFTER `level`, if any (for menu/EndScreen teasers). */
export function nextMapUnlock(level: number): MapVariant | null {
  return MAP_VARIANTS.find((m) => m.minLevel > level) ?? null
}
