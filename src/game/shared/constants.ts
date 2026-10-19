// VoteChor shared constants — pure data, usable on server and client.
import type { Archetype, ItemType } from './types'

export const GAME_NAME = 'VoteChor: The Great Parliament Run'
export const TICK_HZ = 12 // player state send rate
export const NPC_TICK_HZ = 10
export const DETENTION_SECONDS = 20
export const TOKENS_NEEDED = 12
export const MATCH_TIME_LIMIT = 900 // 15 minutes

// ---------- World extent (must match world-def walls; used by maps/minimap/BigMap) ----------
// v69 — the ROUND world: a giant disc of jungle surrounding the rectangular city.
// WORLD_BOUNDS is the disc's bounding square (kept as a rectangle so the minimap,
// big map and the server's backstop clamp keep working); the true playfield is the
// circle below — walls, leash, minimap mask and ground all follow WORLD_DISC.
// v72 — "make map big, mountains far from the city": the disc grew r 465 → 650
// (1300 m across, ~2x the diameter) and the center shifted north (−379 → −340) so
// the jungle wraps the long city evenly. The layered rings in world-def push the
// green hills to r 470..545, the Vanodyan Rim to 587..647 and the Far Range to
// 690..770 — from the city edge there is now 86..375 m of dense jungle before the
// first foothill, and the skyline reads as a distant horizon range, not a wall.
export const WORLD_BOUNDS = { minX: -658, maxX: 658, minZ: -998, maxZ: 318 }
export const WORLD_DISC = { cx: 0, cz: -340, r: 650 }
// v69 — the Vanodyan Kabristan: the graveyard deep in the west jungle
export const GRAVEYARD = { x: -265, z: -330, r: 44 }

// ---------- Movement (meters, seconds) ----------
// v51 — walk 5.2→6.0 & accel 34→40: the user-reported "normal walking feels slow
// and heavy". NPC per-type chase speeds (npc-brain) were raised in lock-step
// (6.2/6.8/7.0) so officers can still catch a walking protester.
export const MOVE = {
  walkSpeed: 6.0,
  sprintSpeed: 9.2,
  npcChaseSpeed: 7.0,
  accel: 40,
  friction: 22,
  jumpVel: 7.4,
  doubleJumpVel: 6.9,   // mid-air second jump impulse
  maxAirJumps: 1,       // extra jumps per airborne sequence (double jump)
  coyoteTime: 0.1,      // grace window after leaving a ledge (s)
  jumpBuffer: 0.12,     // early-press buffering window (s)
  gravity: 21,
  // ---- slide (C) — tuned for a 4-5 step glide (~5 m): v0 12.2 m/s decaying
  // under friction 2.4 for 1.5 s ≈ 12.2/2.4 · (1−e^(−3.6)) ≈ 4.95 m, with a
  // brief get-up window afterwards (player.ts) so the rise reads on the body
  slideBoost: 12.2,
  slideFriction: 2.4,
  slideDuration: 1.5,
  staminaMax: 100,
  staminaDrain: 20,
  staminaRegen: 13,
  slideCost: 12,
  stepHeight: 0.62,
  playerRadius: 0.42,
  playerHeight: 1.75,
  eyeHeight: 1.62,
}

// ---------- Detection ----------
export const DETECT = {
  viewDist: 15,
  viewDistLit: 24,
  fovDeg: 105,
  captureRadius: 1.7,
  captureTime: 0.45,
  alertRise: 1.35,   // per second in view
  alertDecay: 0.5,
  searchlightRise: 2.2,
  noiseRadius: 20,
  forgetAfter: 7,
  sameTargetCooldown: 8,
  // v51 — soft escape: a chase is dropped once the target is clearly out of reach
  // (escapeMul × viewDist ≈ 33 m) after at least escapeAfterSec of pursuit, so
  // outrunning the officer actually ends the hunt (the WANTED badge then fades).
  escapeMul: 2.2,
  escapeAfterSec: 6,
  // v51 — pack pursuit: officers within this distance of an actively-chasing
  // colleague pick up the same target (propagateChase in npc-brain).
  packChaseRadius: 16,
}

// ---------- Police melee combat (Phase 5) — shared by server FSM + client telegraphs ----------
export const POLICE_ATTACK = {
  windupSec: 0.55,          // visible telegraph before the strike lands (dodge window)
  chaseAttackRange: 2.2,    // distance at which a chasing NPC begins a wind-up
  strikeRange: 2.6,         // target must still be within this at strike moment
  cooldownSec: 1.5,         // per-NPC delay between attacks
  dmgByType: { police: 13, security: 11, guard: 16 } as Record<string, number>,
  fallbackDmg: 13,          // unknown NPC types
  weakenedHealth: 30,       // below this HP the capture hold time is halved
  weakenedCaptureMul: 0.5,
}

