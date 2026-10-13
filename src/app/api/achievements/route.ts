import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ACHIEVEMENTS } from '@/game/shared/constants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const sanitize = (v: unknown): string => String(v ?? '').replace(/[<>&]/g, '').trim()

export async function GET(req: Request) {
  try {
    // ensure the achievement catalog is seeded
    // NOTE: SQLite createMany does not support skipDuplicates → upsert per row (idempotent).
    const count = await db.achievement.count()
    if (count < ACHIEVEMENTS.length) {
      for (const a of ACHIEVEMENTS) {
        await db.achievement.upsert({
          where: { id: a.id },
          create: { id: a.id, name: a.name, description: a.description, icon: a.icon, xpReward: a.xpReward },
          update: { name: a.name, description: a.description, icon: a.icon, xpReward: a.xpReward },
        })
      }
    }

    // optional token → unlocked list
    const token = sanitize(req.headers.get('x-vc-token') ?? '')
    let unlocked: string[] = []
    if (token) {
      const player = await db.player.findUnique({
        where: { token },
        select: { id: true, achievements: { select: { achievementId: true } } },
      })
      if (!player) {
        return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
      }
      unlocked = player.achievements.map((a) => a.achievementId)
    }

    // return db rows in stable ACHIEVEMENTS order
    const rows = await db.achievement.findMany()
    const order = new Map(ACHIEVEMENTS.map((a, i) => [a.id, i]))
    const all = rows
      .map((r) => ({ id: r.id, name: r.name, description: r.description, icon: r.icon, xpReward: r.xpReward }))
      .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))

    return NextResponse.json({ all, unlocked })
  } catch (err) {
    console.error('[api/achievements] error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
