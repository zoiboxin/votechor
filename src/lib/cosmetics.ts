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
  /** task 82: gender-exclusive styling — undefined = wearable by both. */
  gender?: 'male' | 'female'
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

export type CosmeticKind = 'hat' | 'hair' | 'face' | 'build' | 'outfit' | 'footwear' | 'gear' | 'held' | 'policeOutfit' | 'policeHat'

/** Body shape preset — drives the rig's torso/limb proportions (v32). */
export type BodyBuild = 'regular' | 'slim' | 'sturdy'

export const BUILD_CATALOG: CosmeticItem[] = [
  {
    id: 'regular',
    kind: 'build',
    label: 'Regular Build',
    emoji: '🧍',
    desc: 'The classic protester frame. Balanced and march-ready.',
    unlock: { type: 'free' },
  },
  {
    id: 'slim',
    kind: 'build',
    label: 'Slim Build',
    emoji: '🏃',
    desc: 'Light on the feet, hard for the committee to catch.',
    unlock: { type: 'free' },
  },
  {
    id: 'sturdy',
    kind: 'build',
    label: 'Sturdy Build',
    emoji: '🛡️',
    desc: 'Built for holding the front line all monsoon.',
    unlock: { type: 'free' },
  },
]

export const SKIN_TONES: { id: string; hex: string; label: string }[] = [
  { id: 'porcelain', hex: '#e8c39a', label: 'Paperwork Pale' },
  { id: 'wheat', hex: '#d09a68', label: 'Classic Wheat' },
  { id: 'golden', hex: '#c68a5c', label: 'Monsoon Gold' },
  { id: 'toffee', hex: '#b47a49', label: 'Chai Toffee' },
  { id: 'umber', hex: '#8d5a33', label: 'Deep Umber' },
  { id: 'midnight', hex: '#6b4226', label: 'Midnight Filter Coffee' },
]

// task 82: the two genders carry DISTINCT style books — switching gender swaps
// the whole catalog (hair / outfit / footwear), so each look reads unmistakably
// male or female at march distance.
export const HAIR_CATALOG: CosmeticItem[] = [
  // — male book —
  { id: 'default', kind: 'hair', label: 'Classic Cut', emoji: '💇', desc: 'The standard march haircut.', unlock: { type: 'free' }, gender: 'male' },
  { id: 'buzz', kind: 'hair', label: 'Buzz Cut', emoji: '✂️', desc: 'Low maintenance, high defiance.', unlock: { type: 'free' }, gender: 'male' },
  { id: 'spiky', kind: 'hair', label: 'Street Spikes', emoji: '⚡', desc: 'Gel budget: exceeded. Purpose: clear.', unlock: { type: 'free' }, gender: 'male' },
  { id: 'bald', kind: 'hair', label: 'Bald & Bold', emoji: '🥚', desc: 'Aerodynamic. Committee-proof.', unlock: { type: 'free' }, gender: 'male' },
  { id: 'afro', kind: 'hair', label: 'Protest Afro', emoji: '🌟', desc: 'Maximum volume for maximum noise.', unlock: { type: 'level', level: 2 }, gender: 'male' },
  { id: 'mullet', kind: 'hair', label: 'Party Mullet', emoji: '🦉', desc: 'Business up front, barricade behind.', unlock: { type: 'level', level: 3 }, gender: 'male' },
  // — female book —
  { id: 'ponytail', kind: 'hair', label: 'Ponytail', emoji: '🐎', desc: 'Swings with every chant.', unlock: { type: 'free' }, gender: 'female' },
  { id: 'bun', kind: 'hair', label: 'Top Bun', emoji: '🧑‍🦱', desc: 'Keeps hair out of the slogan painting.', unlock: { type: 'free' }, gender: 'female' },
  { id: 'bob', kind: 'hair', label: 'March Bob', emoji: '💬', desc: 'Chin-length and uncompromising.', unlock: { type: 'free' }, gender: 'female' },
  { id: 'curly', kind: 'hair', label: 'Curly Locks', emoji: '🌀', desc: 'Bounce that out-chants the drums.', unlock: { type: 'level', level: 2 }, gender: 'female' },
  { id: 'long', kind: 'hair', label: 'Flowing Long', emoji: '👩', desc: 'Wind-machine ready at all times.', unlock: { type: 'level', level: 3 }, gender: 'female' },
  { id: 'braid', kind: 'hair', label: 'Side Braid', emoji: '🌾', desc: 'Woven with protest songs.', unlock: { type: 'level', level: 4 }, gender: 'female' },
]

