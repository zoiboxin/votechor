// VoteChor shared types — imported by client, server, and UI. NO three.js or DOM imports.

export interface Vec3 { x: number; y: number; z: number }
export interface Vec2 { x: number; z: number }

// ---------- World ----------
export interface AABB {
  minX: number; minY: number; minZ: number
  maxX: number; maxY: number; maxZ: number
  walkable?: boolean // can be stood on (platforms/ramps)
  prop?: boolean // v47 — solid street prop (stall/scooter/bench/…); tests scope placement checks to these
}

export type DecoKind =
  | 'building' | 'stall' | 'tree' | 'bench' | 'scooter' | 'fountain'
  | 'banner' | 'lamp' | 'crowd' | 'tower' | 'crate' | 'barrier'
  | 'monument' | 'flagpole' | 'billboard' | 'cart' | 'auto' | 'teaKettle'
  | 'sign' | 'planter' | 'stage' | 'toilet' | 'hoarding'
  | 'home' | 'wall' | 'clothesline'
  // v43 level-map landmarks — variant-only props appended by buildWorldDef(mapId)
  | 'stringLights' | 'archGate' | 'ferrisWheel' | 'crane'
  // v64 wild round world — jungle ring, graveyard, countryside, mountain rim
  | 'jtree' | 'palm' | 'shrub' | 'grass' | 'fern' | 'log' | 'stump'
  | 'boulder' | 'deadTree' | 'grave' | 'track' | 'hut' | 'hay'
  | 'mountain'

export interface Deco {
  kind: DecoKind
  x: number; z: number
  y?: number
  ry?: number
  w?: number  // footprint / scale params per kind
  d?: number
  h?: number
  s?: number  // generic scale
  variant?: number
  color?: string
  sign?: string   // text on signs/billboards
  collider?: boolean // register a static AABB
  cw?: number     // mountain colorway: 0 granite rim/ridge · 1 green hills · 2 hazy far
  seed?: number   // mountain shape seed (8 buckets, deterministic)
  base?: number   // mountain base radius (m)
}

export type ItemType = 'bottle' | 'sign' | 'chai' | 'firstaid' | 'snack' | 'token' | 'foam' | 'joke'

export interface ItemSpawn {
  id: string
  type: ItemType
  x: number; y: number; z: number
  respawn?: number // seconds; 0 = never respawns (confiscated loot); token = single-use
}

export type NpcType = 'police' | 'security' | 'guard' | 'searchlight'

export interface NpcSpawn {
  id: string
  type: NpcType
  x: number; z: number
  patrol: Array<[number, number]>
  zone: number // 0..4
}

export interface CheckpointDef {
  id: number
  name: string
  x: number; z: number
  radius: number
  detention: Vec2 // where captured players are released
}

export interface SearchlightDef { id: string; x: number; z: number; ry: number; speed: number }

export interface VehicleDef {
  id: string
  path: Array<[number, number]>
  speed: number
  kind: 'auto' | 'bus' | 'cow' | 'car' | 'bike'
}

export interface CrossRoadDef {
  z: number      // center line of an east-west street
  halfW: number  // asphalt half-width in meters
}

export interface WorldDef {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  spawn: Vec2
  zones: { name: string; hint: string; zStart: number; zEnd: number }[]
  crossRoads: CrossRoadDef[]
  colliders: AABB[]
  decorations: Deco[]
  items: ItemSpawn[]
  npcs: NpcSpawn[]
  checkpoints: CheckpointDef[]
  searchlights: SearchlightDef[]
  vehicles: VehicleDef[]
  bossArena: { x: number; z: number; radius: number; gateZ: number }
  landmarks: { name: string; x: number; z: number }[]
  // v43 level-map identity + theming (classic defaults when built without a map id)
  mapId?: string
  mapName?: string
  mapTagline?: string
  /** district XP multiplier applied at match end (maps.ts) */
  xpMul?: number
  /** 1..5 difficulty pips (maps.ts) */
  difficulty?: number
  /** ground base tint (renderer derives speckle shading) */
  groundTint?: string
  /** asphalt tint */
  roadTint?: string
}

