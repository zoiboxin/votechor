// VoteChor police-strike test — round 25: baton hit (F) + WANTED banner correctness.
//
// Coverage map (honest):
//   • UNIT (no sockets, Room driven via typed casts — same harness as arrests/confiscate):
//       - POLICE_STRIKE constants mirror the NPC officer baton (dmg 13, range 2.6).
//       - strike() validation matrix:
//           × unknown issuer            × protector issuer (no baton powers)
//           × self-strike               × unknown / garbage target id
//           × striking a fellow officer × out of range (>2.6 m + grace)
//           × spam gate (1.1 s)         × detained target        × dazed target
//           ✓ valid strike → target.health drops by 13, room broadcast game:damage
//             (kind 'police') + game:health + game:strike(from, target, x, z)
//           ✓ 0 hp strike → target dazed (same rule as the NPC melee)
//           ✓ cooldown window passes → second strike succeeds
//       - npcsArray() carries `target` while an officer is chasing (WANTED correctness).
//   • CLIENT (pure sim, no WebGL): NpcSystem.applyServerState + nearestChaserDistance
//       - a chase targeting bot_1 does NOT register for 'me' (no WANTED banner for
//         bystanders or police-role players), and DOES for bot_1.
//   • NOT covered live: socket client pressing F (browser QA covers the flow).
//
// Run: bun police-hit-test.ts
import { Room, WORLD, playerNet } from './room'
import type { Server as SocketIOServer } from 'socket.io'