export const FACE_CATALOG: CosmeticItem[] = [
  { id: 'clean', kind: 'face', label: 'Clean Shaven', emoji: '🧼', desc: 'Fresh as a paperwork morning.', unlock: { type: 'free' } },
  { id: 'beard', kind: 'face', label: 'Full Beard', emoji: '🧔', desc: 'Stores chai spills for later.', unlock: { type: 'free' } },
  { id: 'moustache', kind: 'face', label: 'Power Moustache', emoji: '👨', desc: '1987-approved facial authority.', unlock: { type: 'free' } },
  { id: 'warpaint', kind: 'face', label: 'Protest Warpaint', emoji: '🎨', desc: 'Three stripes of pure defiance.', unlock: { type: 'level', level: 4 } },
  { id: 'scar', kind: 'face', label: 'Barricade Scar', emoji: '⚡', desc: 'A souvenir from barricade #7.', unlock: { type: 'achievement', code: 'barrier_jumper' } },
]

export const OUTFIT_CATALOG: CosmeticItem[] = [
  // shared staples
  { id: 'classic', kind: 'outfit', label: 'Classic Khaki', emoji: '👕', desc: 'The standard protest uniform.', unlock: { type: 'free' } },
  { id: 'kurta', kind: 'outfit', label: 'Protest Kurta', emoji: '🥻', desc: 'Traditional fit for toppling traditions.', unlock: { type: 'level', level: 2 } },
  { id: 'highvis', kind: 'outfit', label: 'High-Vis Vest', emoji: '🦺', desc: 'Safety first. Chaos second.', unlock: { type: 'achievement', code: 'rescuer' } },
  // male-exclusive
  { id: 'hoodie', kind: 'outfit', label: 'Revolution Hoodie', emoji: '🧥', desc: 'Hood up, committee down.', unlock: { type: 'level', level: 6 }, gender: 'male' },
  { id: 'jacket', kind: 'outfit', label: 'Denim Jacket', emoji: '🧢', desc: 'Collar up. Zip stuck at 70% on principle.', unlock: { type: 'level', level: 3 }, gender: 'male' },
  // female-exclusive
  { id: 'dress', kind: 'outfit', label: 'March Dress', emoji: '👗', desc: 'A-line liberty with an accent belt.', unlock: { type: 'free' }, gender: 'female' },
  { id: 'anarkali', kind: 'outfit', label: 'Anarkali Flair', emoji: '🌅', desc: 'Full-skirted grace for long marches.', unlock: { type: 'level', level: 6 }, gender: 'female' },
]

export const FOOTWEAR_CATALOG: CosmeticItem[] = [
  { id: 'shoes', kind: 'footwear', label: 'Protest Sneakers', emoji: '👟', desc: 'Broken in at exactly one rally.', unlock: { type: 'free' } },
  { id: 'chappal', kind: 'footwear', label: 'Trusted Chappal', emoji: '🩴', desc: 'Flies straighter than any placard.', unlock: { type: 'level', level: 2 } },
  { id: 'glow', kind: 'footwear', label: 'Neon Runners', emoji: '✨', desc: 'LED soles for midnight marches.', unlock: { type: 'level', level: 8 } },
  // male-exclusive
  { id: 'boots', kind: 'footwear', label: 'Marching Boots', emoji: '🥾', desc: 'Stomp approved by three aunties.', unlock: { type: 'free' }, gender: 'male' },
  // female-exclusive
  { id: 'heels', kind: 'footwear', label: 'March Heels', emoji: '👠', desc: 'Clicks louder than the lathi charge.', unlock: { type: 'free' }, gender: 'female' },
]

