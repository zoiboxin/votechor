import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ACHIEVEMENTS, ARCHETYPES } from '@/game/shared/constants'
import { COSMETIC_IDS, hatIsUnlocked, unlockedHatIds, cosmeticById, unlockLabel } from '@/lib/cosmetics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------- helpers ----------
const sanitize = (v: unknown): string => String(v ?? '').replace(/[<>&]/g, '').trim()

function clampInt(v: unknown, min: number, max: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/** Deep-sanitize an arbitrary JSON value: strips <>& from strings, caps size/depth. */
function sanitizeDeep(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return sanitize(v).slice(0, 120)
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean' || v === null) return v
  if (depth >= 3) return null
  if (Array.isArray(v)) return v.slice(0, 24).map((x) => sanitizeDeep(x, depth + 1))
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 32)) {
      out[sanitize(k).slice(0, 40) || 'key'] = sanitizeDeep(val, depth + 1)
    }
    return out
  }
  return null
}

async function safeBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = (await req.json()) as unknown
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// ---------- in-memory rate limiting (30 POSTs/min per token) ----------
const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60_000
const buckets = new Map<string, number[]>()

function allowRequest(key: string): boolean {
  const now = Date.now()
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (arr.length >= RATE_LIMIT) {
    buckets.set(key, arr)
    return false
  }
  arr.push(now)
  buckets.set(key, arr)
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= RATE_WINDOW_MS)) buckets.delete(k)
  }
  return true
}

// ---------- achievements seeding ----------
// NOTE: SQLite createMany does not support skipDuplicates → upsert per row (idempotent).
async function ensureAchievementsSeeded(): Promise<void> {
  const count = await db.achievement.count()
  if (count >= ACHIEVEMENTS.length) return
  for (const a of ACHIEVEMENTS) {
    await db.achievement.upsert({
      where: { id: a.id },
      create: { id: a.id, name: a.name, description: a.description, icon: a.icon, xpReward: a.xpReward },
      update: { name: a.name, description: a.description, icon: a.icon, xpReward: a.xpReward },
    })
  }
}

const ARCHETYPE_IDS = new Set(ARCHETYPES.map((a) => a.id))

function profileView(p: { id: string; name: string; archetype: string; xp: number; level: number; cosmetics: string }, unlockedHats?: string[]) {
  let cosmetics: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(p.cosmetics)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cosmetics = parsed as Record<string, unknown>
  } catch {
    cosmetics = {}
  }
  return { id: p.id, name: p.name, archetype: p.archetype, xp: p.xp, level: p.level, cosmetics, ...(unlockedHats ? { unlockedHats } : {}) }
}

/** Load the player's unlocked hat ids (server-authoritative, from level + granted achievements). */
async function computeUnlockedHats(playerId: string, level: number): Promise<string[]> {
  const granted = await db.playerAchievement.findMany({ where: { playerId }, select: { achievementId: true } })
  return Array.from(unlockedHatIds(level, granted.map((g) => g.achievementId)))
}

/** Validate a requested cosmetics payload against the player's unlocks. Returns an error string or null. */
function validateCosmeticUnlocks(
  cosmetics: Record<string, unknown>,
  level: number,
  achievementCodes: Iterable<string>,
): string | null {
  const hat = typeof cosmetics.hat === 'string' ? cosmetics.hat : undefined
  if (hat !== undefined && !COSMETIC_IDS.has(hat)) {
    return 'Unknown cosmetic'
  }
  if (hat !== undefined && !hatIsUnlocked(hat, level, achievementCodes)) {
    const item = cosmeticById(hat)
    return item ? `Locked — ${unlockLabel(item)}` : 'Unknown cosmetic'
  }
  return null
}

// ---------- handler ----------
export async function POST(req: Request) {
  try {
    const body = await safeBody(req)
    const token = sanitize(req.headers.get('x-vc-token') ?? '')
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon'
    if (!allowRequest(token || ip)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    // ---- validate optional fields ----
    let name: string | undefined
    if (body.name !== undefined && body.name !== null) {
      name = sanitize(body.name)
      if (name.length < 2 || name.length > 24) {
        return NextResponse.json({ error: 'Name must be 2-24 characters' }, { status: 400 })
      }
    }

    let archetype: string | undefined
    if (body.archetype !== undefined && body.archetype !== null) {
      archetype = sanitize(body.archetype)
      if (!ARCHETYPE_IDS.has(archetype)) {
        return NextResponse.json({ error: 'Unknown archetype' }, { status: 400 })
      }
    }

    let cosmeticsObj: Record<string, unknown> | undefined
    let cosmeticsJson: string | undefined
    if (body.cosmetics !== undefined && body.cosmetics !== null) {
      if (typeof body.cosmetics !== 'object' || Array.isArray(body.cosmetics)) {
        return NextResponse.json({ error: 'Cosmetics must be an object' }, { status: 400 })
      }
      try {
        cosmeticsObj = sanitizeDeep(body.cosmetics) as Record<string, unknown>
        cosmeticsJson = JSON.stringify(cosmeticsObj)
      } catch {
        return NextResponse.json({ error: 'Cosmetics not serializable' }, { status: 400 })
      }
      if (cosmeticsJson.length > 2000) {
        return NextResponse.json({ error: 'Cosmetics too large' }, { status: 400 })
      }
    }

    // ---- update existing player by token ----
    if (token) {
      const existing = await db.player.findUnique({ where: { token } })
      if (existing) {
        // server-authoritative cosmetic unlock validation
        if (cosmeticsObj) {
          const granted = await db.playerAchievement.findMany({
            where: { playerId: existing.id },
            select: { achievementId: true },
          })
          const err = validateCosmeticUnlocks(cosmeticsObj, existing.level, granted.map((g) => g.achievementId))
          if (err) return NextResponse.json({ error: err }, { status: 403 })
        }
        const updated = await db.player.update({
          where: { id: existing.id },
          data: {
            ...(name !== undefined ? { name } : {}),
            ...(archetype !== undefined ? { archetype } : {}),
            ...(cosmeticsJson !== undefined ? { cosmetics: cosmeticsJson } : {}),
          },
        })
        await db.playerStats.upsert({ where: { playerId: updated.id }, create: { playerId: updated.id }, update: {} })
        await ensureAchievementsSeeded()
        const unlockedHats = await computeUnlockedHats(updated.id, updated.level)
        return NextResponse.json({ profile: profileView(updated, unlockedHats), token })
      }
    }

    // ---- create new player with generated token ----
    const newToken = crypto.randomUUID()
    const finalName = name ?? `Protester_${clampInt(Math.floor(1000 + Math.random() * 9000), 1000, 9999)}`
    const created = await db.player.create({
      data: {
        token: newToken,
        name: finalName,
        ...(archetype !== undefined ? { archetype } : {}),
        ...(cosmeticsJson !== undefined ? { cosmetics: cosmeticsJson } : {}),
      },
    })
    await db.playerStats.upsert({ where: { playerId: created.id }, create: { playerId: created.id }, update: {} })
    await ensureAchievementsSeeded()
    const unlockedHats = await computeUnlockedHats(created.id, created.level)
    return NextResponse.json({ profile: profileView(created, unlockedHats), token: newToken })
  } catch (err) {
    console.error('[api/profile] error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
