// VoteChor weekly challenge logic — deterministic per-ISO-week roll, shared by API routes.
import { dailyContribution } from './daily'

export interface WeeklyDef {
  kind: 'distance' | 'items' | 'tokens' | 'checkpoints' | 'rescues' | 'boss'
  target: number
  reward: number
  desc: string
  icon: string
}

export const WEEKLY_POOL: WeeklyDef[] = [
  { kind: 'distance', target: 6000, reward: 650, desc: 'March 6,000 m across the city this week', icon: 'route' },
  { kind: 'items', target: 60, reward: 600, desc: 'Loot 60 items from the streets this week', icon: 'package' },
  { kind: 'tokens', target: 28, reward: 850, desc: 'Recover 28 stolen vote tokens this week', icon: 'vote' },
  { kind: 'checkpoints', target: 12, reward: 700, desc: 'Unlock 12 checkpoints this week', icon: 'flag' },
  { kind: 'rescues', target: 8, reward: 800, desc: 'Rescue 8 detained teammates this week', icon: 'key-round' },
  { kind: 'boss', target: 3, reward: 950, desc: 'Defeat The Great Vote Collector 3 times', icon: 'crown' },
]

/** ISO-8601 week key for a date, e.g. "2026-W42". Weeks start Monday. */
export function weekKey(d = new Date()): string {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = dt.getUTCDay() || 7 // 1..7, Monday=1
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum) // nearest Thursday
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** Deterministic weekly challenge for a given week key (same for all players). */
export function weeklyForDate(week: string): WeeklyDef {
  let h = 5381
  for (let i = 0; i < week.length; i++) h = ((h * 33) + week.charCodeAt(i)) >>> 0
  return WEEKLY_POOL[h % WEEKLY_POOL.length]
}

/** How much a finished match contributes to a weekly challenge kind. */
export const weeklyContribution = dailyContribution