/** Catalog for one wardrobe slot filtered to a gender (task 82) — items without
 *  a gender tag are unisex and always included. */
export function itemsForKind(kind: CosmeticKind, gender: 'male' | 'female'): CosmeticItem[] {
  return CATALOGS[kind].filter((i) => !i.gender || i.gender === gender)
}

/** True if `id` exists in the gender-filtered catalog for `kind`. */
export function itemFitsGender(kind: CosmeticKind, id: string, gender: 'male' | 'female'): boolean {
  return itemsForKind(kind, gender).some((i) => i.id === id)
}

/** Gender-aware fallback for a slot — used when a saved pick belongs to the
 *  other gender's book (e.g. boots on a female rig after a gender swap). */
export function genderDefaultFor(kind: 'hair' | 'outfit' | 'footwear', gender: 'male' | 'female'): string {
  if (kind === 'hair') return gender === 'female' ? 'ponytail' : 'default'
  if (kind === 'outfit') return 'classic'
  return 'shoes'
}

export const GEAR_CATALOG: CosmeticItem[] = [
  { id: 'none', kind: 'gear', label: 'Empty Back', emoji: '🚫', desc: 'Travels light, protests heavy.', unlock: { type: 'free' } },
  { id: 'backpack', kind: 'gear', label: 'Protest Backpack', emoji: '🎒', desc: 'Chai flask + spare slogan included.', unlock: { type: 'free' } },
  { id: 'jhola', kind: 'gear', label: 'Jhola Side Bag', emoji: '👜', desc: 'Fits one (1) copy of the demands.', unlock: { type: 'free' } },
  { id: 'bannerroll', kind: 'gear', label: 'Banner Roll', emoji: '🧻', desc: 'A spare banner. Always be prepared.', unlock: { type: 'level', level: 3 } },
  { id: 'dhol', kind: 'gear', label: 'Dhol Drum', emoji: '🥁', desc: 'The beat of the barricade.', unlock: { type: 'achievement', code: 'chai_guardian' } },
  { id: 'umbrella', kind: 'gear', label: 'Strapped Umbrella', emoji: '☂️', desc: 'Monsoon-ready dissidence.', unlock: { type: 'level', level: 7 } },
]

// ---------- Police Department wardrobe (round 23) — only rendered when role = police ----------

export interface PoliceUniformDef {
  id: string
  label: string
  desc: string
  emoji: string
  /** rig colors */
  shirt: string
  pants: string
  accent: string
  /** default peaked-cap dome color (beret/turban derive from it too) */
  capColor: string
  unlock: CosmeticUnlock
}

