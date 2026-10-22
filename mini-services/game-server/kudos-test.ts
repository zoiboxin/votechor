// VoteChor post-match honors protocol test (§15 — kudos + MVP voting).
// Connects 3 socket.io clients to a private room and asserts the full
// kudos + MVP vote lifecycle: delivery, sent-ack, self/garbage guards,
// tally broadcasts, instant finalize when everyone voted, re-vote sessions,
// and voter-disconnect ballot retraction.
// Run: bun kudos-test.ts  (server must be listening on :3002)
import { io, type Socket } from 'socket.io-client'

const URL = process.env.GAME_SERVER_URL ?? 'http://localhost:3002'
const ROOM = process.env.KUDOS_ROOM ?? `KT${Date.now().toString(36).slice(-4).toUpperCase()}`

let failures = 0
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`)
  if (!cond) failures++
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(URL, { path: '/gs/', transports: ['websocket', 'polling'], forceNew: true, timeout: 5000 })
    s.on('connect', () => resolve(s))
    s.on('connect_error', (e: Error) => reject(e))
    setTimeout(() => reject(new Error('connect timeout')), 6000)
  })
}

interface JoinAck { ok: boolean; playerId: string; roomId?: string }

function waitJoin(s: Socket): Promise<JoinAck> {
  return new Promise((resolve, reject) => {
    s.once('game:joined', (ack: JoinAck) => resolve(ack))
    setTimeout(() => reject(new Error('game:joined timeout')), 6000)
  })
}

function nextEvent<T>(s: Socket, event: string, ms = 4000): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms)
    s.once(event, (payload: T) => {
      clearTimeout(t)
      resolve(payload)
    })
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Tally { tally: { id: string; name: string; votes: number }[]; voters: number; roomPlayers: number }
interface Final { winnerId: string | null; winnerName: string | null; tally: { id: string; votes: number }[]; voters: number }

async function main() {
  console.log(`Kudos/MVP test → ${URL} (room ${ROOM})`)

  const a = await connect()
  const b = await connect()
  const c = await connect()
  ok(true, '3 clients connected')

  const ackA = await (a.emit('game:join', { name: 'KudosA', archetype: 'student', roomCode: ROOM }), waitJoin(a))
  const ackB = await (b.emit('game:join', { name: 'KudosB', archetype: 'student', roomCode: ROOM }), waitJoin(b))
  const ackC = await (c.emit('game:join', { name: 'KudosC', archetype: 'student', roomCode: ROOM }), waitJoin(c))
  ok(ackA.ok && ackB.ok && ackC.ok, 'all 3 joined the room')
  ok(ackA.roomId === ackB.roomId && ackB.roomId === ackC.roomId, `same room (${ackA.roomId})`)
  await sleep(300)

  // ---------- 1. kudos happy path ----------
  const kudosP = nextEvent<{ fromId: string; fromName: string }>(b, 'game:kudos')
  const sentP = nextEvent<{ targetId: string; targetName: string }>(a, 'game:kudosSent')
  a.emit('game:kudos', { targetId: ackB.playerId })
  const kudos = await kudosP
  const sent = await sentP
  ok(kudos?.fromId === ackA.playerId && kudos?.fromName === 'KudosA', 'B received kudos from A with name')
  ok(sent?.targetId === ackB.playerId && sent?.targetName === 'KudosB', 'A got kudosSent ack')

  // ---------- 2. kudos guards (silent) ----------
  const noSelf = nextEvent(b, 'game:kudos', 700)
  a.emit('game:kudos', { targetId: ackA.playerId }) // self
  const selfEv = await noSelf
  ok(selfEv === null, 'self-kudos rejected silently')
  const noGhost = nextEvent(b, 'game:kudos', 700)
  a.emit('game:kudos', { targetId: 'ghost_socket_id' })
  ok((await noGhost) === null, 'kudos to unknown target rejected silently')
  const noThird = nextEvent(c, 'game:kudos', 700)
  b.emit('game:kudos', { targetId: ackC.playerId })
  ok((await noThird) !== null, 'B can still kudos C (rate window allows it)')

  // ---------- 3. MVP self-vote guard ----------
  const errP = nextEvent<{ reason: string }>(a, 'game:mvpError', 1500)
  a.emit('game:mvpVote', { targetId: ackA.playerId })
  const err = await errP
  ok(err?.reason === 'SELF_VOTE', 'self-vote → mvpError SELF_VOTE')

  // ---------- 4. MVP votes: A→B, B→C, C→B → instant finalize, B wins 2-1 ----------
  const tallyA1 = nextEvent<Tally>(a, 'game:mvpTally', 1500)
  a.emit('game:mvpVote', { targetId: ackB.playerId })
  const t1 = await tallyA1
  ok(t1?.voters === 1 && t1?.roomPlayers === 3, `tally broadcast after vote 1 (voters ${t1?.voters}/${t1?.roomPlayers})`)
  ok(t1?.tally[0]?.id === ackB.playerId && t1?.tally[0]?.votes === 1, 'tally names B with 1 vote')

  const tallyB1 = nextEvent<Tally>(b, 'game:mvpTally', 1500)
  b.emit('game:mvpVote', { targetId: ackC.playerId })
  const t2 = await tallyB1
  ok(t2?.voters === 2, 'tally broadcast after vote 2')

  const finalA = nextEvent<Final>(a, 'game:mvpFinal', 2500)
  const finalB = nextEvent<Final>(b, 'game:mvpFinal', 2500)
  const finalC = nextEvent<Final>(c, 'game:mvpFinal', 2500)
  c.emit('game:mvpVote', { targetId: ackB.playerId }) // everyone voted → instant finalize
  const fin = await finalA
  const finB = await finalB
  const finC = await finalC
  ok(fin !== null && finB !== null && finC !== null, 'game:mvpFinal broadcast to the whole room')
  ok(fin?.winnerId === ackB.playerId && fin?.winnerName === 'KudosB', `winner is B with 2 votes (${fin?.winnerName})`)
  ok(fin?.voters === 3, `final carries voter count (${fin?.voters})`)

  // ---------- 5. garbage vote ----------
  const err2 = nextEvent<{ reason: string }>(a, 'game:mvpError', 1200)
  a.emit('game:mvpVote', { targetId: 'ghost_socket_id' })
  ok((await err2)?.reason === 'TARGET_LEFT', 'vote for unknown target → TARGET_LEFT')

  // ---------- 6. new vote session after final ----------
  const tally2 = nextEvent<Tally>(a, 'game:mvpTally', 1500)
  b.emit('game:mvpVote', { targetId: ackA.playerId })
  const t3 = await tally2
  ok(t3?.voters === 1 && t3?.tally[0]?.id === ackA.playerId, 'fresh vote session starts after a final')

  // ---------- 7. voter disconnect retracts ballot ----------
  const tally3 = nextEvent<Tally>(a, 'game:mvpTally', 2000) // attach BEFORE disconnect: retraction is instant
  b.disconnect()
  const t4 = await tally3
  ok(t4 !== null, 'disconnecting voter triggers tally refresh')
  ok(t4?.voters === 0 && t4?.roomPlayers === 2, `ballot retracted (voters ${t4?.voters}/${t4?.roomPlayers})`)

  // ---------- 8. kudos rate limit (5/s window): 6 rapid kudos, only 5 land ----------
  const received: number[] = []
  c.on('game:kudos', () => received.push(1))
  for (let i = 0; i < 7; i++) a.emit('game:kudos', { targetId: ackC.playerId })
  await sleep(800)
  ok(received.length === 5, `kudos rate-limited to 5 per window (${received.length} delivered)`)
  c.off('game:kudos')

  // cleanup
  a.disconnect()
  c.disconnect()
  await sleep(300)

  console.log(failures === 0 ? `\nALL PASS (${ROOM})` : `\n${failures} FAILURES (${ROOM})`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('Test crashed:', e)
  process.exit(1)
})
