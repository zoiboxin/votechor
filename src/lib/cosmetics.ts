// VoteChor cosmetic unlock catalog — pure data + pure helpers, safe for
// both the Next.js API routes (server-authoritative validation) and the
// React UI (lock display). Never import three.js or DB code here.

export type CosmeticUnlock =
  | { type: 'free' }
  | { type: 'level'; level: number }
  | { type: 'achievement'; code: string }

export type CatalogKind = CosmeticKind | 'emote'

export interface CosmeticItem {
  id: string
  kind: CatalogKind
  label: string
  emoji: string
  desc: string
  unlock: CosmeticUnlock
}

export const HAT_CATALOG: CosmeticItem[] = [
  {
    id: 'none',
    kind: 'hat',
    label: 'No Hat',
    emoji: '🚫',
    desc: 'Bold. Bald. Bureaucracy-proof.',
    unlock: { type: 'free' },
  },
  {
    id: 'cap',
    kind: 'hat',
    label: 'Protest Cap',
    emoji: '🧢',
    desc: 'Standard-issue revolutionary headwear.',
    unlock: { type: 'free' },
  },
  {
    id: 'topi',
    kind: 'hat',
    label: 'Ceremonial Topi',
    emoji: '🎩',
    desc: 'For protesters with distinguished gravitas.',
    unlock: { type: 'level', level: 3 },
  },
  {
    id: 'garland',
    kind: 'hat',
    label: 'Marigold Garland',
    emoji: '🌼',
    desc: 'Worn by healers. Smells like victory and vapour rub.',
    unlock: { type: 'achievement', code: 'medic' },
  },
  {
    id: 'cone',
    kind: 'hat',
    label: 'Traffic Cone of Shame',
    emoji: '🦺',
    desc: 'You earned this. Somehow. Wear it proudly.',
    unlock: { type: 'achievement', code: 'traffic_cone' },
  },
  {
    id: 'crown',
    kind: 'hat',
    label: 'Crown of Chaos',
    emoji: '👑',
    desc: 'Only for those who dissolved the Committee itself.',
    unlock: { type: 'achievement', code: 'boss_slayer' },
  },
  {
    id: 'bandana',
    kind: 'hat',
    label: 'Rebel Bandana',
    emoji: '🎀',
    desc: 'Tied tight. Zero thoughts, full march.',
    unlock: { type: 'free' },
  },
  {
    id: 'hardhat',
    kind: 'hat',
    label: 'Site Hardhat',
    emoji: '⛑️',
    desc: 'Barricades fear the awkward bump.',
    unlock: { type: 'level', level: 5 },
  },
]

export const COSMETIC_IDS = new Set(HAT_CATALOG.map((h) => h.id))

export function cosmeticById(id: string): CosmeticItem | undefined {
  return HAT_CATALOG.find((h) => h.id === id)
}

/** Human-readable unlock criteria, e.g. "Reach level 3" or "Unlock: Squad Medic". */
export function unlockLabel(item: CosmeticItem): string {
  if (item.unlock.type === 'free') return 'Unlocked by default'
  if (item.unlock.type === 'level') return `Reach level ${item.unlock.level}`
  return `Earn medal: ${item.unlock.code.replaceAll('_', ' ').toUpperCase()}`
}

/** Short label for the achievement-name part (UI shows a nicer name via ACHIEVEMENTS if available). */
export function unlockCriteria(item: CosmeticItem): string {
  if (item.unlock.type === 'free') return ''
  if (item.unlock.type === 'level') return `LV ${item.unlock.level}`
  return item.unlock.code
}

/** Compute the set of hat ids a player may equip. Pure function — used by both API and UI. */
export function unlockedHatIds(level: number, achievementCodes: Iterable<string>): Set<string> {
  const codes = achievementCodes instanceof Set ? achievementCodes : new Set(achievementCodes)
  const out = new Set<string>()
  for (const item of HAT_CATALOG) {
    if (item.unlock.type === 'free') out.add(item.id)
    else if (item.unlock.type === 'level' && level >= item.unlock.level) out.add(item.id)
    else if (item.unlock.type === 'achievement' && codes.has(item.unlock.code)) out.add(item.id)
  }
  return out
}

/** True if `hat` may be equipped at `level` with `achievementCodes`. Unknown ids are rejected. */
export function hatIsUnlocked(hat: string | undefined | null, level: number, achievementCodes: Iterable<string>): boolean {
  if (!hat || hat === 'none') return true // 'none' is always fine
  const item = cosmeticById(hat)
  if (!item) return false
  return unlockedHatIds(level, achievementCodes).has(item.id)
}

// ---------- Emote unlock catalog (§16 progression) ----------