export const POLICE_UNIFORMS: Record<string, PoliceUniformDef> = {
  khaki: {
    id: 'khaki', label: 'Street Khaki', emoji: '🛵', desc: 'Standard-issue duty khaki. The city knows it on sight.',
    shirt: '#8a6f4e', pants: '#5c4a34', accent: '#2c3947', capColor: '#1f3a2e', unlock: { type: 'free' },
  },
  traffic: {
    id: 'traffic', label: 'Traffic Wing White', emoji: '🚦', desc: 'Crisp whites for the city’s hardest intersection.',
    shirt: '#e8e4d8', pants: '#5c4a34', accent: '#8c1f28', capColor: '#e8e4d8', unlock: { type: 'free' },
  },
  navy: {
    id: 'navy', label: 'Navy Dress Uniform', emoji: '🎖️', desc: 'Parade-grade navy with a gold-trimmed belt.',
    shirt: '#22314a', pants: '#18233a', accent: '#d4a017', capColor: '#18233a', unlock: { type: 'level', level: 3 },
  },
  plain: {
    id: 'plain', label: 'Plainclothes Detective', emoji: '🕵️', desc: 'Charcoal suit, quiet lathi. Nobody suspects the chai drinker.',
    shirt: '#3a3f46', pants: '#26292f', accent: '#8c1f28', capColor: '#26292f', unlock: { type: 'level', level: 4 },
  },
  commandant: {
    id: 'commandant', label: 'Officer Commandant', emoji: '🏅', desc: 'Khaki plus sash & medal bars. Salutes not included.',
    shirt: '#7a5f40', pants: '#4f3f2c', accent: '#8c1f28', capColor: '#2c2418', unlock: { type: 'level', level: 7 },
  },
  swat: {
    id: 'swat', label: 'Riot Squad Black', emoji: '🛡️', desc: 'Full black kit with heavy vest. Barricade day uniform.',
    shirt: '#23252a', pants: '#1a1c20', accent: '#f2c14e', capColor: '#16171b', unlock: { type: 'level', level: 5 },
  },
}

export const POLICE_OUTFIT_CATALOG: CosmeticItem[] = Object.values(POLICE_UNIFORMS).map((u) => ({
  id: u.id, kind: 'policeOutfit' as const, label: u.label, emoji: u.emoji, desc: u.desc, unlock: u.unlock,
}))

export const POLICE_HAT_CATALOG: CosmeticItem[] = [
  { id: 'peak', kind: 'policeHat', label: 'Peaked Cap', emoji: '🧢', desc: 'Regulation peaked cap with badge.', unlock: { type: 'free' } },
  { id: 'beret', kind: 'policeHat', label: 'Officer Beret', emoji: '🪖', desc: 'Tilted with quiet confidence.', unlock: { type: 'free' } },
  { id: 'turban', kind: 'policeHat', label: 'Police Turban', emoji: '🧑‍🦰', desc: 'Regulation dastaar with badge pin.', unlock: { type: 'free' } },
  { id: 'none', kind: 'policeHat', label: 'Bare Head', emoji: '🚫', desc: 'Off-duty look. Hair still on duty.', unlock: { type: 'free' } },
  { id: 'helmet', kind: 'policeHat', label: 'Riot Helmet', emoji: '⛑️', desc: 'Pairs beautifully with Riot Squad Black.', unlock: { type: 'level', level: 5 } },
]

/** Resolve the uniform palette for a police-role rig (defaults to Street Khaki). */
export function policeUniformColors(id?: string | null): PoliceUniformDef {
  return (id && POLICE_UNIFORMS[id]) || POLICE_UNIFORMS.khaki
}

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
  hair: HAIR_CATALOG,
  face: FACE_CATALOG,
  build: BUILD_CATALOG,
  outfit: OUTFIT_CATALOG,
  footwear: FOOTWEAR_CATALOG,
  gear: GEAR_CATALOG,
  held: HELD_CATALOG,
  policeOutfit: POLICE_OUTFIT_CATALOG,
  policeHat: POLICE_HAT_CATALOG,
}

export function catalogByKind(kind: CosmeticKind): CosmeticItem[] {
  return CATALOGS[kind]
}

/** All Wardrobe slots in tab order (hat already existed — kept first for muscle memory). */
export const WARDROBE_KINDS: CosmeticKind[] = ['hat', 'hair', 'face', 'build', 'outfit', 'footwear', 'gear', 'held', 'policeOutfit', 'policeHat']

