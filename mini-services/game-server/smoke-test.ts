// VoteChor game server smoke test.
// Connects 2 socket.io clients, joins the same public room, sends game:state,
// and asserts: both appear in game:players snapshots, and game:npcs arrives.
// Run: bun smoke-test.ts  (server must be listening on :3002)
import { io, type Socket } from 'socket.io-client'

const URL = process.env.GAME_SERVER_URL ?? 'http://localhost:3002'
const TIMEOUT_MS = 15000

let failures = 0
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`)
  if (!cond) failures++
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket', 'polling'], forceNew: true, timeout: 5000 })
    s.on('connect', () => resolve(s))
    s.on('connect_error', (e: Error) => reject(e))
    setTimeout(() => reject(new Error('connect timeout')), 6000)
  })
}

interface JoinAck {
  ok: boolean
  error?: string
  playerId: string
  roomId: string
  roomCode?: string
  tokensNeeded: number
  tokensCollected: number
  matchStartedAt: number
  players?: { id: string }[]
  npcs?: { id: string }[]
  items?: { id: string }[]
  checkpoints?: number[]
  boss?: unknown
}

function waitJoin(s: Socket): Promise<JoinAck> {
  return new Promise((resolve, reject) => {
    s.once('game:joined', (ack: JoinAck) => resolve(ack))
    setTimeout(() => reject(new Error('game:joined timeout')), 6000)
  })
}

async function main() {
  console.log(`Smoke test → ${URL}`)
  const a = await connect()
  const b = await connect()
  ok(true, '2 clients connected')

  const ackA = await (a.emit('game:join', { name: 'Alice', archetype: 'student' }), waitJoin(a))
  // attach snapshot listeners BEFORE the second join so no events are missed
  let playersA: { id: string; anim: string; name: string }[] = []
  let playersB: { id: string; anim: string; name: string }[] = []
  let npcCount = -1
  let sawNpcs = false
  a.on('game:players', (p: { id: string; anim: string; name: string }[]) => { playersA = p })
  b.on('game:players', (p: { id: string; anim: string; name: string }[]) => { playersB = p })
  a.on('game:npcs', (n: unknown[]) => { sawNpcs = true; npcCount = n.length })
  let lastPlayerjoinedId = ''
  a.on('game:playerjoined', (id: string) => { lastPlayerjoinedId = id })

  const ackB = await (b.emit('game:join', { name: 'Bob', archetype: 'chai_sprinter' }), waitJoin(b))
  const sawPlayerjoinedOnA = lastPlayerjoinedId === ackB.playerId

  ok(ackA.ok === true && ackB.ok === true, 'game:joined ok for both clients')
  ok(!!ackA.playerId && !!ackB.playerId, `playerIds assigned (${ackA.playerId.slice(0, 6)}…, ${ackB.playerId.slice(0, 6)}…)`)
  ok(ackA.roomId === ackB.roomId, `same public room: ${ackA.roomId}`)
  ok(ackA.tokensNeeded > 0, `tokensNeeded present (${ackA.tokensNeeded})`)
  ok(typeof ackA.matchStartedAt === 'number', 'matchStartedAt present')
  ok(Array.isArray(ackA.players) && ackA.players.length >= 1, `join ack A lists ${ackA.players?.length} player(s)`) // A joined first
  ok(Array.isArray(ackB.players) && ackB.players.length === 2, `join ack B lists ${ackB.players?.length} players (expected 2)`)
  ok(Array.isArray(ackA.npcs) && ackA.npcs.length > 0, `join ack lists npcs (${ackA.npcs?.length})`)
  ok(Array.isArray(ackA.items) && ackA.items.length > 0, `join ack lists items (${ackA.items?.length})`)

  // send state updates from both (near spawn, inside bounds)
  let sent = 0
  const stateTimer = setInterval(() => {
    sent++
    a.emit('game:state', { x: 2.5, y: 0, z: -12, ry: 0.4, anim: 'run' })
    b.emit('game:state', { x: -2.5, y: 0, z: -12, ry: -0.4, anim: 'walk' })
  }, 100)

  // wait for a players snapshot containing BOTH ids + npcs snapshot
  const result = await new Promise<{ both: boolean; npcs: boolean }>(resolve => {
    const started = Date.now()
    const check = setInterval(() => {
      const idsA = (playersA ?? []).map(p => p.id)
      const idsB = (playersB ?? []).map(p => p.id)
      const bothSeen =
        idsA.includes(ackA.playerId) && idsA.includes(ackB.playerId) &&
        idsB.includes(ackA.playerId) && idsB.includes(ackB.playerId)
      if (bothSeen && sawNpcs) return resolve({ both: true, npcs: true })
      if (Date.now() - started > TIMEOUT_MS) return resolve({ both: bothSeen, npcs: sawNpcs })
    }, 50)
  })
  clearInterval(stateTimer)

  const snapA = playersA ?? []
  const bobInSnap = snapA.find(p => p.id === ackB.playerId)
  ok(result.both, `both players present in game:players snapshots (last: ${snapA.length} players)`)
  ok(snapA.length >= 2, `snapshot player count >= 2 (got ${snapA.length})`)
  ok(!!bobInSnap, `Bob relayed with state fields (anim=${bobInSnap?.anim}, name=${bobInSnap?.name})`)
  ok(result.npcs, `game:npcs snapshot received (${npcCount} npcs incl. searchlights)`)
  ok(sawPlayerjoinedOnA, 'game:playerjoined seen by the other client')

  a.disconnect()
  b.disconnect()
  await new Promise(r => setTimeout(r, 300))

  console.log('———————————————————————————')
  if (failures === 0) {
    console.log('SMOKE TEST: ALL PASS')
    process.exit(0)
  } else {
    console.log(`SMOKE TEST: ${failures} FAILURE(S)`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('SMOKE TEST ERROR:', err.message)
  process.exit(1)
})
