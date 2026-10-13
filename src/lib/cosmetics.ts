// VoteChor cosmetic unlock catalog — pure data + pure helpers, safe for
// both the Next.js API routes (server-authoritative validation) and the
// React UI (lock display). Never import three.js or DB code here.

export type CosmeticUnlock =
  | { type: 'free' }
  | { type: 'level'; level: number }
  | { type: 'achievement'; code: string }

export interface CosmeticItem {
  id: string
  kind: 'hat'
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
