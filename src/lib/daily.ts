// VoteChor daily challenge logic — deterministic per-day roll, shared by API routes.
export interface DailyDef {
  kind: 'distance' | 'items' | 'tokens' | 'checkpoints' | 'rescues' | 'boss'
  target: number
  reward: number
  desc: string
  icon: string
}

export const DAILY_POOL: DailyDef[] = [
  { kind: 'distance', target: 1200, reward: 150, desc: 'March 1,200 m across the city', icon: 'route' },
  { kind: 'items', target: 12, reward: 150, desc: 'Collect 12 items from the streets', icon: 'package' },
  { kind: 'tokens', target: 6, reward: 220, desc: 'Recover 6 stolen vote tokens', icon: 'vote' },
  { kind: 'checkpoints', target: 3, reward: 160, desc: 'Unlock 3 checkpoints', icon: 'flag' },
  { kind: 'rescues', target: 2, reward: 200, desc: 'Rescue 2 detained teammates', icon: 'key-round' },
  { kind: 'boss', target: 1, reward: 260, desc: 'Defeat The Great Vote Collector', icon: 'crown' },
]

/** Deterministic daily challenge for a given date (same for all players). */
export function dailyForDate(day: string): DailyDef {
  let h = 0
  for (let i = 0; i < day.length; i++) h = (h * 31 + day.charCodeAt(i)) >>> 0
  return DAILY_POOL[h % DAILY_POOL.length]
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

/** How much a finished match contributes to a challenge kind. */
export function dailyContribution(kind: string, stats: {
  distance: number; itemsCollected: number; tokens: number; checkpoints: number; rescues: number; victory: boolean
}): number {
  switch (kind) {
    case 'distance': return Math.max(0, stats.distance)
    case 'items': return Math.max(0, stats.itemsCollected)
    case 'tokens': return Math.max(0, stats.tokens)
    case 'checkpoints': return Math.max(0, stats.checkpoints)
    case 'rescues': return Math.max(0, stats.rescues)
    case 'boss': return stats.victory ? 1 : 0
    default: return 0
  }
}
