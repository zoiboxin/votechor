// VoteChor confiscation test — BUSTED penalty: detention wipes collections & cards.
//
// Coverage map (honest):
//   • UNIT (no sockets, Room driven via typed private-method casts):
//       - capturePlayer: personal tokens → 0, global count decremented, ONLY the
//         detainee's taken tokens re-scatter (takenBy filter), game:capture carries
//         the additive 4th `lostTokens` arg, capture with no tokens emits no game:tokens.
//       - confiscateInventory: rejected when not detained; spawns a drop ring at the
//         authoritative position (game:dropped); whitelist + 'token' filter + INVENTORY_MAX
//         cap; all-invalid list does NOT burn the one-shot; a second call for the same
//         detention is rejected.
//       - pickup(): dynamic drop pickup (distance-validated, game:dropTaken emitted,
//         drop removed); far pickup rejected; static item pickup regression.
//       - tick(): expired drops → game:dropGone, live drops untouched.
//       - resetMatch(): drops cleared with game:dropGone, tokens/detention reset.
//   • NOT covered live: a real socket client walking into police (already proven by
//     combat-test.ts LIVE capture flow — same capturePlayer path runs server-side).
//
// Run: bun confiscate-test.ts
import { Room, WORLD } from './room'
import type { Server as SocketIOServer } from 'socket.io'