// ---------- Player role (protector | police) ----------
// Protector = the classic protester experience. Police = play ON the other side:
// a uniformed officer with arrest powers whom NPC officers treat as a colleague.
export const PLAYER_ROLE = {
  arrestRange: 2.8,       // how close an officer-player must be to cuff a suspect
  arrestCooldownMs: 1400, // per-player arrest spam gate (server re-validates)
  arrestXp: 40,           // mirror of XP_TABLE.perArrest (HUD score math)
  scorePerArrest: 120,    // HUD score contribution per arrest
}

// Police-role baton strike (F key) — officer-players can lathi-hit protesters.
// Damage is server-authoritative online; offline training-day suspects get a
// knockback + stagger instead (they carry no HP bar).
export const POLICE_STRIKE = {
  range: 2.6,       // lathi reach — mirrors POLICE_ATTACK.strikeRange
  cooldownMs: 1100, // per-officer swing gate (client + server both enforce)
  dmg: 13,          // mirrors POLICE_ATTACK.dmgByType.police — the officer baton is the officer baton
  knockback: 2.2,   // offline suspect shove distance (m)
  staggerMs: 900,   // offline suspect stumble time before they bolt
}

// ---------- Items ----------
export const ITEM_CONFIG: Record<ItemType, { name: string; icon: string; stack: number; desc: string }> = {
  bottle: { name: 'Plastic Bottle', icon: '🍾', stack: 5, desc: 'Throw to distract police (Q)' },
  sign:   { name: 'Cardboard Sign', icon: '🪧', stack: 3, desc: 'Protest in style. Throwable.' },
  chai:   { name: 'Chai Cup', icon: '☕', stack: 3, desc: 'Use: +10 HP, full ⚡ energy & speed' },
  firstaid: { name: 'First-Aid Kit', icon: '🩹', stack: 2, desc: 'Use: heal 50 HP' },
  snack:  { name: 'Energy Snack', icon: '🍬', stack: 3, desc: 'Use: +5 HP, +60 ⚡ instant energy, speed 8s' },
  token:  { name: 'Stolen Vote Token', icon: '🗳️', stack: 99, desc: 'Recover the stolen votes!' },
  foam:   { name: 'Foam Finger', icon: '🖐️', stack: 2, desc: 'Throwable. Very dramatic.' },
  joke:   { name: 'Mystery Samosa', icon: '🥟', stack: 1, desc: 'Eat: +10 HP & +30 ⚡ energy. At your own risk.' },
}

export const INVENTORY_MAX = 8

// ---------- Damage & recovery ----------
export const DAMAGE = {
  policeHit: 13, // legacy reference value (POLICE_ATTACK.dmgByType is authoritative)
  vehicleHit: 35,
  stampHit: 30,
  paperworkHit: 10,
  fallDamageMin: 9,
  dazedDuration: 4,
  dazedRecoverHealth: 50,
  regenDelaySec: 9,   // out-of-combat time before health starts ticking back up
  regenPerSec: 3,     // slow trickle — food items are the real healing
}

// ---------- Shout / whistle (V) — free police distraction ----------
export const SHOUT_COOLDOWN_SEC = 2.5
export const SHOUT_LINES = [
  'AAZADI!',
  'YEH DEKHO! OVER HERE!',
  '*shrill whistle*',
  'KOI HAI?!',
  'CONSTABLE SAHAB, EK MINUTE!',
  '*loud finger whistle*',
  'SORRY JI, EMERGENCY!',
  'EH! COMMITTEE WALON!',
]

