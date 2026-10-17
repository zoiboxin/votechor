// VoteChor combat protocol test — Phase 5 police melee + Phase 6 release points + Phase 3/10 movement sanity.
//
// Coverage map (honest):
//   • UNIT (no sockets, direct logic calls):
//       - tickNpc FSM: wind-up start / no early hit / exactly-one landed hit (amount 13 police) /
//         dodge (target left during wind-up) / cooldown gate / wall LOS blocks the strike /
//         weakened-target capture at 2× rate / no capture accrual while winding up.
//       - Room.npcsArray: anim/attackAt populated only inside the wind-up / stagger windows.
//       - Room.handleState: altitude clamp (y ≤ 14) + >18 m/tick teleport snap.
//       - pickReleasePoint: validity, anti-repeat, 30 m squadmate filter, fallbacks.
//   • LIVE (real server :3002):
//       - Solo SEASON client: game:npcs snapshots are type-tolerant (anim ∈ allowed set when
//         present, attackAt finite when present).
//       - Private-room client walks to a police patrol and camps: chase → 'windup' snapshot with
//         attackAt → game:damage (amount 13, kind 'police') → game:capture → 15 s detention
//         (accidental archetype) → game:release carrying the NEW additive 4th `label` arg with
//         coords matching a validated RELEASE_POINTS entry (z < -60, outside the boss arena).
//   • NOT covered live: squadmate-proximity release filtering (needs a scripted second squad
//     member mid-detention — covered at unit level instead via pickReleasePoint).
//
// Run: bun combat-test.ts
import { io, type Socket } from 'socket.io-client'
import { createNpcStates, tickNpc, type NpcBrainState, type NpcPlayerView } from '../../src/game/shared/npc-brain'
import { Room, RELEASE_POINTS, WORLD, pickReleasePoint } from './room'
import { POLICE_ATTACK } from '../../src/game/shared/constants'
import type { Server as SocketIOServer } from 'socket.io'
import type { NpcNetState, PlayerNetState } from '../../src/game/shared/types'

