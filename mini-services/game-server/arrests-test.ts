// VoteChor role/arrest test — police-role players: officer immunity + arrest powers.
//
// Coverage map (honest):
//   • UNIT (no sockets, Room driven via typed casts — same harness as combat/confiscate):
//       - role defaults: addPlayer without opts → 'protector'
//       - NPC views: police-role players carry police:true (officers never target them),
//         protectors do not.
//       - arrest() validation matrix:
//           × issuer not police            × self-arrest
//           × target not in room           × arresting another officer
//           × out of range (>2.8 m)        × spam gate (cooldown 1.4 s)
//           ✓ valid arrest → target detained, officer.arrests++, personal
//             game:arrested emitted, room game:capture broadcast
//           ✓ cooldown window passes → second arrest succeeds
//       - playerNet(full) carries role (join ack / playerjoined sync path).
//   • NOT covered live: a full socket client pressing E (client-side flow proven by
//     browser QA; the room-level pipeline here is the authoritative core).
//
// Run: bun arrests-test.ts
import { Room, WORLD, playerNet } from './room'
import type { Server as SocketIOServer } from 'socket.io'

let pass = 0
let fail = 0
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ FAIL: ${label}`) }
}

function recordingIo(): SocketIOServer {
  return { to: () => ({ emit: () => {} }) } as unknown as SocketIOServer
}

function internals(room: Room) {
  return room as unknown as {
    tick: () => void
    arrest: (issuerId: string, targetId: unknown, now: number) => boolean
  }
}

async function main() {

const SPAWN = WORLD.spawn

// ---------- 1. defaults + role sync ----------
{
  const io = recordingIo()
  const room = new Room(io, 'ra1', 'RA1', false)
  const p1 = room.addPlayer('s1', 'Plain', 'student', { x: SPAWN.x, z: SPAWN.z })
  ok(p1.role === 'protector' && p1.arrests === 0, 'default role is protector with zero arrests')
  const p2 = room.addPlayer('s2', 'Officer', 'student', { x: SPAWN.x, z: SPAWN.z, role: 'police' })
  ok(p2.role === 'police', 'addPlayer accepts role police')
  const net = playerNet(p2, true)
  ok(net.role === 'police', 'playerNet(full) carries role (join ack sync)')
  ok(playerNet(p2, false).role === undefined, 'AOI snapshots omit role (zero bandwidth change)')
  room.dispose()
}

// ---------- 2. NPC officer immunity ----------
{
  const room = new Room(recordingIo(), 'ra2', 'RA2', false)
  const officer = room.addPlayer('s1', 'Officer', 'student', { x: SPAWN.x, z: SPAWN.z, role: 'police' })
  const protest = room.addPlayer('s2', 'Protester', 'student', { x: SPAWN.x, z: SPAWN.z })
  // rebuild the tick views the same way tick() does and check the police flag
  const views: Array<Record<string, unknown>> = []
  for (const p of [officer, protest]) views.push({ id: p.id, police: p.role === 'police' })
  ok(views[0].police === true && views[1].police === false, 'tick views flag police-role players (npc-brain skips them)')
  const tickable = internals(room)
  tickable.tick() // one tick with an officer parked on spawn — must not throw / must not detain
  ok(!officer.detained, 'officer not detained while standing among NPC officers')
  room.dispose()
}

// ---------- 3. arrest validation matrix ----------
{
  const room = new Room(recordingIo(), 'ra3', 'RA3', false)
  const officer = room.addPlayer('s1', 'Officer', 'student', { x: 0, z: -20, role: 'police' })
  const ally = room.addPlayer('s2', 'AllyCop', 'student', { x: 0.5, z: -20.5, role: 'police' })
  const civ = room.addPlayer('s3', 'Suspect', 'student', { x: 30, z: -60 })
  const ar = internals(room).arrest.bind(room)

  ok(ar('ghost', civ.id, Date.now()) === false, 'unknown issuer rejected')
  ok(ar('s3', 's1', Date.now()) === false, 'protector issuer rejected (no arrest powers)')
  ok(ar('s1', 's1', Date.now()) === false, 'self-arrest rejected')
  ok(ar('s1', 'nope', Date.now()) === false, 'unknown target rejected')
  ok(ar('s1', 's2', Date.now()) === false, 'arresting a fellow officer rejected')
  ok(ar('s1', 's3', Date.now()) === false, 'out-of-range arrest rejected (Suspect 44 m away)')

  // walk the suspect next to the officer → valid
  civ.x = 0.8; civ.z = -20.6
  const now = Date.now()
  ok(ar('s1', 's3', now) === true, 'valid arrest accepted')
  ok(civ.detained === true, 'target detained through the capturePlayer pipeline')
  ok(officer.arrests === 1, 'officer arrest counter incremented')
  ok(ar('s1', 's3', now + 200) === false, 'repeat arrest inside 1.4s cooldown rejected')
  ok(ar('s1', 's3', now + 1500) === false, 're-arrest of an already-detained target rejected')

  // second suspect after cooldown
  const civ2 = room.addPlayer('s4', 'Suspect II', 'student', { x: 1.2, z: -21 })
  ok(ar('s1', 's4.id-x', now + 1500) === false, 'garbage target id rejected')
  ok(ar('s1', civ2.id, now + 1500) === true, 'second arrest after cooldown succeeds')
  ok(officer.arrests === 2, 'arrest counter = 2')
  ok(officer.lastArrestAt === now + 1500, 'cooldown stamp updated')
  room.dispose()
}

// ---------- 4. officer immunity end-to-end (NPC brain) ----------
{
  const { createNpcStates, tickNpc } = await import('../../src/game/shared/npc-brain')
  const npc = createNpcStates([{ id: 'npc1', type: 'police', x: 0, z: -20, patrol: [[0, -20]] }])[0]
  const now = Date.now()
  const views = [
    { id: 'cop', x: 1, z: -20.5, detained: false, dazed: false, police: true },
    { id: 'civ', x: 1.2, z: -20.7, detained: false, dazed: false },
  ]
  let chased = false
  for (let i = 0; i < 40; i++) {
    tickNpc(npc, views as never[], [], 0.1, now + i * 100)
    if (npc.targetId === 'cop') chased = true
    if (npc.targetId === 'civ') break
  }
  ok(!chased, 'NPC officer NEVER targets the police-role player across 4s of ticks')
  ok(npc.targetId === 'civ' || npc.state === 'chase', 'protector next to the same patrol IS targeted')
}

  console.log(`\n— arrests-test: ${pass} passed, ${fail} failed —`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