export const EMOTE_CATALOG: CosmeticItem[] = [
  {
    id: 'wave',
    kind: 'emote',
    label: 'Wave',
    emoji: '👋',
    desc: 'Hello, democracy!',
    unlock: { type: 'free' },
  },
  {
    id: 'salute',
    kind: 'emote',
    label: 'Salute',
    emoji: '🫡',
    desc: 'Salute to the cause!',
    unlock: { type: 'free' },
  },
  {
    id: 'facepalm',
    kind: 'emote',
    label: 'Facepalm',
    emoji: '🤦',
    desc: 'Not this again…',
    unlock: { type: 'free' },
  },
  {
    id: 'cry',
    kind: 'emote',
    label: 'Cry',
    emoji: '😭',
    desc: 'The votes… they are gone…',
    unlock: { type: 'free' },
  },
  {
    id: 'dance',
    kind: 'emote',
    label: 'Dance',
    emoji: '💃',
    desc: 'Protest dance move!',
    unlock: { type: 'level', level: 2 },
  },
  {
    id: 'flex',
    kind: 'emote',
    label: 'Flex',
    emoji: '💪',
    desc: 'Strong together!',
    unlock: { type: 'level', level: 2 },
  },
  {
    id: 'chant',
    kind: 'emote',
    label: 'Chant',
    emoji: '📣',
    desc: 'AIYOO COMMITTEE! AIYOO AIYOO!',
    unlock: { type: 'level', level: 3 },
  },
  {
    id: 'chai',
    kind: 'emote',
    label: 'Chai Toast',
    emoji: '🍵',
    desc: 'Chai break! Sipped with suspicious confidence.',
    unlock: { type: 'achievement', code: 'chai_guardian' },
  },
]

export const EMOTE_IDS = new Set(EMOTE_CATALOG.map((e) => e.id))

/** Compute the set of emote ids a player may use. Pure — shared by game guard and UI. */
export function unlockedEmoteIds(level: number, achievementCodes: Iterable<string>): Set<string> {
  const codes = achievementCodes instanceof Set ? achievementCodes : new Set(achievementCodes)
  const out = new Set<string>()
  for (const item of EMOTE_CATALOG) {
    if (item.unlock.type === 'free') out.add(item.id)
    else if (item.unlock.type === 'level' && level >= item.unlock.level) out.add(item.id)
    else if (item.unlock.type === 'achievement' && codes.has(item.unlock.code)) out.add(item.id)
  }
  return out
}

/** True if `emote` may be used at `level` with `achievementCodes`. Unknown ids are rejected. */
export function emoteIsUnlocked(emote: string | undefined | null, level: number, achievementCodes: Iterable<string>): boolean {
  if (!emote) return false
  const item = EMOTE_CATALOG.find((e) => e.id === emote)
  if (!item) return false
  return unlockedEmoteIds(level, achievementCodes).has(item.id)
}

// ---------- Wardrobe expansion (round 18) ----------
// Six equip slots: hat + face + outfit + footwear + back gear + held item.
// All catalogs are pure data so the API route can validate unlocks server-side.

export type CosmeticKind = 'hat' | 'face' | 'outfit' | 'footwear' | 'gear' | 'held'

export const SKIN_TONES: { id: string; hex: string; label: string }[] = [
  { id: 'porcelain', hex: '#e8c39a', label: 'Paperwork Pale' },
  { id: 'wheat', hex: '#d09a68', label: 'Classic Wheat' },
  { id: 'golden', hex: '#c68a5c', label: 'Monsoon Gold' },
  { id: 'toffee', hex: '#b47a49', label: 'Chai Toffee' },
  { id: 'umber', hex: '#8d5a33', label: 'Deep Umber' },
  { id: 'midnight', hex: '#6b4226', label: 'Midnight Filter Coffee' },
]

export const FACE_CATALOG: CosmeticItem[] = [
  { id: 'clean', kind: 'face', label: 'Clean Shaven', emoji: '🧼', desc: 'Fresh as a paperwork morning.', unlock: { type: 'free' } },
  { id: 'beard', kind: 'face', label: 'Full Beard', emoji: '🧔', desc: 'Stores chai spills for later.', unlock: { type: 'free' } },
  { id: 'moustache', kind: 'face', label: 'Power Moustache', emoji: '👨', desc: '1987-approved facial authority.', unlock: { type: 'free' } },
  { id: 'warpaint', kind: 'face', label: 'Protest Warpaint', emoji: '🎨', desc: 'Three stripes of pure defiance.', unlock: { type: 'level', level: 4 } },
  { id: 'scar', kind: 'face', label: 'Barricade Scar', emoji: '⚡', desc: 'A souvenir from barricade #7.', unlock: { type: 'achievement', code: 'barrier_jumper' } },
]

