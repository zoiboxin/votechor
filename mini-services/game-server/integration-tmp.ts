// TEMPORARY deep integration test (throwaway, not a repo deliverable).
// Verifies: checkpoint, NPC capture + detention (accidental ×0.75) + frozen state,
// release at furthest checkpoint, token pickup, speed snap, vehicle damage,
// heal/revive validation, gate snap, ping/pong, throw relay, emote rate-limit,
// private rooms, playerleft on disconnect and on game:leave.
// Movement is SELF-CORRECTING: hops are computed from the last server snapshot,
// and captures/dazes en route are waited out (that's authentic game behavior).
import { io, type Socket } from 'socket.io-client'

const URL = 'http://localhost:3002'
let failures = 0
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`)
  if (!cond) failures++
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const connect = (): Promise<Socket> =>
  new Promise((res, rej) => {
    const s = io(URL, { transports: ['websocket', 'polling'], forceNew: true, timeout: 5000 })
    s.on('connect', () => res(s))
    s.on('connect_error', rej)
    setTimeout(() => rej(new Error('connect timeout')), 6000)
  })
const onceAll = (s: Socket, ev: string, ms: number): Promise<any[]> =>
  new Promise(resolve => {
    const t = setTimeout(() => resolve([]), ms)
    s.once(ev, (...args: any[]) => { clearTimeout(t); resolve(args) })
  })

const HOP = 12
const HOP_MS = 100

async function main() {
  const c1 = await connect()
  const c2 = await connect()
  const j1: any = await new Promise(res => { c1.once('game:joined', res); c1.emit('game:join', { name: 'Tester', archetype: 'accidental' }) })
  const j2: any = await new Promise(res => { c2.once('game:joined', res); c2.emit('game:join', { name: 'Buddy', archetype: 'student' }) })
  ok(j1.ok && j2.ok && j1.roomId === j2.roomId, `both joined the same room (${j1.roomId})`)
  ok(j1.boss && j1.boss.active === false && j1.boss.phase === 0 && Array.isArray(j1.boss.telegraphs), 'join ack includes dormant boss payload')
  const id1 = j1.playerId, id2 = j2.playerId

  // live state tracking
  let h2 = 100, dazed2 = false
  c2.on('game:health', (pid: string, hp: number, dz: boolean) => { if (pid === id2) { h2 = hp; dazed2 = dz } })
  let self: any = null
  c1.on('game:players', (ps: any[]) => { const me = ps.find(p => p.id === id1); if (me) self = me })
  let self2: any = null
  c2.on('game:players', (ps: any[]) => { const me = ps.find(p => p.id === id2); if (me) self2 = me })
  const checkpoints: any[] = []
  c1.on('game:checkpoint', (cp: number, by: string, total: number) => checkpoints.push({ cp, by, total }))
  const damages2: any[] = []
  c2.on('game:damage', (pid: string, amount: number, kind: string) => { if (pid === id2) damages2.push({ amount, kind }) })

  const busy = (p: any) => !p || p.detained || p.dazed

  /** Self-correcting walk: compute hops from the latest server snapshot. */
  const walkTo = async (who: 1 | 2, to: [number, number], maxMs = 90000) => {
    const sock = who === 1 ? c1 : c2
    const snap = () => (who === 1 ? self : self2)
    const t0 = Date.now()
    while (Date.now() - t0 < maxMs) {
      const s = snap()
      if (busy(s)) { await sleep(400); continue }
      const cx = s ? s.x : 0, cz = s ? s.z : -8
      const d = Math.hypot(to[0] - cx, to[1] - cz)
      if (d < 1.6) break
      const hop = Math.min(HOP, d)
      sock.emit('game:state', { x: cx + ((to[0] - cx) / d) * hop, y: 0, z: cz + ((to[1] - cz) / d) * hop, ry: 0, anim: 'run' })
      await sleep(HOP_MS)
    }
    await sleep(300)
  }

  // A. revive on non-dazed target must be rejected (no game:health for c2)
  c2.emit('game:state', { x: 0, y: 0, z: -9, ry: 0, anim: 'idle' })
  await sleep(300)
  c1.emit('game:revive', { targetId: id2 })
  const reviveEv = await onceAll(c2, 'game:health', 700)
  ok(reviveEv.length === 0, 'revive on non-dazed target rejected (no game:health)')

  // B. heal within 3m: c2 at full health → stays 100 (cap)
  c1.emit('game:heal', { targetId: id2 })
  const healEv = await onceAll(c2, 'game:health', 1500)
  ok(healEv[0] === id2 && healEv[1] === 100 && healEv[2] === false, `heal applied + capped at 100 (got ${healEv.slice(1).join(',')})`)

  // C. checkpoint 1
  await walkTo(1, [0, -78])
  ok(checkpoints.some(e => e.cp === 1 && e.by === 'Tester' && e.total === 1), `checkpoint 1 activated by Tester (${JSON.stringify(checkpoints)})`)

  // D. stand near npcA2 patrol → captured; detention 20s × 0.75 = 15s (accidental)
  // Filtered listener: wait specifically for c1's capture (c2 may be captured too — that's fine).
  const capPromise = (async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 60000) {
      const ev = await onceAll(c1, 'game:capture', 3000)
      if (ev.length && ev[0] === id1) return ev
    }
    return []
  })()
  await walkTo(1, [-6, -12])
  const cap = await capPromise
  ok(cap.length === 3 && cap[0] === id1, 'game:capture(playerId, until, message) received')
  const remain = cap.length ? (cap[1] - Date.now()) / 1000 : -1
  ok(remain > 8 && remain <= 16.5, `detention ≈15s for accidental archetype (${remain.toFixed(1)}s left)`)
  ok(cap.length === 3 && typeof cap[2] === 'string' && cap[2].length > 10, `capture message: "${cap[2] ?? ''}"`)

  // E. while detained: state updates ignored + snapshot shows detained
  c1.emit('game:state', { x: 30, y: 0, z: -30, ry: 0, anim: 'run' })
  await sleep(600)
  ok(self && self.detained === true, `snapshot shows detained=true during detention (detained=${self?.detained})`)
  ok(self && !(Math.abs(self.x - 30) < 0.01 && Math.abs(self.z - -30) < 0.01), `detained state updates ignored (pos ${self?.x},${self?.z})`)

  // I-parallel. c2 walks to the auto1 lane and sweeps it until vehicle damage.
  // Fully self-correcting: recovers from captures and resumes from actual position.
  const sweepDone = (async () => {
    const t0 = Date.now()
    let sweepZ = -292
    let up = true
    while (Date.now() - t0 < 150000 && damages2.length === 0) {
      const s = self2
      if (busy(s)) { await sleep(400); continue }
      const cx = s.x, cz = s.z
      const lane = Math.abs(cx - -12) < 3
      if (!lane) {
        // head toward lane entrance (-12,-292)
        const tx = -12, tz = -292
        const d = Math.hypot(tx - cx, tz - cz)
        const hop = Math.min(HOP, d)
        c2.emit('game:state', { x: cx + ((tx - cx) / d) * hop, y: 0, z: cz + ((tz - cz) / d) * hop, ry: 0, anim: 'run' })
      } else {
        // on the lane — sweep along z to cross the vehicle path
        sweepZ = up ? sweepZ + 5 : sweepZ - 5
        if (sweepZ >= -352) up = false
        if (sweepZ <= -292) up = true
        const d = Math.abs(sweepZ - cz)
        if (d > 20) {
          const hop = Math.min(HOP, d)
          c2.emit('game:state', { x: -12, y: 0, z: cz + Math.sign(sweepZ - cz) * hop, ry: 0, anim: 'run' })
        } else {
          c2.emit('game:state', { x: -12, y: 0, z: sweepZ, ry: 0, anim: 'run' })
        }
      }
      await sleep(HOP_MS)
    }
  })()

  // F. release at furthest activated checkpoint (cp1) detention point (10,-70)
  const rel = await onceAll(c1, 'game:release', 40000)
  ok(rel.length === 3 && rel[0] === id1 && Math.abs(rel[1] - 10) < 0.01 && Math.abs(rel[2] - -70) < 0.01,
    `released at cp1 detention (10,-70): got (${rel[1]},${rel[2]})`)
  await sleep(300)

  // G. token pickup
  await walkTo(1, [-26, -44])
  c1.emit('game:pickup', { itemId: 'A_tok_1' })
  const tok = await onceAll(c1, 'game:tokens', 3000)
  ok(tok[0] === 1, `token pickup → game:tokens(1) (got ${tok[0]})`)
  const itemsEv = await onceAll(c1, 'game:items', 3000)
  const tokItem = (itemsEv[0] as any[])?.find((i: any) => i.id === 'A_tok_1')
  ok(tokItem && tokItem.taken === true && tokItem.takenBy === id1, 'game:items shows A_tok_1 taken by Tester')

  // H. speed check: teleport attempt snaps back
  c1.emit('game:state', { x: 30, y: 0, z: 0, ry: 0, anim: 'run' })
  await sleep(400)
  ok(self && Math.abs(self.x - -26) < 0.05 && Math.abs(self.z - -44) < 0.05,
    `>25m jump snapped back to last valid pos (${self?.x},${self?.z})`)

  // I. vehicle damage assertions
  await sweepDone
  const dmgEv = damages2.length ? damages2[0] : null
  ok(!!dmgEv && dmgEv.amount === 35 && dmgEv.kind === 'auto', `vehicle damage (35,'auto') received (got ${JSON.stringify(dmgEv)})`)
  await sleep(400)
  ok(h2 === 65 && dazed2 === false, `server-tracked health after hit = 65 (got ${h2}, dazed=${dazed2})`)

  // J. meet at safe spot (-30,-450); heal c2: 65 + 30 = 95
  await Promise.all([walkTo(1, [-30, -450]), walkTo(2, [-30, -449])])
  c1.emit('game:heal', { targetId: id2 })
  const healEv2 = await onceAll(c2, 'game:health', 2000)
  ok(healEv2[1] === 95, `heal after damage: 65+30=95 (got ${healEv2[1]})`)

  // K. gate: corridor walk then attempt z=-490 → snapped to -477 while gate closed
  await walkTo(1, [0, -470])
  c1.emit('game:state', { x: 0, y: 0, z: -490, ry: 0, anim: 'run' })
  await sleep(400)
  ok(self && Math.abs(self.z - -477) < 0.01, `gate closed → z snapped to -477 (got ${self?.z})`)
  await walkTo(1, [24, -484]) // exit npcE2 vision

  // L. ping/pong
  c1.emit('game:ping', 12345)
  const pong2 = await onceAll(c1, 'game:pong', 2000)
  ok(pong2[0] === 12345, 'game:ping → game:pong echo')

  // M. throw relay + validation
  let projectiles = 0
  let lastProj: any = null
  c2.on('game:projectile', (p: any) => { projectiles++; lastProj = p })
  c1.emit('game:throw', { type: 'bottle', x: 1, y: 1, z: -20, vx: 5, vy: 3, vz: -2 })
  await sleep(500)
  ok(projectiles === 1 && lastProj?.owner === id1 && Math.abs(lastProj.vx - 5) < 0.01, 'valid throw relayed to room with owner')
  c1.emit('game:throw', { type: 'bottle', x: 1, y: 1, z: -20, vx: 50, vy: 0, vz: 0 })
  await sleep(600)
  ok(projectiles === 1, 'throw with |v|>=30 rejected (no relay)')

  // N. emote relay + rate limit (5/s), then quickmsg after the window clears
  let emotes = 0
  c2.on('game:emote', () => emotes++)
  for (let i = 0; i < 7; i++) { c1.emit('game:emote', { emote: 'wave' }); await sleep(30) }
  await sleep(400)
  ok(emotes === 5, `emote rate-limited to 5/s (got ${emotes})`)
  await sleep(1100) // let the rate window clear
  let quick = -1
  c2.on('game:quickmsg', (_pid: string, mid: number) => { quick = mid })
  c1.emit('game:quickmsg', { msgId: 9 })
  await sleep(300)
  ok(quick === 9, 'quickmsg 9 relayed')
  c1.emit('game:quickmsg', { msgId: 12 })
  await sleep(300)
  ok(quick === 9, 'quickmsg 12 (invalid) not relayed')

  // O. private room by code
  const c3 = await connect()
  const j3: any = await new Promise(res => { c3.once('game:joined', res); c3.emit('game:join', { name: 'Priv', roomCode: 'demo01' }) })
  ok(j3.ok && j3.roomId === 'pri_DEMO01' && j3.roomCode === 'DEMO01', `private room pri_DEMO01 joined via code 'demo01'`)
  c3.disconnect()

  // P. playerleft on disconnect + on game:leave
  const c4 = await connect()
  let left = 0
  const leftNames: string[] = []
  c2.on('game:playerleft', (_pid: string, name: string) => { left++; leftNames.push(name) })
  await new Promise(res => { c4.once('game:joined', res); c4.emit('game:join', { name: 'Dropper' }) })
  c4.disconnect()
  await sleep(600)
  const c5 = await connect()
  await new Promise(res => { c5.once('game:joined', res); c5.emit('game:join', { name: 'Leaver' }) })
  c5.emit('game:leave')
  await sleep(600)
  ok(left === 2, `playerleft emitted for both disconnect and leave (got ${left}: ${leftNames.join(',')})`)
  c5.disconnect()
  c1.disconnect()
  c2.disconnect()

  console.log('———————————————————————————')
  console.log(`INTEGRATION: ${failures} FAILURE(S)`)
  process.exit(failures ? 1 : 0)
}

main().catch(e => { console.error('INTEGRATION ERROR:', e.message); process.exit(1) })