/** Equippable check across every catalog. Unknown ids are rejected. 'none'/defaults always pass. */
const NONE_LIKE = new Set(['none', 'clean', 'classic', 'shoes', 'default', 'khaki', 'peak', 'regular'])
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
  const hair = str(src.hair, 24)
  if (hair && CATALOGS.hair.some((i) => i.id === hair)) out.hair = hair
  const gender = str(src.gender, 8)
  if (gender === 'male' || gender === 'female') out.gender = gender
  const policeOutfit = str(src.policeOutfit, 24)
  if (policeOutfit && CATALOGS.policeOutfit.some((i) => i.id === policeOutfit)) out.policeOutfit = policeOutfit
  const policeHat = str(src.policeHat, 24)
  if (policeHat && CATALOGS.policeHat.some((i) => i.id === policeHat)) out.policeHat = policeHat
  const face = str(src.face, 24)
  if (face && CATALOGS.face.some((i) => i.id === face)) out.face = face
  const build = str(src.build, 12)
  if (build && CATALOGS.build.some((i) => i.id === build)) out.build = build
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

/** Deterministic-ish random free-tier look for season bots — variety without unlock logic.
 *  task 82: hair/outfit/footwear draw from the GENDER's own book so bot crowds
 *  read male/female at a glance. */
export function randomFreeCosmetics(rand: () => number = Math.random): Record<string, string | boolean> {
  const pick = (arr: CosmeticItem[]) => {
    const free = arr.filter((i) => i.unlock.type === 'free')
    return free[Math.floor(rand() * free.length)]?.id
  }
  const female = rand() < 0.5
  const gender: 'male' | 'female' = female ? 'female' : 'male'
  const hairRoll = rand()
  const out: Record<string, string | boolean> = {
    hat: pick(CATALOGS.hat),
    hair: female
      ? (hairRoll < 0.5 ? 'ponytail' : hairRoll < 0.8 ? 'bun' : pick(itemsForKind('hair', gender)))
      : pick(itemsForKind('hair', gender)),
    gender,
    face: pick(CATALOGS.face),
    build: pick(CATALOGS.build),
    outfit: pick(itemsForKind('outfit', gender)),
    footwear: pick(itemsForKind('footwear', gender)),
    gear: pick(CATALOGS.gear),
    held: pick(CATALOGS.held),
  }
  if (rand() < 0.3) out.glasses = true
  if (rand() < 0.5) out.skinTone = SKIN_TONES[Math.floor(rand() * SKIN_TONES.length)].hex
  return out
}

/** Rig-facing cosmetics view — defaults resolved so the rig never sees undefined ids.
 *  Hair default is gender-aware: female rigs get the ponytail, male rigs the classic cut. */
export function resolveRigCosmetics(c: Record<string, unknown> | undefined | null): {
  hat: string; hair: string; gender: 'male' | 'female'; face: string; build: BodyBuild; outfit: string; footwear: string; gear: string; held: string
  policeOutfit: string; policeHat: string
  glasses: boolean; skinTone?: string; signText?: string
} {
  const gender = c?.gender === 'female' ? 'female' as const : 'male' as const
  const rawBuild = typeof c?.build === 'string' ? c.build : 'regular'
  const build: BodyBuild = rawBuild === 'slim' || rawBuild === 'sturdy' ? rawBuild : 'regular'
  return {
    hat: typeof c?.hat === 'string' ? c.hat : 'none',
    hair: typeof c?.hair === 'string' ? c.hair : (gender === 'female' ? 'ponytail' : 'default'),
    gender,
    face: typeof c?.face === 'string' ? c.face : 'clean',
    build,
    outfit: typeof c?.outfit === 'string' ? c.outfit : 'classic',
    footwear: typeof c?.footwear === 'string' ? c.footwear : 'shoes',
    gear: typeof c?.gear === 'string' ? c.gear : 'none',
    held: typeof c?.held === 'string' ? c.held : 'none',
    policeOutfit: typeof c?.policeOutfit === 'string' ? c.policeOutfit : 'khaki',
    policeHat: typeof c?.policeHat === 'string' ? c.policeHat : 'peak',
    glasses: c?.glasses === true,
    skinTone: typeof c?.skinTone === 'string' ? c.skinTone : undefined,
    signText: typeof c?.signText === 'string' ? c.signText : undefined,
  }
}
