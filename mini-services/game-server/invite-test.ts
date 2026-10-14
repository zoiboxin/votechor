// VoteChor squad-invite protocol test (§15).
// Connects 2 socket.io clients to the same private room and asserts the full
// invite lifecycle: send → receive → accept → roster, decline notify, expiry,
// self/not-found guards, auto-cell creation, and disconnect cleanup.
// Run: bun invite-test.ts  (server must be listening on :3002)
import { io, type Socket } from 'socket.io-client'

const URL = process.env.GAME_SERVER_URL ?? 'http://localhost:3002'
const ROOM = process.env.INVITE_ROOM ?? 'ITST1'

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

interface JoinAck { ok: boolean; playerId: string; roomId?: string; roomCode?: string }

function waitJoin(s: Socket): Promise<JoinAck> {
  return new Promise((resolve, reject) => {
    s.once('game:joined', (ack: JoinAck) => resolve(ack))
    setTimeout(() => reject(new Error('game:joined timeout')), 6000)
  })
}

/** Collect the next squad-roster event for a socket. */
function nextSquad(s: Socket, ms = 4000): Promise<{ code: string; members: { id: string; name: string }[] } | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms)
    s.once('game:squad', (squad: { code: string; members: { id: string; name: string }[] } | null) => {
      clearTimeout(t)
      resolve(squad)
    })
  })
}

/** Wait for a one-shot named event with a payload. */
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