export const OUTFIT_CATALOG: CosmeticItem[] = [
  { id: 'classic', kind: 'outfit', label: 'Classic Khaki', emoji: '👕', desc: 'The standard protest uniform.', unlock: { type: 'free' } },
  { id: 'kurta', kind: 'outfit', label: 'Protest Kurta', emoji: '🥻', desc: 'Traditional fit for toppling traditions.', unlock: { type: 'level', level: 2 } },
  { id: 'hoodie', kind: 'outfit', label: 'Revolution Hoodie', emoji: '🧥', desc: 'Hood up, committee down.', unlock: { type: 'level', level: 6 } },
  { id: 'highvis', kind: 'outfit', label: 'High-Vis Vest', emoji: '🦺', desc: 'Safety first. Chaos second.', unlock: { type: 'achievement', code: 'rescuer' } },
]

export const FOOTWEAR_CATALOG: CosmeticItem[] = [
  { id: 'shoes', kind: 'footwear', label: 'Protest Sneakers', emoji: '👟', desc: 'Broken in at exactly one rally.', unlock: { type: 'free' } },
  { id: 'boots', kind: 'footwear', label: 'Marching Boots', emoji: '🥾', desc: 'Stomp approved by three aunties.', unlock: { type: 'free' } },
  { id: 'chappal', kind: 'footwear', label: 'Trusted Chappal', emoji: '🩴', desc: 'Flies straighter than any placard.', unlock: { type: 'level', level: 2 } },
  { id: 'glow', kind: 'footwear', label: 'Neon Runners', emoji: '✨', desc: 'LED soles for midnight marches.', unlock: { type: 'level', level: 8 } },
]

export const GEAR_CATALOG: CosmeticItem[] = [
  { id: 'none', kind: 'gear', label: 'Empty Back', emoji: '🚫', desc: 'Travels light, protests heavy.', unlock: { type: 'free' } },
  { id: 'backpack', kind: 'gear', label: 'Protest Backpack', emoji: '🎒', desc: 'Chai flask + spare slogan included.', unlock: { type: 'free' } },
  { id: 'jhola', kind: 'gear', label: 'Jhola Side Bag', emoji: '👜', desc: 'Fits one (1) copy of the demands.', unlock: { type: 'free' } },
  { id: 'bannerroll', kind: 'gear', label: 'Banner Roll', emoji: '🧻', desc: 'A spare banner. Always be prepared.', unlock: { type: 'level', level: 3 } },
  { id: 'dhol', kind: 'gear', label: 'Dhol Drum', emoji: '🥁', desc: 'The beat of the barricade.', unlock: { type: 'achievement', code: 'chai_guardian' } },
  { id: 'umbrella', kind: 'gear', label: 'Strapped Umbrella', emoji: '☂️', desc: 'Monsoon-ready dissidence.', unlock: { type: 'level', level: 7 } },
]

export const HELD_CATALOG: CosmeticItem[] = [
  { id: 'none', kind: 'held', label: 'Empty Hands', emoji: '✋', desc: 'Clap for the cause instead.', unlock: { type: 'free' } },
  { id: 'sign', kind: 'held', label: 'Protest Sign', emoji: '🪧', desc: 'Shows your custom slogan.', unlock: { type: 'free' } },
  { id: 'banner', kind: 'held', label: 'Cloth Banner', emoji: '🎌', desc: 'Your slogan, but wider.', unlock: { type: 'free' } },
  { id: 'flag', kind: 'held', label: 'Party Flag', emoji: '🚩', desc: 'Waves on every stride.', unlock: { type: 'level', level: 2 } },
  { id: 'bat', kind: 'held', label: 'Baseball Bat', emoji: '🏏', desc: 'Purely ceremonial. Obviously.', unlock: { type: 'level', level: 4 } },
  { id: 'lathi', kind: 'held', label: 'Confiscated Lathi', emoji: '🪄', desc: 'The committee misses it already.', unlock: { type: 'level', level: 6 } },
  { id: 'shoppingbag', kind: 'held', label: 'Shopping Bag', emoji: '🛍️', desc: 'Went for groceries. Found a march.', unlock: { type: 'free' } },
  { id: 'megaphone', kind: 'held', label: 'Megaphone', emoji: '📢', desc: 'Slogans at 2× volume.', unlock: { type: 'achievement', code: 'rescuer' } },
]

