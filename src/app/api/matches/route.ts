import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ACHIEVEMENTS, VICTORY_TITLES, XP_TABLE, levelFromXp } from '@/game/shared/constants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------- helpers ----------
const sanitize = (v: unknown): string => String(v ?? '').replace(/[<>&]/g, '').trim()

function clampInt(v: unknown, min: number, max: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function clampFloat(v: unknown, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
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

// ---------- handler ----------
export async function POST(req: Request) {
  try {
    const token = sanitize(req.headers.get('x-vc-token') ?? '')
    if (!token) {
      return NextResponse.json({ error: 'Missing x-vc-token header' }, { status: 401 })
    }
    if (!allowRequest(`match:${token}`)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const player = await db.player.findUnique({ where: { token } })
    if (!player) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const body = await safeBody(req)

    const matchId = sanitize(body.matchId).slice(0, 64)
    if (!matchId) {
      return NextResponse.json({ error: 'matchId is required' }, { status: 400 })
    }

    // ---- duplicate prevention (idempotent per matchId) ----
    const existing = await db.matchResult.findUnique({ where: { id: matchId } })
    if (existing) {
      if (existing.playerId !== player.id) {
        return NextResponse.json({ error: 'matchId already used by another player' }, { status: 409 })
      }
      return NextResponse.json({
        duplicate: true,
        xpEarned: existing.xpEarned,
        level: player.level,
        leveledUp: false,
        newAchievements: [],
        profile: { id: player.id, name: player.name, xp: player.xp, level: player.level },
        funnyTitle: existing.funnyTitle,
      })
    }

    // ---- validate + clamp ----
    const victory = body.victory === true || body.victory === 'true'
    const multiplayer = body.multiplayer === true || body.multiplayer === 'true'
    const distance = clampFloat(body.distance, 0, 20000)
    const checkpoints = clampInt(body.checkpoints, 0, 4)
    const rescues = clampInt(body.rescues, 0, 50)
    const revives = clampInt(body.revives, 0, 50)
    const itemsCollected = clampInt(body.itemsCollected, 0, 200)
    const bossContribution = clampFloat(body.bossContribution, 0, 30)
    const detentions = clampInt(body.detentions, 0, 50)
    const tokens = clampInt(body.tokens, 0, 16)
    const position = clampInt(body.position, 0, 50)

    // ---- server-authoritative XP ----
    const xpEarned = Math.round(
      XP_TABLE.participation +
        distance * XP_TABLE.perMeter +
        checkpoints * XP_TABLE.perCheckpoint +
        tokens * XP_TABLE.perToken +
        rescues * XP_TABLE.perRescue +
        revives * XP_TABLE.perRevive +
        itemsCollected * XP_TABLE.perItem +
        bossContribution * XP_TABLE.bossHit +
        (victory ? XP_TABLE.victoryBonus : 0),
    )

    const funnyTitle = VICTORY_TITLES({
      detentions,
      rescues,
      revives,
      items: itemsCollected,
      distance,
      victory,
    })

    await ensureAchievementsSeeded()

    const outcome = await db.$transaction(async (tx) => {
      // 1. match result
      await tx.matchResult.create({
        data: {
          id: matchId,
          playerId: player.id,
          victory,
          position,
          distance,
          checkpoints,
          rescues,
          revives,
          itemsCollected,
          bossContribution,
          detentions,
          tokens,
          xpEarned,
          funnyTitle,
          multiplayer,
        },
      })

      // 2. stats upsert
      const prevStats = await tx.playerStats.findUnique({ where: { playerId: player.id } })
      const stats = prevStats
        ? await tx.playerStats.update({
            where: { playerId: player.id },
            data: {
              matchesPlayed: { increment: 1 },
              wins: { increment: victory ? 1 : 0 },
              totalDistance: { increment: distance },
              totalRescues: { increment: rescues },
              totalRevives: { increment: revives },
              totalItems: { increment: itemsCollected },
              detentions: { increment: detentions },
              bossKills: { increment: victory ? 1 : 0 },
              bestPosition:
                position > 0 && (prevStats.bestPosition === 0 || position < prevStats.bestPosition)
                  ? position
                  : prevStats.bestPosition,
              totalXp: { increment: xpEarned },
            },
          })
        : await tx.playerStats.create({
            data: {
              playerId: player.id,
              matchesPlayed: 1,
              wins: victory ? 1 : 0,
              totalDistance: distance,
              totalRescues: rescues,
              totalRevives: revives,
              totalItems: itemsCollected,
              detentions,
              bossKills: victory ? 1 : 0,
              bestPosition: position > 0 ? position : 0,
              totalXp: xpEarned,
            },
          })

      // lifetime tokens = sum over all of the player's match results (incl. this one)
      const tokenAgg = await tx.matchResult.aggregate({
        _sum: { tokens: true },
        where: { playerId: player.id },
      })
      const totalTokens = tokenAgg._sum.tokens ?? 0

      // 3. player xp + level
      const newXp = player.xp + xpEarned
      const newLevel = levelFromXp(newXp)
      const updatedPlayer = await tx.player.update({
        where: { id: player.id },
        data: { xp: newXp, level: newLevel },
      })

      // 4. achievement checks (idempotent via PlayerAchievement createMany skipDuplicates)
      const earned = new Set<string>()
      if (checkpoints >= 1) earned.add('first_steps')
      if (victory && detentions === 0) earned.add('untouchable')
      if (stats.totalDistance >= 3000) earned.add('marathoner')
      if (totalTokens >= 25) earned.add('token_collector')
      if (stats.totalRescues >= 3) earned.add('rescuer')
      if (stats.totalRevives >= 5) earned.add('medic')
      if (victory) earned.add('boss_slayer')
      if (victory && multiplayer) earned.add('democracy_defender')
      if (stats.detentions >= 10) earned.add('traffic_cone')

      let newAchievements: { id: string; name: string }[] = []
      if (earned.size > 0) {
        const codes = [...earned]
        const already = await tx.playerAchievement.findMany({
          where: { playerId: player.id, achievementId: { in: codes } },
          select: { achievementId: true },
        })
        const alreadySet = new Set(already.map((a) => a.achievementId))
        const fresh = codes.filter((c) => !alreadySet.has(c))
        if (fresh.length > 0) {
          for (const c of fresh) {
            await tx.playerAchievement.upsert({
              where: { playerId_achievementId: { playerId: player.id, achievementId: c } },
              create: { playerId: player.id, achievementId: c },
              update: {},
            })
          }
          const known = new Map(ACHIEVEMENTS.map((a) => [a.id, a]))
          newAchievements = fresh.map((c) => ({ id: c, name: known.get(c)?.name ?? c }))
        }
      }

      return { newXp, newLevel, updatedPlayer, newAchievements }
    })

    return NextResponse.json({
      xpEarned,
      level: outcome.newLevel,
      leveledUp: outcome.newLevel > player.level,
      newAchievements: outcome.newAchievements,
      profile: {
        id: outcome.updatedPlayer.id,
        name: outcome.updatedPlayer.name,
        xp: outcome.newXp,
        level: outcome.newLevel,
      },
      funnyTitle,
    })
  } catch (err) {
    console.error('[api/matches] error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
