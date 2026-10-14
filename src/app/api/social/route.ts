import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const sanitize = (v: unknown): string => String(v ?? '').replace(/[<>&]/g, '').trim()
const clampInt = (v: unknown, lo: number, hi: number): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0
}

/** GET: lifetime social honors for the token's player. */
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
    return NextResponse.json({ kudosReceived: row.kudosReceived, mvpWins: row.mvpWins })
  } catch (err) {
    console.error('[api/social] GET error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST: increment social honors. Body: { kudos?: number (delta, clamped 0..10),
 * mvp?: boolean }. Called by the client when kudos land or an MVP verdict names us.
 * Social stats are cosmetic — the game server rate-limits kudos (5/s) and one vote
 * session decides a single MVP per room, so the worst-case inflation is bounded.
 */
export async function POST(req: Request) {
  try {
    const token = sanitize(req.headers.get('x-vc-token') ?? '')
    if (!token) {
      return NextResponse.json({ error: 'Missing x-vc-token header' }, { status: 401 })
    }
    const player = await db.player.findUnique({ where: { token }, select: { id: true } })
    if (!player) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as { kudos?: unknown; mvp?: unknown }
    const kudos = clampInt(body.kudos, 0, 10)
    const mvp = body.mvp === true

    if (kudos <= 0 && !mvp) {
      return NextResponse.json({ error: 'Nothing to record' }, { status: 400 })
    }

    const row = await db.playerStats.upsert({
      where: { playerId: player.id },
      create: { playerId: player.id, kudosReceived: kudos, mvpWins: mvp ? 1 : 0 },
      update: {
        ...(kudos > 0 ? { kudosReceived: { increment: kudos } } : {}),
        ...(mvp ? { mvpWins: { increment: 1 } } : {}),
      },
    })
    return NextResponse.json({ kudosReceived: row.kudosReceived, mvpWins: row.mvpWins })
  } catch (err) {
    console.error('[api/social] POST error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
