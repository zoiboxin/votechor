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

    const stats = await db.playerStats.upsert({
      where: { playerId: player.id },
      create: { playerId: player.id },
      update: {},
    })
    const recent = await db.matchResult.findMany({
      where: { playerId: player.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    return NextResponse.json({ stats, recent })
  } catch (err) {
    console.error('[api/stats] error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
