// VoteChor cosmetic unlock catalog — pure data + pure helpers, safe for
// both the Next.js API routes (server-authoritative validation) and the
// React UI (lock display). Never import three.js or DB code here.

export type CosmeticUnlock =
  | { type: 'free' }
  | { type: 'level'; level: number }
  | { type: 'achievement'; code: string }

export interface CosmeticItem {
  id: string
  kind: 'hat' | 'emote'
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
