import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const sanitize = (v: unknown): string => String(v ?? '').replace(/[<>&]/g, '').trim()

export async function GET(req: Request) {
  try {
    const token = sanitize(req.headers.get('x-vc-token') ?? '')
    if (!token) {
      return NextResponse.json({ error: 'Missing x-vc-token header' }, { status: 401 })
    }

    const player = await db.player.findUnique({ where: { token }, select: { id: true } })
    if (!player) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const row = await db.playerStats.upsert({
      where: { playerId: player.id },
      create: { playerId: player.id },
      update: {},
    })
    const recent = await db.matchResult.findMany({
      where: { playerId: player.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    // Lifetime aggregates for stats that live only in MatchResult rows
    const agg = await db.matchResult.aggregate({
      _sum: { tokens: true, checkpoints: true, bossContribution: true },
      where: { playerId: player.id },
    })

    // Normalized keys (UI contract) + legacy raw keys for compatibility
    const stats = {
      matches: row.matchesPlayed,
      matchesPlayed: row.matchesPlayed,
      wins: row.wins,
      tokens: agg._sum.tokens ?? 0,
      distance: row.totalDistance,
      checkpoints: agg._sum.checkpoints ?? 0,
      rescues: row.totalRescues,
      revives: row.totalRevives,
      itemsCollected: row.totalItems,
      bossHits: Math.round(agg._sum.bossContribution ?? 0),
      detentions: row.detentions,
      arrests: row.arrests,
      bossKills: row.bossKills,
      bestPosition: row.bestPosition,
      totalXp: row.totalXp,
      kudosReceived: row.kudosReceived,
      mvpWins: row.mvpWins,
      xp: row.totalXp,
    }

    return NextResponse.json({ stats, recent })
  } catch (err) {
    console.error('[api/stats] error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
