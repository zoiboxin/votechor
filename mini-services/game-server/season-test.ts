// Season system protocol test — joins two humans into one season, verifies
// bot backfill / swap-out / movement / graded-AOI snapshots / guards, plus pure
// AOI-helper unit tests. Run: bun season-test.ts
//
// NOTE on parallel QA traffic: a foreign browser client (e.g. a parallel agent's
// live session, name pattern Protester_XXXX) may join the same season mid-test.
// Human-count assertions therefore assert the INVARIANT (humans ≥ expected,
// humans + bots = 100 cap) instead of exact counts; exact counts are logged.
import { io, type Socket } from 'socket.io-client'
import { selectAoiPayload, computeFarWindow, round1, type AoiCtx, type AoiEntity } from './season'
import type { PlayerNetState } from '../../src/game/shared/types'

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

  // 0. Pure AOI helper unit tests (no sockets, no server needed)
  console.log('— AOI helper unit tests —')
  {
    const mk = (id: string, x: number, z: number): AoiEntity => ({ id, x, z })
    const human = mk('hum', 0, 0)
    const nearBot = mk('bot_near', 3.123, 4.456) // d ≈ 5.4 m → NEAR band
    const bots: AoiEntity[] = [nearBot]
    const midBots: AoiEntity[] = []
    const farBots: AoiEntity[] = []
    for (let i = 0; i < 15; i++) {
      const ang = (i / 15) * Math.PI * 2 + 0.7
      midBots.push(mk(`bot_mid${i}`, 200 * Math.cos(ang), 200 * Math.sin(ang))) // d = 200 m → MID
    }
    for (let i = 0; i < 30; i++) {
      const ang = (i / 30) * Math.PI * 2 + 0.7
      farBots.push(mk(`bot_far${i}`, 400 * Math.cos(ang), 400 * Math.sin(ang))) // d = 400 m → FAR
    }
    bots.push(...midBots, ...farBots)
    const r2 = (v: number) => Math.round(v * 100) / 100
    // two per-bot payload caches as broadcastPlayers would build them
    const near = bots.map((b) => ({ id: b.id, x: r2(b.x), z: r2(b.z) }) as PlayerNetState)
    const mid = bots.map((b) => ({ id: b.id, x: round1(b.x), z: round1(b.z) }) as PlayerNetState)
    const humanEntry = { id: 'hum', name: 'Human' } as PlayerNetState
    const ctxAt = (tick: number, windowIds: ReadonlySet<string>): AoiCtx =>
      ({ tick, farCursor: 0, windowIds, near, mid, humans: [humanEntry] })

    // (a) near bot: present in EVERY one of 12 consecutive selections, full round2 fidelity
    let nearCount = 0
    let nearRound2 = true
    for (let t = 0; t < 12; t++) {
      const out = selectAoiPayload(bots, human, ctxAt(t, new Set()))
      if (out.some((e) => e.id === 'bot_near')) nearCount++
      const e = out.find((p) => p.id === 'bot_near')!
      if (e.x !== r2(nearBot.x) || e.z !== r2(nearBot.z)) nearRound2 = false
    }
    ok(nearCount === 12, `unit: near bot present in all 12 consecutive selections (${nearCount}/12)`)
    ok(nearRound2, 'unit: near bot carries the full-detail (round2) payload')

    // (b) mid band: 1/3 rate — every mid bot in 3..5 of 12, exactly 5 of 15 per tick
    const midCounts = new Map<string, number>()
    let midPerTickSteady = true
    for (let t = 0; t < 12; t++) {
      const out = selectAoiPayload(bots, human, ctxAt(t, new Set()))
      let midInTick = 0
      for (const e of out) {
        if (!e.id.startsWith('bot_mid')) continue
        midInTick++
        midCounts.set(e.id, (midCounts.get(e.id) ?? 0) + 1)
        if (e.x !== round1(bots.find((b) => b.id === e.id)!.x)) midPerTickSteady = false // must be round1
      }
      if (midInTick !== 5) midPerTickSteady = false
    }
    const counts = [...midCounts.values()]
    ok(counts.length === 15 && counts.every((c) => c >= 3 && c <= 5),
      `unit: mid bot selected 3..5 of 12 ticks (15 bots → counts ${Math.min(...counts)}..${Math.max(...counts)})`)
    ok(midPerTickSteady, 'unit: exactly 1/3 of the mid band per tick, round1 payload')

    // (c) far window: rotates (never the same set twice in a row), 14 ids, cursor sweep
    const w0 = computeFarWindow(bots, 0)
    const w1 = computeFarWindow(bots, w0.nextCursor)
    const w2 = computeFarWindow(bots, w1.nextCursor)
    ok(w0.ids.size === 14 && w1.ids.size === 14, `unit: far window holds 14 ids (${w0.ids.size}, ${w1.ids.size})`)
    ok(w0.nextCursor === 14, 'unit: far cursor advances by BOT_FAR_WINDOW per tick')
    const ser = (s: Set<string>) => [...s].sort().join(',')
    ok(ser(w0.ids) !== ser(w1.ids) && ser(w1.ids) !== ser(w2.ids), 'unit: far window ids rotate (no consecutive repeat)')

    // far-band gating inside selectAoiPayload: windowed far bot in (round1), others out,
    // near bot never duplicated even when it sits inside the window
    const winX = computeFarWindow(bots, 44) // covers bots[44],bots[45],bots[0..11] → far28,far29,near,mid0..mid8
    const outX = selectAoiPayload(bots, human, ctxAt(0, winX.ids))
    ok(outX.filter((e) => e.id === 'bot_near').length === 1, 'unit: near bot deduped even when inside the far window')
    ok(outX.some((e) => e.id === 'bot_far28') && outX.some((e) => e.id === 'bot_far29'), 'unit: windowed far bots are included')
    ok(!outX.some((e) => e.id === 'bot_far5'), 'unit: non-windowed far bots stay out (>300 m)')
    const farEntry = outX.find((e) => e.id === 'bot_far28')!
    ok(farEntry.x === round1(farBots[28].x) && farEntry.z === round1(farBots[28].z), 'unit: far bot carries the round1 payload')
    ok(outX[0] === humanEntry, 'unit: human entry always first in the payload')
  }

  // 1. First solo join → creates a season of 100
  const A = await connect()
  // foreign non-bot joiners (parallel QA browsers) observed via A's join/left events
  const foreignHumans = new Set<string>()
  A.on('game:playerjoined', (id: string, name: string) => {
    if (!id.startsWith('bot_') && name !== 'SeasonTestA' && name !== 'SeasonTestB') foreignHumans.add(id)
  })
  A.on('game:playerleft', (id: string) => { foreignHumans.delete(id) })
  const a = await joinSeason(A, 'SeasonTestA')
  ok(a.ack.ok === true, 'A join ack ok')
  const roomId = String(a.ack.roomId ?? '')
  ok(roomId.startsWith('sea_'), `A landed in a season (${roomId})`)
  ok(a.season !== null, 'ack carries season info')
  ok(a.season?.cap === 100, 'season cap is 100')
  ok((a.season?.humans ?? 0) >= 1 && (a.season?.humans ?? 0) + (a.season?.bots ?? 0) === 100,
    `season population invariant holds (humans ${a.season?.humans} + bots ${a.season?.bots} = 100; foreign=${foreignHumans.size})`)
  ok(a.season?.bots === 100 - (a.season?.humans ?? 1), `bots backfill the rest of the cap (${a.season?.bots})`)
  ok(a.players.length === 100, `join ack roster has 100 protesters (got ${a.players.length})`)
  ok(a.players.filter((p) => p.id.startsWith('bot_')).length === 100 - (a.season?.humans ?? 1), `bot roster matches cap minus humans (${a.players.filter((p) => p.id.startsWith('bot_')).length})`)

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
    const h = (id: string, name: string) => {
      if (name === 'SeasonTestB') { A.off('game:playerjoined', h); resolve(name) } // exact match — foreign humans join too
    }
    A.on('game:playerjoined', h)
    setTimeout(() => resolve(''), 6000)
  })
  const B = await connect()
  const b = await joinSeason(B, 'SeasonTestB')
  ok(String(b.ack.roomId ?? '') === roomId, 'B joined the SAME season (matchmaking)')
  ok((b.season?.humans ?? 0) >= 2, `B join → humans ≥ 2 (got ${b.season?.humans}; foreign=${foreignHumans.size})`)
  ok(b.season?.bots === 100 - (b.season?.humans ?? 2), `B join → bots backfilled to cap-minus-humans (got ${b.season?.bots})`)
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
  ok((sInfo?.humans ?? 0) >= 1, `after B leaves → humans ≥ 1 (got ${sInfo?.humans}; foreign=${foreignHumans.size})`)
  ok(sInfo?.bots === 100 - (sInfo?.humans ?? 1), `after B leaves → bots backfilled to cap-minus-humans (got ${sInfo?.bots})`)

  // 7.5 Live graded-AOI stream (A solo again): snapshot shape + bandwidth budget
  let liveSnaps = 0
  let liveMinBots = Infinity
  let liveSelfMissing = 0
  let liveEntries = 0
  const selfId = String(a.ack.playerId ?? '')
  const liveH = (list: PlayerNet[]) => {
    liveSnaps++
    liveMinBots = Math.min(liveMinBots, list.filter((p) => p.id.startsWith('bot_')).length)
    if (selfId && !list.some((p) => p.id === selfId)) liveSelfMissing++
    liveEntries += list.length
  }
  A.on('game:players', liveH)
  await sleep(3000)
  A.off('game:players', liveH)
  const avgEntries = liveEntries / Math.max(1, liveSnaps)
  const impliedBps = avgEntries * 90 * 12 // 90 B/entry estimate × 12 Hz (see EST_BYTES_PER_ENTRY)
  ok(liveSnaps >= 24, `solo stream keeps ~12 Hz cadence (${liveSnaps} snapshots in 3s)`)
  ok(liveMinBots >= 30, `every snapshot carries ≥30 bot entries (min ${liveMinBots})`)
  ok(liveSelfMissing === 0, 'own player entry present in every snapshot')
  ok(impliedBps < 60_000, `implied bandwidth < 60 KB/s (avg ${avgEntries.toFixed(1)} entries → ${(impliedBps / 1024).toFixed(1)} KiB/s est)`)

  // 8. A leaves → season survives on bots for a grace window, then dissolves
  A.disconnect()
  await sleep(1000)

  console.log(`\n${pass} pass, ${fail} fail`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('fatal:', e); process.exit(1) })
