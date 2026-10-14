// VoteChor shared constants — pure data, usable on server and client.
import type { Archetype, ItemType } from './types'

export const GAME_NAME = 'VoteChor: The Great Parliament Run'
export const TICK_HZ = 12 // player state send rate
export const NPC_TICK_HZ = 10
export const DETENTION_SECONDS = 20
export const TOKENS_NEEDED = 12
export const MATCH_TIME_LIMIT = 900 // 15 minutes

// ---------- Movement (meters, seconds) ----------
export const MOVE = {
  walkSpeed: 5.2,
  sprintSpeed: 9.2,
  npcChaseSpeed: 6.6,
  accel: 34,
  friction: 22,
  jumpVel: 7.4,
  doubleJumpVel: 6.9,   // mid-air second jump impulse
  maxAirJumps: 1,       // extra jumps per airborne sequence (double jump)
  coyoteTime: 0.1,      // grace window after leaving a ledge (s)
  jumpBuffer: 0.12,     // early-press buffering window (s)
  gravity: 21,
  slideBoost: 11.5,
  slideFriction: 6.5,
  slideDuration: 0.85,
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

// ---------- Items ----------
export const ITEM_CONFIG: Record<ItemType, { name: string; icon: string; stack: number; desc: string }> = {
  bottle: { name: 'Plastic Bottle', icon: '🍾', stack: 5, desc: 'Throw to distract police (Q)' },
  sign:   { name: 'Cardboard Sign', icon: '🪧', stack: 3, desc: 'Protest in style. Throwable.' },
  chai:   { name: 'Chai Cup', icon: '☕', stack: 3, desc: 'Use: full stamina + brief speed' },
  firstaid: { name: 'First-Aid Kit', icon: '🩹', stack: 2, desc: 'Use: heal 50 HP' },
  snack:  { name: 'Energy Snack', icon: '🍬', stack: 3, desc: 'Use: speed boost 8s' },
  token:  { name: 'Stolen Vote Token', icon: '🗳️', stack: 99, desc: 'Recover the stolen votes!' },
  foam:   { name: 'Foam Finger', icon: '🖐️', stack: 2, desc: 'Throwable. Very dramatic.' },
  joke:   { name: 'Mystery Samosa', icon: '🥟', stack: 1, desc: 'Eat at your own risk.' },
}

export const INVENTORY_MAX = 8

// ---------- Damage ----------
export const DAMAGE = {
  policeHit: 13, // legacy reference value (POLICE_ATTACK.dmgByType is authoritative)
  vehicleHit: 35,
  stampHit: 30,
  paperworkHit: 10,
  fallDamageMin: 9,
  dazedDuration: 4,
  dazedRecoverHealth: 50,
}

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
  victoryBonus: 400,
  participation: 50,
}

// ---------- Gifting (§11 eligible item sharing) ----------
export const GIFT_RADIUS = 4.5 // server-side max distance between giver & receiver
export const GIFT_TYPES: string[] = ['chai', 'firstaid', 'snack', 'joke', 'bottle', 'sign', 'foam']

export const levelFromXp = (xp: number): number => Math.max(1, Math.floor(Math.sqrt(xp / 120)) + 1)
export const xpForLevel = (level: number): number => Math.pow(level - 1, 2) * 120

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