// ---------- Characters ----------
export interface Archetype {
  id: string
  name: string
  desc: string
  perk: string
  colors: { shirt: string; pants: string; skin: string; hair: string; accent: string }
  stats: { speedMul: number; staminaMul: number; healthBonus: number; scale: number }
}

// ---------- Networking ----------
export type AnimName = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'land' | 'recover' | 'slide' | 'dazed' | 'detained' | 'celebrate' | 'throw' | 'heal' | 'down'

export interface PlayerNetState {
  id: string
  name: string
  archetype: string
  x: number; y: number; z: number
  ry: number
  anim: AnimName
  health: number
  detained: boolean
  dazed: boolean
  squad?: string
  emote?: string
  tokens?: number
  /** Wardrobe — included ONLY in the join ack + game:playerjoined (10Hz snapshots omit it). */
  cosmetics?: Record<string, string | boolean>
  /** Chosen side — 'police' renders the officer rig; included with cosmetics (join ack + playerjoined). */
  role?: 'protector' | 'police'
}

export type NpcStateName = 'patrol' | 'suspicious' | 'investigate' | 'chase' | 'capture' | 'return' | 'idle'

export interface NpcNetState {
  id: string
  x: number; z: number
  ry: number
  state: NpcStateName
  alert: number // 0..1
  target?: string // player id being chased
  anim?: 'idle' | 'walk' | 'run' | 'windup' | 'stagger' // police melee telegraph/render state
  attackAt?: number // server Date.now() the pending strike lands (client syncs impact FX)
}

export interface ItemNetState { id: string; taken: boolean; takenBy?: string; respawnAt?: number }

/**
 * Loot dropped when police confiscate a detainee's inventory cards (game:dropped).
 * Ids are dynamic (`drop_*`) — clients spawn them via ItemSystem.spawnDropped.
 * expiresAt is server Date.now(); the room broadcasts game:dropGone on expiry/pickup.
 */
export interface DroppedItemNetState { id: string; type: ItemType; x: number; y: number; z: number; expiresAt: number }

export interface ProjectileNetState {
  id: string
  type: string
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  owner?: string
}

export interface Telegraph { id: string; kind: 'stamp' | 'cone' | 'ring'; x: number; z: number; r: number; t: number; dur: number }

export interface StationState { id: string; x: number; z: number; progress: number; need: number; active: boolean }

export interface BossNetState {
  active: boolean
  phase: number // 0=intro,1..5,6=defeated
  health: number
  maxHealth: number
  stateName: string
  timer: number
  speechProgress: number // 0..100 phase1 boss speech meter
  interruptPoints: number // phase1 objective progress
  documents: number // phase2 progress
  hits: number // phase3 progress
  dizzyTimer: number
  teamworkProgress: number // phase4 progress
  votes: number // phase5 progress
  votesNeeded: number
  x: number; z: number; ry: number
  telegraphs: Telegraph[]
  stations: StationState[]
  paperwork: { id: string; x: number; z: number; vx: number; vz: number }[]
}

export interface MatchEndPayload {
  matchId: string
  victory: boolean
  duration: number
  position: number
  tokens: number
  distance: number
  checkpoints: number
  rescues: number
  revives: number
  itemsCollected: number
  bossContribution: number
  detentions: number
  /** vote tokens + item cards police seized on detention (client-computed) */
  confiscated?: number
  confiscatedItems?: number
  /** arrests made (police role) — server counts validated detentions the local officer performed */
  arrests?: number
  playersOnline: number
}

// ---------- Humor ----------
export interface HumorNotification { text: string; kind: 'info' | 'capture' | 'achievement' | 'squad' | 'boss' | 'warning' }