let pass = 0
let fail = 0
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ FAIL: ${label}`) }
}

type Emit = { event: string; args: unknown[] }
/** Fake socket.io server that records every room broadcast. */
function recordingIo(): { io: SocketIOServer; emits: Emit[] } {
  const emits: Emit[] = []
  const io = {
    to: () => ({ emit: (event: string, ...args: unknown[]) => { emits.push({ event, args }) } }),
  } as unknown as SocketIOServer
  return { io, emits }
}

/** Casts to reach Room internals — test-only, keeps capturePlayer private in prod code. */
function internals(room: Room) {
  return room as unknown as {
    capturePlayer: (playerId: string, now: number) => void
    tick: () => void
    resetMatch: () => void
  }
}

const TOKEN_IDS = WORLD.items.filter(i => i.type === 'token').map(i => i.id)
const TOKEN_AT = new Map(WORLD.items.filter(i => i.type === 'token').map(i => [i.id, i]))
const CHAI = WORLD.items.find(i => i.type === 'chai')

/** Walk a player to (x, z) in ≤15 m hops (handleState rejects >18 m teleports). */
function walkTo(room: Room, id: string, tx: number, tz: number) {
  const p = room.getPlayer(id)!
  const sx = p.x, sz = p.z // snapshot — p mutates as handleState applies each hop
  const dist = Math.hypot(tx - sx, tz - sz)
  const hops = Math.max(1, Math.ceil(dist / 15))
  for (let i = 1; i <= hops; i++) {
    const x = sx + ((tx - sx) * i) / hops
    const z = sz + ((tz - sz) * i) / hops
    room.handleState(id, { x, y: 0, z, ry: 0, anim: 'run' })
  }
}

async function main() {
  console.log('— Confiscation protocol test (BUSTED: detention wipes collections & cards) —')
  ok(TOKEN_IDS.length >= 12, `world has ${TOKEN_IDS.length} tokens (need ≥12)`)

  // ================= 1. capture with tokens → full confiscation =================
  {
    const { io, emits } = recordingIo()
    const room = new Room(io, 'r1', 'R1', false)
    const p1 = room.addPlayer('s1', 'Victim', 'student', { x: TOKEN_AT.get('A_tok_1')!.x, z: TOKEN_AT.get('A_tok_1')!.z })
    ok(room.pickup('s1', 'A_tok_1'), 'pickup token 1')
    walkTo(room, 's1', TOKEN_AT.get('B_tok_1')!.x, TOKEN_AT.get('B_tok_1')!.z)
    ok(room.pickup('s1', 'B_tok_1'), 'pickup token 2 (after walking there)')
    walkTo(room, 's1', TOKEN_AT.get('B_tok_2')!.x, TOKEN_AT.get('B_tok_2')!.z)
    ok(room.pickup('s1', 'B_tok_2'), 'pickup token 3 (after walking there)')
    ok(room.tokens === 3 && p1.tokens === 3, 'personal + global counts = 3 after pickups')
    ok((room.itemStates.get('A_tok_1')!.taken) === true, 'token 1 marked taken')

    const emitsBeforeCapture = emits.length
    internals(room).capturePlayer('s1', Date.now())
    const capEmits = emits.slice(emitsBeforeCapture)
    ok(p1.detained && p1.tokens === 0, 'detained → personal tokens wiped')
    ok(room.tokens === 0, 'global team count decremented by the confiscation')
    ok(!room.itemStates.get('A_tok_1')!.taken && !room.itemStates.get('B_tok_1')!.taken && !room.itemStates.get('B_tok_2')!.taken, 'all 3 confiscated tokens re-hidden in the world')
    const cap = capEmits.find(e => e.event === 'game:capture')
    ok(!!cap && cap.args[0] === 's1' && cap.args[3] === 3, 'game:capture carries additive lostTokens=3')
    ok(capEmits.some(e => e.event === 'game:tokens' && e.args[0] === 0), 'game:tokens broadcast the new count')
    ok(capEmits.some(e => e.event === 'game:items'), 'game:items re-broadcast (token states changed)')
    room.dispose()
  }

  // ================= 2. only the detainee's tokens re-scatter =================
  {
    const { io } = recordingIo()
    const room = new Room(io, 'r2', 'R2', false)
    const t1 = TOKEN_AT.get('A_tok_1')!
    const t2 = TOKEN_AT.get('A_tok_2')!
    const p1 = room.addPlayer('s1', 'Victim', 'student', { x: t1.x, z: t1.z })
    const p2 = room.addPlayer('s2', 'Bystander', 'student', { x: t2.x, z: t2.z })
    room.pickup('s1', 'A_tok_1')
    room.pickup('s2', 'A_tok_2')
    internals(room).capturePlayer('s1', Date.now())
    ok(p1.tokens === 0 && room.tokens === 1, 'only the victim\'s contribution leaves the global count')
    ok(!room.itemStates.get('A_tok_1')!.taken, 'victim token re-hidden')
    ok(room.itemStates.get('A_tok_2')!.taken && room.itemStates.get('A_tok_2')!.takenBy === 's2', 'bystander token stays taken')
    ok(!p2.detained, 'bystander untouched')
    room.dispose()
  }

  // ================= 3. capture with no tokens → lostTokens 0, no game:tokens =================
  {
    const { io, emits } = recordingIo()
    const room = new Room(io, 'r3', 'R3', false)
    room.addPlayer('s1', 'Broke', 'student', { x: 0, z: 0 })
    const emitsBeforeCapture = emits.length
    internals(room).capturePlayer('s1', Date.now())
    const capEmits = emits.slice(emitsBeforeCapture)
    const cap = capEmits.find(e => e.event === 'game:capture')
    ok(!!cap && cap.args[3] === 0, 'capture without tokens → lostTokens=0')
    ok(!capEmits.some(e => e.event === 'game:tokens'), 'no game:tokens spam on a broke capture')
    ok(!capEmits.some(e => e.event === 'game:items'), 'no game:items on a broke capture')
    room.dispose()
  }

  // ================= 4. confiscateInventory validation =================
  {
    const { io, emits } = recordingIo()
    const room = new Room(io, 'r4', 'R4', false)
    const p1 = room.addPlayer('s1', 'Lootbag', 'student', { x: WORLD.spawn.x, z: WORLD.spawn.z })
    ok(!room.confiscateInventory('s1', ['chai', 'snack']), 'rejected: player not detained')

    internals(room).capturePlayer('s1', Date.now())
    ok(!room.confiscateInventory('s1', ['token', 'nuclear_launch_code']), 'rejected: all types invalid (one-shot NOT burned)')
    ok(room.confiscateInventory('s1', ['bottle', 'sign', 'chai', 'firstaid', 'snack', 'foam', 'joke', 'token', 'chai', 'chai']), 'accepted once detained')
    const dropped = emits.filter(e => e.event === 'game:dropped')
    ok(dropped.length === 1, 'exactly one game:dropped broadcast')
    const drops = dropped[0].args[0] as { id: string; type: string; x: number; y: number; z: number; expiresAt: number }[]
    ok(drops.length === 7, `7 unique valid types survive the cap + whitelist (got ${drops.length})`)
    ok(drops.every(d => d.type !== 'token'), 'tokens never drop as loot')
    const cx = WORLD.spawn.x, cz = WORLD.spawn.z
    const insideCollider = (x: number, z: number) => WORLD.colliders.some(c =>
      x > c.minX - 0.25 && x < c.maxX + 0.25 && z > c.minZ - 0.25 && z < c.maxZ + 0.25)
    ok(drops.every(d => Math.hypot(d.x - cx, d.z - cz) <= 2.3 && !insideCollider(d.x, d.z)), 'drop ring hugs the capture spot, all walkable')
    ok(drops.every(d => d.expiresAt > Date.now()), 'drops carry a future expiry')
    ok(room.droppedItems.size === 7, 'server map holds all drops')
    ok(!room.confiscateInventory('s1', ['chai']), 'rejected: second confiscation for the same detention')
    void p1
    room.dispose()
  }

  // ================= 5. drop pickup =================
  {
    const { io, emits } = recordingIo()
    const room = new Room(io, 'r5', 'R5', false)
    const p1 = room.addPlayer('s1', 'Lootbag', 'student', { x: 10, z: 10 })
    const p2 = room.addPlayer('s2', 'Savior', 'student', { x: 15, z: 10 })
    internals(room).capturePlayer('s1', Date.now())
    ok(room.confiscateInventory('s1', ['chai', 'snack']), 'victim confiscates 2 items')
    const drops = (emits.find(e => e.event === 'game:dropped')!.args[0] as { id: string }[])
    ok(drops.length === 2, '2 drops spawned')
    const id = drops[0].id
    ok(!room.pickup('s2', id), 'far pickup rejected (outside PICKUP_RADIUS)')
    // walk the savior to the pile (5 m — under the 18 m teleport guard), then grab
    room.handleState('s2', { x: 10.5, y: 0, z: 10.5, ry: 0, anim: 'idle' })
    ok(room.pickup('s2', id), 'savior picks up the confiscated loot near the pile')
    ok(!room.droppedItems.has(id), 'drop removed from the server map')
    const taken = emits.find(e => e.event === 'game:dropTaken')
    ok(!!taken && taken.args[0] === id && taken.args[1] === 's2', 'game:dropTaken(id, byId) broadcast')
    void p2
    room.dispose()
  }

  // ================= 6. static item pickup still works (regression) =================
  {
    const { io, emits } = recordingIo()
    const room = new Room(io, 'r6', 'R6', false)
    const chai = CHAI!
    room.addPlayer('s1', 'Thirsty', 'student', { x: chai.x, z: chai.z })
    ok(room.pickup('s1', chai.id), 'static chai pickup still valid')
    const st = room.itemStates.get(chai.id)!
    ok(st.taken && typeof st.respawnAt === 'number', 'chai marked taken with a respawn deadline')
    ok(emits.some(e => e.event === 'game:items'), 'game:items broadcast for static pickup')
    room.dispose()
  }

  // ================= 7. TTL expiry via tick =================
  {
    const { io, emits } = recordingIo()
    const room = new Room(io, 'r7', 'R7', false)
    const p1 = room.addPlayer('s1', 'Lootbag', 'student', { x: 10, z: 10 })
    internals(room).capturePlayer('s1', Date.now())
    room.confiscateInventory('s1', ['chai', 'snack'])
    const ids = [...room.droppedItems.keys()]
    // age one drop past its TTL, keep the other fresh
    const fresh = room.droppedItems.get(ids[1])!
    room.droppedItems.get(ids[0])!.expiresAt = Date.now() - 1
    internals(room).tick()
    ok(!room.droppedItems.has(ids[0]) && room.droppedItems.has(ids[1]), 'expired drop removed, fresh drop kept')
    const gone = emits.find(e => e.event === 'game:dropGone')
    ok(!!gone && Array.isArray(gone.args[0]) && (gone.args[0] as string[]).includes(ids[0]), 'game:dropGone carries expired ids')
    void fresh
    room.dispose()
  }

  // ================= 8. resetMatch clears drops + detention state =================
  {
    const { io, emits } = recordingIo()
    const room = new Room(io, 'r8', 'R8', false)
    const p1 = room.addPlayer('s1', 'Lootbag', 'student', { x: 10, z: 10 })
    internals(room).capturePlayer('s1', Date.now())
    room.confiscateInventory('s1', ['chai'])
    ok(room.droppedItems.size === 1 && p1.detained, 'pre-reset: drop on ground, player detained')
    internals(room).resetMatch()
    ok(room.droppedItems.size === 0, 'drops cleared on match reset')
    ok(!p1.detained && p1.tokens === 0 && p1.confiscatedFor === 0, 'detention + counters reset')
    ok(emits.some(e => e.event === 'game:dropGone'), 'clients told to clear drop visuals')
    room.dispose()
  }

  // ================= 9. drop positions never inside colliders =================
  {
    const { io } = recordingIo()
    const room = new Room(io, 'r9', 'R9', false)
    // park the victim right against a building corner — ring nudges must stay walkable
    const wall = WORLD.colliders[0]
    const px = wall.minX - 0.2, pz = wall.minZ - 0.2
    room.addPlayer('s1', 'Cornered', 'student', { x: px, z: pz })
    internals(room).capturePlayer('s1', Date.now())
    ok(room.confiscateInventory('s1', ['chai', 'snack', 'bottle', 'foam']), 'confiscated at a corner spot')
    const insideCollider = (x: number, z: number) => WORLD.colliders.some(c =>
      x > c.minX - 0.25 && x < c.maxX + 0.25 && z > c.minZ - 0.25 && z < c.maxZ + 0.25)
    const bad = [...room.droppedItems.values()].filter(d => insideCollider(d.x, d.z))
    ok(bad.length === 0, `no drop landed inside a collider (${bad.length} bad of ${room.droppedItems.size})`)
    room.dispose()
  }

  console.log(`\n— confiscate-test: ${pass} passed, ${fail} failed —`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