const URL = 'http://localhost:3002'
let pass = 0
let fail = 0
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ FAIL: ${label}`) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const T = 1_000_000 // fixed epoch for FSM tests

/** Fresh police brain in chase mode with a locked target. */
function chaseNpc(type = 'police'): NpcBrainState {
  const n = createNpcStates([{ id: 'npc1', type: type as 'police', x: 0, z: 0, patrol: [[0, 0], [1, 1]] }])[0]
  n.state = 'chase'
  n.targetId = 'p1'
  n.alert = 1
  return n
}
const view = (x: number, z: number, health = 100, extra: Partial<NpcPlayerView> = {}): NpcPlayerView =>
  ({ id: 'p1', x, z, detained: false, dazed: false, health, ...extra })

/** Fake socket.io server — Room only calls io.to(room).emit, which we swallow. */
function fakeIo(): SocketIOServer {
  return { to: () => ({ emit: () => {} }) } as unknown as SocketIOServer
}

async function main() {
  console.log('— Combat protocol test (Phase 5 melee · Phase 6 releases · movement sanity) —')

  // ================= 0. UNIT — tickNpc police melee FSM =================
  console.log('— unit: tickNpc melee FSM —')
  {
    // (a) target 1.5 m in chase → wind-up starts, NO hit before windupSec
    const n = chaseNpc()
    let r = tickNpc(n, [view(0, -1.5)], [], 0.1, T)
    ok(r.events.length === 0 && n.attackTelegraphUntil === T + POLICE_ATTACK.windupSec * 1000,
      `wind-up starts at chaseAttackRange (telegraph +${n.attackTelegraphUntil - T}ms, 0 events)`)
    r = tickNpc(n, [view(0, -1.5)], [], 0.1, T + 300)
    ok(r.events.length === 0 && n.attackTelegraphUntil > T + 300,
      'no hit lands before the wind-up deadline (0.3s of 0.55s elapsed)')

    // (b) wind-up elapses with target still close → exactly one hit, amount 13 (police)
    r = tickNpc(n, [view(0, -1.5)], [], 0.1, T + 600)
    const hits = r.events.filter((e) => e.kind === 'hit')
    ok(hits.length === 1 && hits[0].playerId === 'p1' && hits[0].amount === POLICE_ATTACK.dmgByType.police,
      `strike lands exactly one 'hit' event with amount 13 (got ${JSON.stringify(r.events)})`)
    ok(n.attackTelegraphUntil === 0 && n.nextAttackAt === T + 600 + POLICE_ATTACK.cooldownSec * 1000,
      'telegraph cleared + cooldown set after the strike')
    ok(n.staggerUntil === T + 600 + 350, 'stagger window set for 0.35s after the landed strike')

    // (c) target moves 6 m away during the wind-up → strike whiffs (no hit)
    const n2 = chaseNpc()
    tickNpc(n2, [view(0, -1.5)], [], 0.1, T) // wind-up starts
    r = tickNpc(n2, [view(0, -7.5)], [], 0.1, T + 600) // target dodged far during wind-up
    ok(r.events.length === 0 && n2.attackTelegraphUntil === 0 && n2.nextAttackAt === T + 600 + 400,
      'dodged target: no hit, telegraph cleared, 0.4s re-attack delay')
  }
  {
    // (d) second attack attempt within cooldownSec → no immediate wind-up
    const n = chaseNpc()
    tickNpc(n, [view(0, -1.5)], [], 0.1, T)
    tickNpc(n, [view(0, -1.5)], [], 0.1, T + 600) // strike #1 lands
    const r = tickNpc(n, [view(0, -1.5)], [], 0.1, T + 700) // inside the 1.5s cooldown
    ok(r.events.length === 0 && n.attackTelegraphUntil === 0,
      'no new wind-up while the per-NPC melee cooldown is active')
  }
  {
    // (e) wall collider between npc and target → wind-up starts but the strike never lands
    const n = chaseNpc()
    const wall = [{ minX: -2, minY: 0, minZ: -1.2, maxX: 2, maxY: 3, maxZ: -0.8 }] // slab across the 0→-1.5 segment
    tickNpc(n, [view(0, -1.5)], wall, 0.1, T) // wind-up starts (acquire was pre-validated server-side)
    const r = tickNpc(n, [view(0, -1.5)], wall, 0.1, T + 600)
    ok(r.events.filter((e) => e.kind === 'hit').length === 0 && n.attackTelegraphUntil === 0 && n.nextAttackAt === T + 600 + 400,
      'hit never passes through a wall (LOS re-validated at strike time)')
  }
  {
    // (f) weakened target (health 20 < 30) → capture hold accrues at 2× (0.225s effective)
    const ticksTo = (health: number) => {
      const n = chaseNpc()
      n.nextAttackAt = T + 60_000 // suppress melee so the capture path runs
      for (let i = 0; i < 8; i++) {
        const r = tickNpc(n, [view(0, -1.2, health)], [], 0.1, T + i * 100)
        if (r.events.some((e) => e.kind === 'capture')) return i + 1
      }
      return -1
    }
    const weak = ticksTo(20)
    const healthy = ticksTo(100)
    ok(weak > 0 && weak <= 3, `weakened target (20 hp) captured within 3 ticks (${weak})`)
    ok(healthy > weak, `healthy target takes strictly longer (${healthy} ticks vs ${weak}) — 2× rate holds`)
  }
  {
    // (g) attack OR capture — never both: no capture accrual while a wind-up is pending
    const n = chaseNpc()
    tickNpc(n, [view(0, -1.2)], [], 0.1, T) // wind-up starts (in capture radius!)
    for (let i = 0; i < 5; i++) tickNpc(n, [view(0, -1.2)], [], 0.1, T + 100 + i * 100)
    ok(n.captureProgress === 0, 'captureProgress stays 0 while the wind-up is pending')
  }

  // ================= 1. UNIT — npcsArray telegraph fields =================
  console.log('— unit: Room.npcsArray anim/attackAt —')
  {
    const room = new Room(fakeIo(), 'unitroom', '', false)
    const n = room.npcs[0] // npcA1, police
    n.state = 'chase'
    n.targetId = 'p1'
    n.attackTelegraphUntil = Date.now() + 400
    let snap = room.npcsArray().find((s) => s.id === n.id)!
    ok(snap.anim === 'windup' && snap.attackAt === n.attackTelegraphUntil,
      'pending telegraph → anim "windup" + attackAt = strike landing time')
    n.attackTelegraphUntil = Date.now() - 1
    n.staggerUntil = Date.now() + 200
    snap = room.npcsArray().find((s) => s.id === n.id)!
    ok(snap.anim === 'stagger' && snap.attackAt === undefined,
      'stagger window → anim "stagger", no attackAt')
    n.staggerUntil = Date.now() - 1
    snap = room.npcsArray().find((s) => s.id === n.id)!
    ok(!('anim' in snap) && !('attackAt' in snap),
      'idle npc carries NO anim/attackAt fields (payload stays small)')
    room.dispose()
  }

  // ================= 2. UNIT — movement sanity (handleState) =================
  console.log('— unit: handleState altitude + teleport guards —')
  {
    const room = new Room(fakeIo(), 'unitroom2', '', false)
    const p = room.addPlayer('sock1', 'Mover', 'student')
    room.handleState('sock1', { x: 3, y: 500, z: -10 })
    ok(p.y === 14, `impossible altitude clamped to 14 (got ${p.y})`)
    const bx = p.x, bz = p.z
    room.handleState('sock1', { x: bx + 25, y: 0, z: bz }) // >18 m/tick
    ok(p.x === bx && p.z === bz, '>18 m/tick horizontal teleport snapped back to last accepted pos')
    room.handleState('sock1', { x: bx + 5, y: 0, z: bz })
    ok(p.x === bx + 5, 'legit 5 m move accepted')
    room.dispose()
  }

  // ================= 3. UNIT — pickReleasePoint (Phase 6) =================
  console.log('— unit: pickReleasePoint —')
  {
    const arena = WORLD.bossArena
    const draw = (last: string | null, squad: Array<{ x: number; z: number }> = [], n = 60) =>
      Array.from({ length: n }, () => pickReleasePoint(last, squad))
    const byId = new Map(RELEASE_POINTS.map((p) => [p.id, p]))
    // validity: every draw is a validated point, z < -60, outside the boss arena
    const all = draw(null, [])
    ok(all.every((pt) => byId.has(pt.id) && pt.z < -60 && Math.hypot(pt.x - arena.x, pt.z - arena.z) > arena.radius),
      `all draws are validated release points (z < -60, outside boss arena) — ${RELEASE_POINTS.length} points live`)
    // anti-repeat
    ok(draw('rel_market_heart').every((pt) => pt.id !== 'rel_market_heart'),
      'anti-repeat: lastReleaseId is never picked while alternatives exist')
    // squadmate 30 m filter (squadmate camping the plaza gate point)
    const plaza = byId.get('rel_plaza_gate')!
    const filtered = draw(null, [{ x: plaza.x, z: plaza.z }])
    ok(filtered.every((pt) => pt.id !== 'rel_plaza_gate' && Math.hypot(pt.x - plaza.x, pt.z - plaza.z) >= 30),
      '30 m squadmate filter holds while ≥2 alternatives remain')
    // fallback: squadmates camp EVERY point → filter relaxes instead of returning spawn
    const camped = RELEASE_POINTS.map((pt) => ({ x: pt.x, z: pt.z }))
    ok(draw(null, camped).every((pt) => byId.has(pt.id)),
      'fallback: fully-camped board still releases to a real point (never spawn)')
  }

  // ================= 4. LIVE — season snapshots carry the fields (type-tolerant) =================
  console.log('— live: season npc snapshot fields —')
  {
    const s = await connect()
    const joinAck = await joinRoom(s, { season: true })
    ok(joinAck.ok === true, 'solo season join ack ok')
    let snaps = 0
    let animBad = ''
    let attackAtBad = false
    const onNpcs = (list: NpcNetState[]) => {
      snaps++
      for (const e of list) {
        if ('anim' in e && e.anim !== undefined && !['idle', 'walk', 'run', 'windup', 'stagger'].includes(e.anim)) animBad = String(e.anim)
        if ('attackAt' in e && e.attackAt !== undefined && !(typeof e.attackAt === 'number' && Number.isFinite(e.attackAt))) attackAtBad = true
      }
    }
    s.on('game:npcs', onNpcs)
    await sleep(2500)
    s.off('game:npcs', onNpcs)
    ok(snaps > 10, `season streams npc snapshots (${snaps} in 2.5s)`)
    ok(animBad === '' && !attackAtBad, 'npc snapshot anim/attackAt fields are type-tolerant (no bad values seen)')
    s.emit('game:leave')
    s.disconnect()
  }

  // ================= 5. LIVE — full melee → capture → random release flow =================
  console.log('— live: police melee → capture → Phase 6 release (private room, deterministic) —')
  {
    const s = await connect()
    const ack = await joinRoom(s, { roomCode: 'CMBT1', archetype: 'accidental' }) // accidental → 15s detention
    ok(ack.ok === true, 'private room join ack ok')
    const me = String(ack.playerId ?? '')

    let sawChase = false
    let windupCount = 0
    let windupAttackAt = 0
    const damages: Array<{ amount: number; kind: string }> = []
    let captured = false
    let detainUntil = 0
    let release: { x: number; z: number; label: string } | null = null
    const releaseRef = (): { x: number; z: number; label: string } | null => release // defeats TS closure narrowing (assigned in socket callbacks)
    let releasedPosInSnapshots = false

    s.on('game:npcs', (list: NpcNetState[]) => {
      for (const e of list) {
        if (e.state === 'chase') sawChase = true
        if (e.anim === 'windup' && typeof e.attackAt === 'number' && e.attackAt > Date.now() - 100) {
          windupCount++
          windupAttackAt = e.attackAt
        }
      }
    })
    s.on('game:damage', (id: string, amount: number, kind: string) => {
      if (id === me) damages.push({ amount, kind })
    })
    s.on('game:capture', (id: string, until: number) => {
      if (id === me) { captured = true; detainUntil = until }
    })
    s.on('game:release', (id: string, x: number, z: number, label: string) => {
      if (id === me) release = { x, z, label }
    })
    s.on('game:players', (list: PlayerNetState[]) => {
      const r = release
      if (!r) return
      const mine = list.find((e) => e.id === me)
      if (mine && Math.hypot(mine.x - r.x, mine.z - r.z) < 0.6) releasedPosInSnapshots = true
    })

    // walk spawn (0,-8) → market road (0,-118), camping npcB1's patrol lane.
    // The plaza patrol (npcA1) walks mostly between/through randomly-placed buildings
    // (LOS is often blocked), but the market road (|x| < 5.8) is guaranteed open:
    // stalls sit at |x| ≥ 5.8 (maxY 2.4 → they DO block, but never across the road)
    // and carts (maxY 1.5) don't block sight at all. Steps are < 18 m apart.
    const tx = 0, tz = -118
    const steps = 10
    for (let i = 1; i <= steps; i++) {
      s.emit('game:state', { x: (0 + ((tx - 0) * i) / steps), y: 0, z: (-8 + ((tz + 8) * i) / steps), ry: Math.PI, anim: 'walk' })
      await sleep(85)
    }
    // camp: police detects → chases → wind-up → hit → capture (accidental: 15s detention)
    const captureDeadline = Date.now() + 14_000
    while (Date.now() < captureDeadline && !captured) await sleep(200)
    ok(sawChase, 'police npc entered chase state (game:npcs)')
    ok(windupCount > 0, `wind-up telegraph seen live (${windupCount}× snapshots with anim "windup", attackAt=${windupAttackAt})`)
    ok(damages.length > 0 && damages.every((d) => d.kind === 'police' && d.amount === POLICE_ATTACK.dmgByType.police),
      `game:damage received: ${JSON.stringify(damages)} (amount 13, kind 'police')`)
    ok(captured && detainUntil > 0, 'game:capture received (camped player detained)')
    // detention (15 s for the accidental archetype) → Phase 6 random release
    const releaseDeadline = Date.now() + 20_000
    while (Date.now() < releaseDeadline && !release) await sleep(200)
    const r = releaseRef()
    ok(!!r, 'game:release received after detention')
    if (r) {
      const match = RELEASE_POINTS.find((pt) => pt.x === r.x && pt.z === r.z && pt.label === r.label)
      ok(!!match, `release coords + label match a validated RELEASE_POINTS entry (${r.label} @ ${r.x},${r.z})`)
      ok(r.z < -60 && Math.hypot(r.x - WORLD.bossArena.x, r.z - WORLD.bossArena.z) > WORLD.bossArena.radius,
        'release point is z < -60 and outside the boss arena')
    }
    // wait for a snapshot AFTER the release to confirm the server-side teleport stuck
    await sleep(1500)
    ok(releasedPosInSnapshots, 'player snapshot places the released player at the release point')
    s.emit('game:leave')
    s.disconnect()
  }

  console.log(`\n${pass} pass, ${fail} fail`)
  process.exit(fail > 0 ? 1 : 0)
}

// ---- helpers (mirrors season-test.ts style) ----

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, timeout: 5000 })
    s.on('connect', () => resolve(s))
    s.on('connect_error', (e: Error) => reject(e))
  })
}

interface JoinAck {
  ok: boolean
  playerId?: string
  roomId?: string
  error?: string
}
function joinRoom(s: Socket, opts: { season?: boolean; roomCode?: string | null; archetype?: string }): Promise<JoinAck> {
  return new Promise((resolve) => {
    const onAck = (ack: JoinAck) => { s.off('game:joined', onAck); resolve(ack) }
    s.on('game:joined', onAck)
    s.emit('game:join', { name: 'CombatTest', archetype: opts.archetype ?? 'student', roomCode: opts.roomCode ?? null, season: opts.season === true })
  })
}

main().catch((e) => { console.error('fatal:', e); process.exit(1) })
