// Season system protocol test — joins two humans into one season, verifies
// bot backfill / swap-out / movement / AOI snapshots / guards. Run: bun season-test.ts
import { io, type Socket } from 'socket.io-client'

const URL = 'http://localhost:3002'
let pass = 0
let fail = 0
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ FAIL: ${label}`) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface PlayerNet { id: string; name: string; x: number; z: number; anim: string }
interface SeasonNet { id: string; name: string; humans: number; bots: number; cap: number; humansMax: number }

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, timeout: 5000 })
    s.on('connect', () => resolve(s))
    s.on('connect_error', (e: Error) => reject(e))
  })
}

interface JoinResult { ack: Record<string, unknown>; players: PlayerNet[]; season: SeasonNet | null }
function joinSeason(s: Socket, name: string): Promise<JoinResult> {
  return new Promise((resolve) => {
    const onAck = (ack: Record<string, unknown>) => {
      s.off('game:joined', onAck)
      resolve({ ack, players: (ack.players as PlayerNet[]) ?? [], season: (ack.season as SeasonNet) ?? null })
    }
    s.on('game:joined', onAck)
    s.emit('game:join', { name, archetype: 'student', roomCode: null, season: true })
  })
}

async function main() {
  console.log('— Season protocol test —')

  // 1. First solo join → creates a season of 100
  const A = await connect()
  const a = await joinSeason(A, 'SeasonTestA')
  ok(a.ack.ok === true, 'A join ack ok')
  const roomId = String(a.ack.roomId ?? '')
  ok(roomId.startsWith('sea_'), `A landed in a season (${roomId})`)
  ok(a.season !== null, 'ack carries season info')
  ok(a.season?.cap === 100, 'season cap is 100')
  ok(a.season?.humans === 1, `season humans = 1 (got ${a.season?.humans})`)
  ok(a.season?.bots === 99, `season bots = 99 (got ${a.season?.bots})`)
  ok(a.players.length === 100, `join ack roster has 100 protesters (got ${a.players.length})`)
  ok(a.players.filter((p) => p.id.startsWith('bot_')).length === 99, '99 bots in the ack roster')

  // 2. A receives per-recipient snapshots containing bots
  let sawBotsInSnapshot = 0
  let snapshotCount = 0
  A.on('game:players', (list: PlayerNet[]) => {
    snapshotCount++
    sawBotsInSnapshot = Math.max(sawBotsInSnapshot, list.filter((p) => p.id.startsWith('bot_')).length)
  })
  await sleep(1200)
  ok(snapshotCount > 5, `A receives player snapshots (${snapshotCount} in 1.2s)`)
  ok(sawBotsInSnapshot > 10, `snapshots include nearby bots (max ${sawBotsInSnapshot} in one frame)`)
  const bot0Id = a.players.find((p) => p.id.startsWith('bot_'))!.id

  // 3. Bots actually move — track the most-mobile bot over the window
  const pos0 = new Map<string, { x: number; z: number }>(a.players.filter((p) => p.id.startsWith('bot_')).map((p) => [p.id, { x: p.x, z: p.z }]))
  const pos1 = new Map<string, { x: number; z: number }>()
  const moveHandler = (list: PlayerNet[]) => {
    for (const b of list) if (pos0.has(b.id)) pos1.set(b.id, { x: b.x, z: b.z })
  }
  A.on('game:players', moveHandler)
  await sleep(3000)
  A.off('game:players', moveHandler)
  let maxMoved = 0
  for (const [id, p0] of pos0) {
    const p1 = pos1.get(id)
    if (p1) maxMoved = Math.max(maxMoved, Math.hypot(p1.x - p0.x, p1.z - p0.z))
  }
  ok(maxMoved > 1.5, `bots move (most-mobile bot: ${maxMoved.toFixed(1)}m in 3s)`)

  // 4. Second human joins the SAME season — one bot steps aside
  // (listeners registered BEFORE the join — the swap-out happens during the join ack)
  const botLeftP = new Promise<string>((resolve) => {
    const h = (id: string, name: string) => { if (id.startsWith('bot_')) { A.off('game:playerleft', h); resolve(name) } }
    A.on('game:playerleft', h)
    setTimeout(() => resolve(''), 6000)
  })
  const joinedBP = new Promise<string>((resolve) => {
    const h = (id: string, name: string) => { if (!id.startsWith('bot_')) { A.off('game:playerjoined', h); resolve(name) } }
    A.on('game:playerjoined', h)
    setTimeout(() => resolve(''), 6000)
  })
  const B = await connect()
  const b = await joinSeason(B, 'SeasonTestB')
  ok(String(b.ack.roomId ?? '') === roomId, 'B joined the SAME season (matchmaking)')
  ok(b.season?.humans === 2, `B join → humans = 2 (got ${b.season?.humans})`)
  ok(b.season?.bots === 98, `B join → bots = 98 (one bot stepped aside, got ${b.season?.bots})`)
  ok(b.players.length === 100, 'B roster still totals 100')
  const leftName = await botLeftP
  const joinedName = await joinedBP
  ok(leftName !== '', `bot removal was broadcast (${leftName})`)
  ok(joinedName === 'SeasonTestB', `B's playerjoined broadcast reached A (${joinedName})`)

  // 5. Bots emote / quickmsg broadcast (world alive)
  let botEmote = false
  let botQuip = false
  const emoteH = (id: string) => { if (id.startsWith('bot_')) botEmote = true }
  const quipH = (id: string) => { if (id.startsWith('bot_')) botQuip = true }
  A.on('game:emote', emoteH)
  A.on('game:quickmsg', quipH)
  await sleep(2000)
  A.off('game:emote', emoteH)
  A.off('game:quickmsg', quipH)
  console.log(`  · bot emote seen: ${botEmote}, bot quip seen: ${botQuip} (probabilistic — informational)`)

  // 6. Guards: gift to bot → refund
  const refundP = new Promise<string>((resolve) => {
    const h = (r: { type: string }) => { B.off('game:giftRefund', h); resolve(r.type) }
    B.on('game:giftRefund', h)
    setTimeout(() => resolve(''), 3000)
  })
  B.emit('game:gift', { targetId: bot0Id, type: 'chai' })
  const refundType = await refundP
  ok(refundType === 'chai', 'gift to bot is refunded (not silently consumed)')

  // 7. B leaves → backfill bot walks in, humans back to 1
  // (collect ALL season updates — the backfill arrives 2.5–7s after the leave)
  const seasonUpdates: SeasonNet[] = []
  const seasonH = (s: SeasonNet) => seasonUpdates.push(s)
  A.on('game:season', seasonH)
  B.emit('game:leave')
  B.disconnect()
  await sleep(11000)
  A.off('game:season', seasonH)
  const sInfo = seasonUpdates[seasonUpdates.length - 1]
  ok(seasonUpdates.length >= 2, `season updates streamed after leave (${seasonUpdates.length})`)
  ok(sInfo?.humans === 1, `after B leaves → humans = 1 (got ${sInfo?.humans})`)
  ok(sInfo?.bots === 99, `after B leaves → bots backfilled to 99 (got ${sInfo?.bots})`)

  // 8. A leaves → season survives on bots for a grace window, then dissolves
  A.disconnect()
  await sleep(1000)

  console.log(`\n${pass} pass, ${fail} fail`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('fatal:', e); process.exit(1) })