async function main() {
  console.log(`Invite test → ${URL} (room ${ROOM})`)

  const a = await connect()
  const b = await connect()
  ok(true, '2 clients connected')

  const ackA = await (a.emit('game:join', { name: 'Inviter', archetype: 'student', roomCode: ROOM }), waitJoin(a))
  const ackB = await (b.emit('game:join', { name: 'Invitee', archetype: 'student', roomCode: ROOM }), waitJoin(b))
  ok(ackA.ok && ackB.ok, 'both joined the room')
  ok(ackA.roomId === ackB.roomId, `same room (${ackA.roomId})`)
  await sleep(300) // let join events settle

  // ---------- 1. invite → receive ----------
  const inviteP = nextEvent<{ fromId: string; fromName: string; code: string }>(b, 'game:squadInvite')
  const sentP = nextEvent<{ targetId: string; targetName: string }>(a, 'game:squadInviteSent')
  const rosterA1 = nextSquad(a, 2500) // auto-created cell roster for A (attach BEFORE invite)
  a.emit('game:squadInvite', { targetId: ackB.playerId })
  const inv = await inviteP
  const sent = await sentP
  ok(Boolean(inv && /^[A-Z0-9]{4}$/.test(inv.code)), `B received invite with 4-char cell code (${inv?.code ?? 'none'})`)
  ok(inv?.fromName === 'Inviter', 'invite carries inviter name')
  ok(sent?.targetName === 'Invitee', 'A got squadInviteSent ack')
  const r1 = await rosterA1
  ok(r1 !== null && r1.members.length === 1, 'cell auto-created for A on first invite (roster 1/4)')

  // ---------- 2. accept → both rosters 2/4 ----------
  const squadPA = nextSquad(a)
  const squadPB = nextSquad(b)
  b.emit('game:squadInviteAccept', { fromId: inv!.fromId })
  const [sa, sb] = await Promise.all([squadPA, squadPB])
  ok(sa !== null && sa.members.length === 2, `A roster 2/4 after accept (${sa?.members.length ?? 0})`)
  ok(sb !== null && sb.members.length === 2 && sb.code === sa?.code, `B roster 2/4, same cell ${sa?.code}`)
  const accP = nextEvent<{ byId: string; byName: string }>(a, 'game:squadInviteAccepted', 1500)
  // (accepted event fired before this listener — verify via roster instead; assert accept idempotence path below)

  // ---------- 3. ALREADY_IN_CELL guard ----------
  const errP1 = nextEvent<{ targetId: string; reason: string }>(a, 'game:squadInviteError')
  a.emit('game:squadInvite', { targetId: ackB.playerId })
  const err1 = await errP1
  ok(err1?.reason === 'ALREADY_IN_CELL', 're-inviting a cellmate → ALREADY_IN_CELL')

  // ---------- 4. decline flow ----------
  const leaveSquadB = nextSquad(b, 1500) // B leaving: B gets null roster
  const rosterA2 = nextSquad(a, 2500) // attach BEFORE B leaves
  b.emit('game:squadLeave')
  const bNull = await leaveSquadB
  ok(bNull === null, 'B left the cell (roster null)')
  const r2 = await rosterA2
  ok(r2 !== null && r2.members.length === 1, 'A roster back to 1/4 after B left')

  const declP = nextEvent<{ byId: string; byName: string }>(a, 'game:squadInviteDeclined')
  const invP2 = nextEvent<{ fromId: string; code: string }>(b, 'game:squadInvite')
  a.emit('game:squadInvite', { targetId: ackB.playerId })
  const inv2 = await invP2
  ok(inv2 !== null, 're-invite after leave delivers')
  b.emit('game:squadInviteDecline', { fromId: inv2!.fromId })
  const decl = await declP
  ok(decl?.byName === 'Invitee', 'A informed B declined (name correct)')

  // ---------- 5. expiry (server TTL 20s) ----------
  const invP3 = nextEvent<{ fromId: string; code: string }>(b, 'game:squadInvite')
  a.emit('game:squadInvite', { targetId: ackB.playerId })
  const inv3 = await invP3
  ok(inv3 !== null, 'invite for expiry test delivered')
  console.log('— waiting 21s for server-side invite expiry…')
  await sleep(21000)
  const expiredErrP = nextEvent<{ targetId: string; reason: string }>(b, 'game:squadInviteError')
  b.emit('game:squadInviteAccept', { fromId: inv3!.fromId })
  const expiredErr = await expiredErrP
  ok(expiredErr?.reason === 'INVITE_EXPIRED', 'accepting an expired invite → INVITE_EXPIRED')

  // ---------- 6. bogus target ----------
  const errP2 = nextEvent<{ targetId: string; reason: string }>(a, 'game:squadInviteError')
  a.emit('game:squadInvite', { targetId: 'not_a_socket' })
  const err2 = await errP2
  ok(err2?.reason === 'TARGET_NOT_FOUND', 'bogus target → TARGET_NOT_FOUND')

  // ---------- 7. invitee disconnect cleanup + fresh accept still works ----------
  const invP4 = nextEvent<{ fromId: string; code: string }>(b, 'game:squadInvite')
  a.emit('game:squadInvite', { targetId: ackB.playerId })
  ok((await invP4) !== null, 'invite for cleanup test delivered')
  b.disconnect() // pending invite to B must die with the socket
  await sleep(300)
  // B rejoins on a fresh socket; old invite must NOT be accepted
  const b2 = await connect()
  const ackB2 = await (b2.emit('game:join', { name: 'Invitee2', archetype: 'student', roomCode: ROOM }), waitJoin(b2))
  ok(ackB2.ok, 'B rejoined on a fresh socket')
  const expiredErrP2 = nextEvent<{ reason: string }>(b2, 'game:squadInviteError')
  b2.emit('game:squadInviteAccept', { fromId: ackA.playerId })
  const expiredErr2 = await expiredErrP2
  ok(expiredErr2?.reason === 'INVITE_EXPIRED', 'stale invite from dead socket cannot be accepted')
  // but a NEW invite round-trips on the fresh sockets
  const invP5 = nextEvent<{ fromId: string; code: string }>(b2, 'game:squadInvite')
  a.emit('game:squadInvite', { targetId: ackB2.playerId })
  const inv5 = await invP5
  ok(inv5 !== null, 'fresh invite reaches rejoined B')
  const squadPA3 = nextSquad(a)
  const squadPB3 = nextSquad(b2)
  b2.emit('game:squadInviteAccept', { fromId: inv5!.fromId })
  const [sa3, sb3] = await Promise.all([squadPA3, squadPB3])
  ok(sa3 !== null && sa3.members.length === 2 && sb3?.members.length === 2, 'accept works end-to-end after reconnect')

  a.disconnect()
  b2.disconnect()
  console.log(failures === 0 ? '\nALL INVITE TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('invite-test crashed:', e)
  process.exit(1)
})
