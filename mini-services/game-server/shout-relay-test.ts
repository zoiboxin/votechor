// Task 45 probe — game:shout relay: clamping, sanitization, rate limit, echo-to-sender.
// Run: bun shout-relay-test.ts  (from mini-services/game-server)
import { io, type Socket } from 'socket.io-client'

const URL = process.env.GAME_SERVER_URL ?? 'http://localhost:3002'
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

let failures = 0
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`)
  if (!cond) failures++
}

interface ShoutEv { id: string; x: number; z: number; whistle: boolean; line: string }

async function main() {
  const a = io(URL, { transports: ['websocket', 'polling'], forceNew: true, timeout: 5000 })
  const b = io(URL, { transports: ['websocket', 'polling'], forceNew: true, timeout: 5000 })

  const connected = (sock: Socket) => new Promise<void>((res, rej) => {
    sock.once('connect', () => res())
    sock.once('connect_error', (e: Error) => rej(e))
    setTimeout(() => rej(new Error('connect timeout')), 6000)
  })
  const joinAck = (sock: Socket) => new Promise<any>(res => sock.once('game:joined', res as never))

  await Promise.all([connected(a), connected(b)])
  const [ackA, ackB] = await Promise.all([
    (a.emit('game:join', { name: 'Shouter', archetype: 'student' }), joinAck(a)),
    (b.emit('game:join', { name: 'Listener', archetype: 'student' }), joinAck(b)),
  ])
  await wait(300)
  ok(ackA.ok === true && ackB.ok === true, '2 clients joined the same room')
  if (!ackA.ok || !ackB.ok) process.exit(1)

  // permanent collector on B — every relayed shout lands here with a timestamp
  const inbox: Array<ShoutEv & { at: number }> = []
  b.on('game:shout', (id: string, x: number, z: number, whistle: boolean, line: string) => {
    inbox.push({ id, x, z, whistle, line, at: Date.now() })
  })
  /** wait until a shout with `line` appears (unique marker per probe) */
  const awaitLine = async (line: string, ms = 2500): Promise<ShoutEv | null> => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const hit = inbox.find(e => e.line === line)
      if (hit) return hit
      await wait(60)
    }
    return null
  }

  // --- probe 1: relay reaches the other client with clean args ---
  a.emit('game:shout', { x: 12.5, z: -80.25, whistle: true, line: '*shrill whistle*' })
  const e1 = await awaitLine('*shrill whistle*')
  ok(!!e1 && e1.id === ackA.playerId && Math.abs(e1.x - 12.5) < 0.01 && Math.abs(e1.z - -80.25) < 0.01 && e1.whistle === true,
    `relay with clean args (id match, x=12.5, z=-80.25, whistle=true)${e1 ? '' : ' — nothing received'}`)

  // --- probe 2: sender echo (client self-guards by playerId on the engine side) ---
  a.emit('game:shout', { x: 1, z: 2, whistle: false, line: 'AAZADII!' })
  const e2 = await awaitLine('AAZADII!')
  ok(!!e2, 'relay broadcast includes the sender echo (client self-guards)')
  await wait(600) // drain the rate window + in-flight echoes

  // --- probe 3: sanitization — control chars stripped, 200 chars clamped to 48 ---
  const long = 'bad\u0000\u0007ctrl\u000bchars' + 'x'.repeat(200)
  a.emit('game:shout', { x: 5, z: 5, whistle: false, line: long })
  const e3 = await awaitLine('bad ctrl chars' + 'x'.repeat(48 - 'bad ctrl chars'.length))
  ok(!!e3, `sanitize: control chars stripped + clamp to 48 (got ${e3 ? e3.line.length : 'nothing'} chars)`)

  // --- probe 4: malformed coords clamped to 0,0 (never NaN) ---
  a.emit('game:shout', { x: 'not-a-number', z: undefined, whistle: false, line: 'hmm coords' })
  const e4 = await awaitLine('hmm coords')
  ok(!!e4 && e4.x === 0 && e4.z === 0 && Number.isFinite(e4.x) && Number.isFinite(e4.z),
    `malformed coords → clamped 0,0 (got x=${e4?.x}, z=${e4?.z})`)
  await wait(1200) // drain the 5/s noise window before the flood

  // --- probe 5: rate limit — 10 floods share the noiseTimes 5/s window ---
  inbox.length = 0
  for (let i = 0; i < 10; i++) a.emit('game:shout', { x: i, z: 0, whistle: false, line: `flood ${i}` })
  await wait(1200)
  const relayed = inbox.length
  ok(relayed > 0 && relayed <= 5, `rate limit: ${relayed}/10 relayed (window is 5/s)`)

  a.disconnect(); b.disconnect()
  await wait(200)
  console.log('———————————————————')
  console.log(failures === 0 ? 'SHOUT RELAY: ALL PASS' : `SHOUT RELAY: ${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error('probe crashed:', e); process.exit(1) })
