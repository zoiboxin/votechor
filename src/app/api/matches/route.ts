import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ACHIEVEMENTS, VICTORY_TITLES, XP_TABLE, levelFromXp } from '@/game/shared/constants'
import { mapById, mapForLevel } from '@/game/shared/maps'
import { dailyForDate, todayKey, dailyContribution, type DailyDef } from '@/lib/daily'
import { weeklyForDate, weekKey } from '@/lib/weekly'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------- helpers ----------
const sanitize = (v: unknown): string => String(v ?? '').replace(/[<>&]/g, '').trim()

function yesterdayKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

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
        baseXp: existing.xpEarned,
        solidarityBonus: 0,
        squadSize: 1,
        level: player.level,
        leveledUp: false,
        newAchievements: [],
        streak: player.dailyStreak,
        streakUp: false,
        profile: { id: player.id, name: player.name, xp: player.xp, level: player.level },
        funnyTitle: existing.funnyTitle,
      })
    }

    // ---- validate + clamp ----
    const victory = body.victory === true || body.victory === 'true'
    const multiplayer = body.multiplayer === true || body.multiplayer === 'true'
    // v44 district replay — the client reports which map the solo match actually
    // played; the server only honors it when the player's OWN level has that
    // district unlocked (a forged/stale id silently falls back to level-earned).
    const claimedMap = typeof body.mapId === 'string' ? mapById(body.mapId) : null
    const playedMapId = !multiplayer && claimedMap && claimedMap.minLevel <= player.level ? claimedMap.id : null
    const distance = clampFloat(body.distance, 0, 20000)
    const checkpoints = clampInt(body.checkpoints, 0, 4)
    const rescues = clampInt(body.rescues, 0, 50)
    const revives = clampInt(body.revives, 0, 50)
    const itemsCollected = clampInt(body.itemsCollected, 0, 200)
    const bossContribution = clampFloat(body.bossContribution, 0, 30)
    const detentions = clampInt(body.detentions, 0, 50)
    const arrests = clampInt(body.arrests, 0, 200) // police role: suspects detained this match
    const tokens = clampInt(body.tokens, 0, 16)
    const gifts = clampInt(body.gifts, 0, 50)
    const position = clampInt(body.position, 0, 50)
    // protest-cell solidarity: marching with cellmates pays (§15 social perk)
    const squadSize = multiplayer ? clampInt(body.squadSize, 1, 4) : 1

    // current streak snapshot (returned for client refresh even when unchanged)
    let streakOut = player.dailyStreak

    // ---- server-authoritative XP ----
    const baseXp = Math.round(
      XP_TABLE.participation +
        distance * XP_TABLE.perMeter +
        checkpoints * XP_TABLE.perCheckpoint +
        tokens * XP_TABLE.perToken +
        rescues * XP_TABLE.perRescue +
        revives * XP_TABLE.perRevive +
        itemsCollected * XP_TABLE.perItem +
        gifts * XP_TABLE.perGift +
        bossContribution * XP_TABLE.bossHit +
        arrests * XP_TABLE.perArrest +
        (victory ? XP_TABLE.victoryBonus : 0),
    )
    // +10% of base XP per extra cellmate (max 3 → +30%), multiplayer only
    const solidarityBonus = multiplayer && squadSize > 1 ? Math.round(baseXp * 0.10 * (squadSize - 1)) : 0
    // v43 district stakes — solo matches play the campaign map earned by the
    // player's level; harder districts pay better. The multiplier comes from the
    // server-side maps registry keyed on the player's OWN level (never trusted
    // from the client); multiplayer rooms are the classic city (×1.0).
    // v44 — an unlocked replay selection (mapId) is honored for solo runs.
    const districtMap = multiplayer
      ? mapById('classic')
      : playedMapId ? mapById(playedMapId) : mapForLevel(player.level)
    const xpEarned = Math.round((baseXp + solidarityBonus) * districtMap.xpMul)

    const funnyTitle = VICTORY_TITLES({
      detentions,
      rescues,
      revives,
      items: itemsCollected,
      distance,
      victory,
      gifts,
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
          arrests,
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
              arrests: { increment: arrests },
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
              arrests,
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

      // 3. player xp + level + daily challenge progress
      const day = todayKey()
      let daily: DailyDef | null = null
      let dailyBonus = 0
      let dailyProgress = 0
      let dailyClaimed = false
      let dailyJustCompleted = false

      // Roll a fresh challenge if stale
      let activePlayer = player
      if (activePlayer.dailyDate !== day) {
        const def = dailyForDate(day)
        activePlayer = await tx.player.update({
          where: { id: player.id },
          data: { dailyDate: day, dailyKind: def.kind, dailyProgress: 0, dailyClaimed: false },
        })
      }

      if (activePlayer.dailyKind) {
        const def = dailyForDate(day)
        daily = def
        const contribution = activePlayer.dailyClaimed ? 0 : dailyContribution(def.kind, { distance, itemsCollected, tokens, checkpoints, rescues, victory })
        const rawProgress = (activePlayer.dailyProgress ?? 0) + contribution
        dailyProgress = Math.min(rawProgress, def.target)
        dailyClaimed = activePlayer.dailyClaimed
        if (!activePlayer.dailyClaimed && rawProgress >= def.target) {
          dailyJustCompleted = true
          dailyClaimed = true
          dailyBonus = def.reward
        }

        // ---- daily streak bookkeeping (§16 retention) ----
        let streakData: { dailyStreak?: number; lastDailyDone?: string } = {}
        if (dailyJustCompleted) {
          const streak = activePlayer.lastDailyDone === yesterdayKey(day) ? activePlayer.dailyStreak + 1 : 1
          streakData = { dailyStreak: streak, lastDailyDone: day }
          streakOut = streak
        }

        await tx.player.update({
          where: { id: player.id },
          data: { dailyProgress: rawProgress, dailyClaimed, dailyKind: def.kind, dailyDate: day, ...streakData },
        })
      }

      // ---- weekly challenge (same accumulation rules, ISO-week cadence) ----
      const week = weekKey()
      const wdef = weeklyForDate(week)
      let weeklyBonus = 0
      let weeklyProgress = 0
      let weeklyClaimed = false
      let weeklyJustCompleted = false

      let activePlayer2 = activePlayer
      if (activePlayer2.weeklyDate !== week) {
        activePlayer2 = await tx.player.update({
          where: { id: player.id },
          data: { weeklyDate: week, weeklyKind: wdef.kind, weeklyProgress: 0, weeklyClaimed: false },
        })
      }
      if (activePlayer2.weeklyKind !== wdef.kind) {
        activePlayer2 = await tx.player.update({
          where: { id: player.id },
          data: { weeklyKind: wdef.kind, weeklyProgress: 0, weeklyClaimed: false },
        })
      }
      {
        const contribution = activePlayer2.weeklyClaimed ? 0 : dailyContribution(wdef.kind, { distance, itemsCollected, tokens, checkpoints, rescues, victory })
        const rawProgress = (activePlayer2.weeklyProgress ?? 0) + contribution
        weeklyProgress = Math.min(rawProgress, wdef.target)
        weeklyClaimed = activePlayer2.weeklyClaimed
        if (!activePlayer2.weeklyClaimed && rawProgress >= wdef.target) {
          weeklyJustCompleted = true
          weeklyClaimed = true
          weeklyBonus = wdef.reward
        }
        await tx.player.update({
          where: { id: player.id },
          data: { weeklyProgress: rawProgress, weeklyClaimed, weeklyKind: wdef.kind, weeklyDate: week },
        })
      }

      const newXp = player.xp + xpEarned + dailyBonus + weeklyBonus
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
      if (gifts >= 3) earned.add('good_samaritan')

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

      return { newXp, newLevel, updatedPlayer, newAchievements, dailyBonus, daily, dailyProgress, dailyClaimed, dailyJustCompleted, weeklyBonus, weeklyProgress, weeklyClaimed, weeklyJustCompleted }
    })

    const wdef2 = weeklyForDate(weekKey())
    return NextResponse.json({
      xpEarned: xpEarned + outcome.dailyBonus + outcome.weeklyBonus,
      baseXp,
      solidarityBonus,
      squadSize,
      dailyBonus: outcome.dailyBonus,
      weeklyBonus: outcome.weeklyBonus,
      daily: outcome.daily ? { kind: outcome.daily.kind, desc: outcome.daily.desc, target: outcome.daily.target, reward: outcome.daily.reward, progress: outcome.dailyProgress, claimed: outcome.dailyClaimed, justCompleted: outcome.dailyJustCompleted } : null,
      weekly: { kind: wdef2.kind, desc: wdef2.desc, target: wdef2.target, reward: wdef2.reward, progress: outcome.weeklyProgress, claimed: outcome.weeklyClaimed, justCompleted: outcome.weeklyJustCompleted },
      level: outcome.newLevel,
      leveledUp: outcome.newLevel > player.level,
      newAchievements: outcome.newAchievements,
      streak: streakOut,
      streakUp: outcome.dailyJustCompleted,
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