// ---------- Character archetypes ----------
export const ARCHETYPES: Archetype[] = [
  {
    id: 'student', name: 'College Student', desc: 'Went for one lecture. Found a revolution.',
    perk: '+10% XP from vote tokens',
    colors: { shirt: '#2f9e6e', pants: '#28303e', skin: '#c68a5c', hair: '#191512', accent: '#f2c14e' },
    stats: { speedMul: 1, staminaMul: 1, healthBonus: 0, scale: 1 },
  },
  {
    id: 'it_employee', name: 'IT Employee', desc: 'Committed zero bugs and one act of civil disobedience.',
    perk: '+20% stamina regen (filter coffee powered)',
    colors: { shirt: '#7ea8d8', pants: '#39424e', skin: '#b97a4e', hair: '#221a14', accent: '#e8e6df' },
    stats: { speedMul: 1, staminaMul: 1.2, healthBonus: 0, scale: 1 },
  },
  {
    id: 'uncle', name: 'Overconfident Uncle', desc: 'Has never been wrong since 1987. Ask him.',
    perk: '+25 max HP, 10% slower',
    colors: { shirt: '#e6e0d2', pants: '#8a8574', skin: '#c1854f', hair: '#9b9b93', accent: '#b54a32' },
    stats: { speedMul: 0.9, staminaMul: 1, healthBonus: 25, scale: 1.08 },
  },
  {
    id: 'chai_sprinter', name: 'Chai-Fueled Sprinter', desc: 'Six cups since sunrise. Legs have filed a complaint.',
    perk: '+12% move speed, stamina drains 15% faster',
    colors: { shirt: '#d9822b', pants: '#4a3b2a', skin: '#a9713f', hair: '#141110', accent: '#f7e6c4' },
    stats: { speedMul: 1.12, staminaMul: 0.87, healthBonus: 0, scale: 0.97 },
  },
  {
    id: 'journalist', name: 'Amateur Journalist', desc: 'Press badge laminated at home. Still counts.',
    perk: 'Sees NPCs on minimap from farther away',
    colors: { shirt: '#c9c4b4', pants: '#2e2a26', skin: '#d09a68', hair: '#0f0d0c', accent: '#8c1f28' },
    stats: { speedMul: 1, staminaMul: 1, healthBonus: 0, scale: 1 },
  },
  {
    id: 'strategist', name: 'Street-Smart Strategist', desc: 'Knows every galli, every shortcut, every aunty.',
    perk: 'Bottle distractions last 60% longer',
    colors: { shirt: '#5c7f4e', pants: '#33302a', skin: '#b47a49', hair: '#171310', accent: '#d8b13c' },
    stats: { speedMul: 1, staminaMul: 1.08, healthBonus: 0, scale: 1 },
  },
  {
    id: 'debate_champ', name: 'Retired Debate Champion', desc: '1989 college champion. Will bring it up. Often.',
    perk: 'Revives teammates 40% faster',
    colors: { shirt: '#8c4a5e', pants: '#2c2f38', skin: '#c78d5b', hair: '#d8d4cb', accent: '#e3d9c2' },
    stats: { speedMul: 1, staminaMul: 1, healthBonus: 10, scale: 1.02 },
  },
  {
    id: 'accidental', name: 'Accidental Protester', desc: 'Came to return a lost wallet. Stayed for history.',
    perk: '-25% detention time',
    colors: { shirt: '#b3854a', pants: '#4f4a3c', skin: '#caa07a', hair: '#2b211a', accent: '#4e7d6b' },
    stats: { speedMul: 1, staminaMul: 1, healthBonus: 0, scale: 1 },
  },
]

export const archetypeById = (id: string): Archetype => ARCHETYPES.find(a => a.id === id) ?? ARCHETYPES[0]

// ---------- XP ----------
export const XP_TABLE = {
  perMeter: 0.35,
  perCheckpoint: 60,
  perToken: 45,
  perRescue: 90,
  perRevive: 70,
  perItem: 4,
  perGift: 18,
  bossHit: 12,
  perArrest: 40, // police role: XP per suspect detained
  victoryBonus: 400,
  participation: 50,
}

// ---------- Gifting (§11 eligible item sharing) ----------
export const GIFT_RADIUS = 4.5 // server-side max distance between giver & receiver
export const GIFT_TYPES: string[] = ['chai', 'firstaid', 'snack', 'joke', 'bottle', 'sign', 'foam']

export const levelFromXp = (xp: number): number => Math.max(1, Math.floor(Math.sqrt(xp / 120)) + 1)
export const xpForLevel = (level: number): number => Math.pow(level - 1, 2) * 120

// ---------- Street animals (feed-to-follow pets) ----------
export const FEED_RADIUS = 3.4           // how close you must stand to offer food
export const PET_FOLLOW_SEC = 90         // follow time earned per feeding
export const FEED_FOODS: string[] = ['chai', 'snack', 'joke'] // first-aid is medical, not food

