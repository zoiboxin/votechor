import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Entry {
  name: string
  level: number
  xp: number
  value: number
  archetype: string
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const sortParam = (url.searchParams.get('sort') ?? 'xp').toLowerCase()
    const sort = sortParam === 'distance' || sortParam === 'wins' ? sortParam : 'xp'
    const limitRaw = Math.round(Number(url.searchParams.get('limit') ?? 20))
    const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20))

    let entries: Entry[] = []

    if (sort === 'xp') {
      const rows = await db.player.findMany({
        orderBy: { xp: 'desc' },
        take: limit,
        select: { name: true, xp: true, level: true, archetype: true },
      })
      entries = rows.map((p) => ({ name: p.name, level: p.level, xp: p.xp, value: p.xp, archetype: p.archetype }))
    } else {
      const rows = await db.playerStats.findMany({
        orderBy: sort === 'distance' ? { totalDistance: 'desc' } : { wins: 'desc' },
        take: limit,
        include: { player: { select: { name: true, xp: true, level: true, archetype: true } } },
      })
      entries = rows.map((s) => ({
        name: s.player.name,
        level: s.player.level,
        xp: s.player.xp,
        value: sort === 'distance' ? s.totalDistance : s.wins,
        archetype: s.player.archetype,
      }))
    }

    return NextResponse.json({ entries })
  } catch (err) {
    console.error('[api/leaderboard] error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