const CATALOGS: Record<CosmeticKind, CosmeticItem[]> = {
  hat: HAT_CATALOG,
  face: FACE_CATALOG,
  outfit: OUTFIT_CATALOG,
  footwear: FOOTWEAR_CATALOG,
  gear: GEAR_CATALOG,
  held: HELD_CATALOG,
}

export function catalogByKind(kind: CosmeticKind): CosmeticItem[] {
  return CATALOGS[kind]
}

/** All Wardrobe slots in tab order (hat already existed — kept first for muscle memory). */
export const WARDROBE_KINDS: CosmeticKind[] = ['hat', 'face', 'outfit', 'footwear', 'gear', 'held']

/** Equippable check across every catalog. Unknown ids are rejected. 'none'/defaults always pass. */
const NONE_LIKE = new Set(['none', 'clean', 'classic', 'shoes'])
export function anyItemIsUnlocked(
  kind: CosmeticKind,
  id: string | undefined | null,
  level: number,
  achievementCodes: Iterable<string>,
): boolean {
  if (!id || NONE_LIKE.has(id)) return true
  const item = CATALOGS[kind].find((i) => i.id === id)
  if (!item) return false
  if (item.unlock.type === 'free') return true
  if (item.unlock.type === 'level') return level >= item.unlock.level
  return new Set(achievementCodes).has(item.unlock.code)
}

/**
 * Sanitize an untrusted cosmetics object (join payload / profile save):
 * keeps only known slot keys, caps string length, validates hex skin tone.
 * Returns null-ish fields dropped — safe to persist or broadcast.
 */
export function sanitizeCosmetics(raw: unknown): Record<string, string | boolean> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const src = raw as Record<string, unknown>
  const out: Record<string, string | boolean> = {}
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)
  const hat = str(src.hat, 24)
  if (hat && CATALOGS.hat.some((i) => i.id === hat)) out.hat = hat
  const face = str(src.face, 24)
  if (face && CATALOGS.face.some((i) => i.id === face)) out.face = face
  const outfit = str(src.outfit, 24)
  if (outfit && CATALOGS.outfit.some((i) => i.id === outfit)) out.outfit = outfit
  const footwear = str(src.footwear, 24)
  if (footwear && CATALOGS.footwear.some((i) => i.id === footwear)) out.footwear = footwear
  const gear = str(src.gear, 24)
  if (gear && CATALOGS.gear.some((i) => i.id === gear)) out.gear = gear
  const held = str(src.held, 24)
  if (held && CATALOGS.held.some((i) => i.id === held)) out.held = held
  if (typeof src.glasses === 'boolean') out.glasses = src.glasses
  const skin = str(src.skinTone, 9)
  if (skin && /^#[0-9a-fA-F]{6}$/.test(skin)) out.skinTone = skin
  const sign = str(src.signText, 24)
  if (sign) out.signText = sign
  return Object.keys(out).length ? out : undefined
}

/** Deterministic-ish random free-tier look for season bots — variety without unlock logic. */
export function randomFreeCosmetics(rand: () => number = Math.random): Record<string, string | boolean> {
  const pick = (arr: CosmeticItem[]) => {
    const free = arr.filter((i) => i.unlock.type === 'free')
    return free[Math.floor(rand() * free.length)]?.id
  }
  const out: Record<string, string | boolean> = {
    hat: pick(CATALOGS.hat),
    face: pick(CATALOGS.face),
    outfit: pick(CATALOGS.outfit),
    footwear: pick(CATALOGS.footwear),
    gear: pick(CATALOGS.gear),
    held: pick(CATALOGS.held),
  }
  if (rand() < 0.3) out.glasses = true
  if (rand() < 0.5) out.skinTone = SKIN_TONES[Math.floor(rand() * SKIN_TONES.length)].hex
  return out
}

/** Rig-facing cosmetics view — defaults resolved so the rig never sees undefined ids. */
export function resolveRigCosmetics(c: Record<string, unknown> | undefined | null): {
  hat: string; face: string; outfit: string; footwear: string; gear: string; held: string
  glasses: boolean; skinTone?: string; signText?: string
} {
  return {
    hat: typeof c?.hat === 'string' ? c.hat : 'none',
    face: typeof c?.face === 'string' ? c.face : 'clean',
    outfit: typeof c?.outfit === 'string' ? c.outfit : 'classic',
    footwear: typeof c?.footwear === 'string' ? c.footwear : 'shoes',
    gear: typeof c?.gear === 'string' ? c.gear : 'none',
    held: typeof c?.held === 'string' ? c.held : 'none',
    glasses: c?.glasses === true,
    skinTone: typeof c?.skinTone === 'string' ? c.skinTone : undefined,
    signText: typeof c?.signText === 'string' ? c.signText : undefined,
  }
}