let pass = 0
let fail = 0
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ FAIL: ${label}`) }
}

interface EmitLogEntry { to: string; event: string; args: unknown[] }
function recordingIo(log: EmitLogEntry[]): SocketIOServer {
  return {
    to: (room: string) => ({ emit: (event: string, ...args: unknown[]) => { log.push({ to: room, event, args }) } }),
  } as unknown as SocketIOServer
}

function internals(room: Room) {
  return room as unknown as {
    strike: (issuerId: string, targetId: unknown, now: number) => boolean
    npcsArray: () => Array<{ id: string; state: string; target?: string }>
    npcs: Array<{ id: string; state: string; targetId: string | null }>
  }
}

async function main() {

const SPAWN = WORLD.spawn

// ---------- 0. constants sanity ----------
{
  const { POLICE_STRIKE, POLICE_ATTACK } = await import('../../src/game/shared/constants')
  ok(POLICE_STRIKE.dmg === POLICE_ATTACK.dmgByType.police, 'POLICE_STRIKE.dmg matches the NPC officer baton (13)')
  ok(POLICE_STRIKE.range === POLICE_ATTACK.strikeRange, 'POLICE_STRIKE.range matches the NPC strike reach (2.6 m)')
  ok(POLICE_STRIKE.cooldownMs > 0 && POLICE_STRIKE.cooldownMs < PLAYER_ROLE_COOLDOWN(), 'strike cooldown faster than arrest cooldown (swing then cuff)')
}
function PLAYER_ROLE_COOLDOWN(): number {
  // tiny local mirror to keep the import list short
  return 1400
}

// ---------- 1. strike validation matrix ----------
{
  const log: EmitLogEntry[] = []
  const room = new Room(recordingIo(log), 'ph1', 'PH1', false)
  const officer = room.addPlayer('s1', 'Officer', 'student', { x: 0, z: -20, role: 'police' })
  const ally = room.addPlayer('s2', 'AllyCop', 'student', { x: 0.5, z: -20.5, role: 'police' })
  const civ = room.addPlayer('s3', 'Runner', 'student', { x: 30, z: -60 })
  const strike = internals(room).strike.bind(room)

  ok(strike('ghost', civ.id, Date.now()) === false, 'unknown issuer rejected')
  ok(strike('s3', 's1', Date.now()) === false, 'protector issuer rejected (no baton powers)')
  ok(strike('s1', 's1', Date.now()) === false, 'self-strike rejected')
  ok(strike('s1', 'nope', Date.now()) === false, 'unknown target rejected')
  ok(strike('s1', 'x;DROP TABLE', Date.now()) === false, 'garbage target id rejected')
  ok(strike('s1', 's2', Date.now()) === false, 'striking a fellow officer rejected')
  ok(strike('s1', civ.id, Date.now()) === false, 'out-of-range strike rejected (Runner 44 m away)')

  // walk the runner into lathi reach → valid
  civ.x = 1.4; civ.z = -20.8
  const before = civ.health
  const now = Date.now()
  ok(strike('s1', civ.id, now) === true, 'valid strike accepted')
  ok(civ.health === before - 13, `target lost exactly 13 hp (${before} → ${civ.health})`)
  ok(log.some(e => e.event === 'game:damage' && e.args[0] === civ.id && e.args[1] === 13 && e.args[2] === 'police'), 'room broadcast game:damage(target, 13, police)')
  ok(log.some(e => e.event === 'game:strike' && e.args[0] === 's1' && e.args[1] === civ.id), 'room broadcast game:strike(issuer, target, x, z)')
  ok(log.some(e => e.event === 'game:health' && e.args[0] === civ.id), 'room broadcast game:health sync')

  ok(strike('s1', civ.id, now + 300) === false, 'second strike inside 1.1s cooldown rejected')
  ok(officer.lastStrikeAt === now, 'cooldown stamp updated')

  // second swing after cooldown
  ok(strike('s1', civ.id, now + 1200) === true, 'second strike after cooldown succeeds')
  ok(civ.health === before - 26, 'damage stacks (26 total)')

  // detained + dazed targets are off-limits
  civ.dazed = true
  ok(strike('s1', civ.id, now + 2400) === false, 'dazed target rejected (no beating the downed)')
  civ.dazed = false
  civ.detained = true
  ok(strike('s1', civ.id, now + 2400) === false, 'detained target rejected')
  civ.detained = false

  // 0 hp → dazed (same rule as the NPC melee)
  civ.health = 10
  ok(strike('s1', civ.id, now + 3600) === true, 'strike on a nearly-downed runner accepted')
  ok(civ.health === 0 && (civ as { dazed: boolean }).dazed === true, '0 hp strike leaves the target dazed (not detained)')

  // role in the join ack
  ok(playerNet(officer, true).role === 'police', 'officer role rides playerNet(full)')
  room.dispose()
}

// ---------- 2. npcsArray carries the chase target ----------
{
  const room = new Room(recordingIo([]), 'ph2', 'PH2', false)
  room.addPlayer('s1', 'Quarry', 'student', { x: SPAWN.x, z: SPAWN.z })
  const it = internals(room)
  const npc = it.npcs[0]
  npc.state = 'chase'
  npc.targetId = 's1'
  const arr = it.npcsArray()
  const me = arr.find(n => n.id === npc.id)
  ok(me?.target === 's1', 'chasing NPC snapshot carries target=s1 (WANTED correctness)')
  npc.state = 'patrol'
  npc.targetId = null
  const arr2 = it.npcsArray().find(n => n.id === npc.id)
  ok(arr2?.target === undefined, 'patrolling NPC snapshot omits target (payload stays small)')
  room.dispose()
}

// ---------- 3. client nearestChaserDistance is target-aware ----------
{
  // CharacterRig draws canvas textures at construction — bun has no DOM, so shim
  // createElement with an everything-absorbing Proxy (no rendering happens in tests).
  if (typeof (globalThis as Record<string, unknown>).document === 'undefined') {
    const noop = () => {}
    ;(globalThis as Record<string, unknown>).document = {
      createElement: () => new Proxy({}, {
        get: (_t, p) => {
          if (p === 'getContext') return () => new Proxy({}, { get: () => noop, set: () => true })
          if (p === 'style') return {}
          if (p === 'width' || p === 'height') return 8
          return noop
        },
        set: () => true,
      }),
    }
  }
  const { buildWorldDef } = await import('../../src/game/shared/world-def')
  const { NpcSystem } = await import('../../src/game/npcs')
  const world = buildWorldDef()
  const sys = new NpcSystem(world, {} as never, 'low')
  const npcId = world.npcs.find(n => n.type === 'police')?.id ?? world.npcs[0].id
  sys.applyServerState([
    { id: npcId, x: 10, z: 10, ry: 0, state: 'chase', alert: 1, target: 'bot_1' },
  ])
  const dQuarry = sys.nearestChaserDistance(10, 11, 'bot_1')
  const dBystander = sys.nearestChaserDistance(10, 11, 'me')
  const dPolice = sys.nearestChaserDistance(10, 11, 'some-cop-player')
  ok(dQuarry < 5, `bot_1 IS the quarry → sees the chase (${dQuarry.toFixed(1)} m)`)
  ok(dBystander > 1e8, `'me' is NOT the quarry → no WANTED banner (bystander / police-role screen stays clean)`)
  ok(dPolice > 1e8, 'unrelated player id also sees nothing')
}

  console.log(`\n— police-hit-test: ${pass} passed, ${fail} failed —`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
