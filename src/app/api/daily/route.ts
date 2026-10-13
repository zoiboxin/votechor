import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dailyForDate, todayKey } from '@/lib/daily'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/daily — current daily challenge + this player's progress (x-vc-token optional). */
export async function GET(req: NextRequest) {
  try {
    const day = todayKey()
    const def = dailyForDate(day)
    const token = req.headers.get('x-vc-token')

    // Keep the DailyChallenge catalog row in sync (observability / future tooling)
    await db.dailyChallenge.upsert({
      where: { id: `daily_${day}` },
      create: { id: `daily_${day}`, day, kind: def.kind, target: def.target, reward: def.reward, desc: def.desc },
      update: { kind: def.kind, target: def.target, reward: def.reward, desc: def.desc },
    })

    if (!token) {
      return NextResponse.json({ challenge: def, progress: 0, claimed: false })
    }

    const player = await db.player.findUnique({ where: { token } })
    if (!player) return NextResponse.json({ error: 'Unknown player' }, { status: 401 })

    // Roll a fresh challenge if the stored one is from a previous day
    let p = player
    if (p.dailyDate !== day || p.dailyKind !== def.kind) {
      p = await db.player.update({
        where: { id: p.id },
        data: { dailyDate: day, dailyKind: def.kind, dailyProgress: 0, dailyClaimed: false },
      })
    }

    return NextResponse.json({
      challenge: def,
      progress: Math.min(p.dailyProgress ?? 0, def.target),
      claimed: p.dailyClaimed,
    })
  } catch (e) {
    console.error('daily GET error:', e)
    return NextResponse.json({ error: 'daily unavailable' }, { status: 500 })
  }
}

/** Manual progress is not allowed — progress is match-driven only. */
export async function POST() {
  return NextResponse.json({ error: 'Progress is match-driven' }, { status: 405 })
}