// ---------- Achievements (server seeds these) ----------
export const ACHIEVEMENTS = [
  { id: 'first_steps', name: 'First Steps', description: 'Complete the training plaza', icon: 'footprints', xpReward: 40 },
  { id: 'barrier_jumper', name: 'Professional Barricade Jumper', description: 'Jump over 10 barricades', icon: 'fence', xpReward: 60 },
  { id: 'chai_guardian', name: 'Chai Guardian', description: 'Drink 5 cups of chai', icon: 'coffee', xpReward: 60 },
  { id: 'rescuer', name: 'Jailbreak Artist', description: 'Rescue 3 detained teammates', icon: 'key-round', xpReward: 90 },
  { id: 'medic', name: 'Squad Medic', description: 'Revive 5 teammates', icon: 'heart-pulse', xpReward: 80 },
  { id: 'untouchable', name: 'Untouchable', description: 'Finish a match with zero detentions', icon: 'shield', xpReward: 120 },
  { id: 'marathoner', name: 'Marathoner', description: 'Travel 3 km in total', icon: 'route', xpReward: 70 },
  { id: 'token_collector', name: 'Vote Vigilante', description: 'Collect 25 vote tokens in total', icon: 'vote', xpReward: 90 },
  { id: 'boss_slayer', name: 'Committee Dissolved', description: 'Defeat The Great Vote Collector', icon: 'crown', xpReward: 200 },
  { id: 'democracy_defender', name: 'Democracy Defender', description: 'Win a multiplayer match', icon: 'landmark', xpReward: 150 },
  { id: 'traffic_cone', name: 'Promoted to Traffic Cone', description: 'Get detained 10 times. Congratulations?', icon: 'cone', xpReward: 50 },
  { id: 'sniper', name: 'Bottle Sniper', description: 'Distract 10 police patrols with bottles', icon: 'target', xpReward: 80 },
  { id: 'good_samaritan', name: 'Good Samaritan', description: 'Gift 3 items to teammates in one match', icon: 'gift', xpReward: 70 },
]

// ---------- Humor ----------
export const CAPTURE_MESSAGES = [
  'Detained for Excessive Sprinting.',
  'Detained: Suspected of Knowing Too Much About Traffic Rules.',
  'You have been arrested on behalf of a committee that does not exist.',
  'Charged with Walking With Purpose in a No-Walking-With-Purpose Zone.',
  'Detained for Carrying a Water Bottle with Suspicious Confidence.',
  'The Police Constable would like a word. And a selfie.',
  'Booked under Section 420-D: Being Too Fast During Office Hours.',
  'Detained pending a full inquiry into why you were running so cheerfully.',
  'Your pockets have been emptied for "evidence processing". Every last vote.',
  'Confiscation receipt issued: all votes & items seized. Yours, technically. Never returned.',
]

export const RANDOM_NOTIFICATIONS = [
  'Breaking News: Uncle Ji Has Entered the Restricted Zone.',
  'Democracy is loading… please wait.',
  'The chai supply is under threat.',
  'Your squad has lost the plot.',
  'A committee has been formed to investigate the previous committee.',
  'The boss has requested another committee meeting.',
  'Traffic police have declared your running "spiritually illegal".',
  'Weather update: 100% chance of paperwork.',
  'Local aunty endorses your protest. Gossip at 11.',
  'The pigeons have chosen a side.',
  'Somewhere, a form is being filled in triplicate. For you.',
  'A stray dog has been appointed returning officer.',
]

export const RESCUE_MESSAGES = [
  'Teammate extracted. bribes used: zero. drama: maximum.',
  'Your teammate has been un-detained. Paperwork filed retroactively.',
  'Rescue successful. The committee is furious.',
]

export const VICTORY_TITLES = (p: {
  detentions: number; rescues: number; revives: number; items: number; distance: number; victory: boolean; gifts?: number
}): string => {
  if (!p.victory && p.detentions >= 5) return 'The Committee’s Favourite Guest'
  if (p.rescues >= 3) return 'Jailbreak Legend'
  if (p.revives >= 3) return 'Squad’s Belomed Angel'
  if ((p.gifts ?? 0) >= 3) return 'The People’s Gifter'
  if (p.distance > 1600) return 'Human Auto-Rickshaw'
  if (p.items >= 25) return 'Street Kabadiwalan'
  if (p.detentions === 0) return 'Ghost of the Galli'
  if (p.victory) return 'Defender of Democracy'
  return 'Professional Protest Enthusiast'
}

export const BOSS_NAME = 'The Great Vote Collector'
export const BOSS_PHASE_NAMES = [
  'Arrival of the Committee',
  'The Speech',
  'Bureaucracy Attack',
  'The Giant Stamp',
  'Teamwork Challenge',
  'The Final Vote',
]
