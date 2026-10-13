// Visual-QA helper: join a room and squad-invite a target (used to render the
// invite flyer inside a live browser session). Run: bun invite-visual.ts <room> <targetId>
import { io, type Socket } from 'socket.io-client'

const URL = 'http://localhost:3002'
const [room, targetId] = [process.argv[2], process.argv[3]]

if (!room || !targetId) {
  console.error('usage: bun invite-visual.ts <roomCode> <targetSocketId>')
  process.exit(1)
}

const bootGuard = setTimeout(() => { console.error('timeout'); process.exit(1) }, 8000)

const s = io(URL, { transports: ['websocket', 'polling'], forceNew: true, timeout: 5000 })
s.on('connect', () => {
  s.emit('game:join', { name: 'FlyerCourier', archetype: 'student', roomCode: room })
})
s.on('game:joined', (ack: { ok: boolean; playerId: string }) => {
  if (!ack.ok) { console.error('join failed'); process.exit(1) }
  clearTimeout(bootGuard)
  setTimeout(() => {
    s.emit('game:squadInvite', { targetId })
    console.log(`invite sent → ${targetId} from ${ack.playerId} (staying connected 25s for the accept window)`)
    // stay online so the invite stays valid; also watch for the acceptance
    s.on('game:squadInviteAccepted', (s2: { byName: string }) => console.log(`ACCEPTED by ${s2.byName}`))
    s.on('game:squadInviteDeclined', (s2: { byName: string }) => console.log(`DECLINED by ${s2.byName}`))
    s.on('game:squad', (sq: { code: string; members: unknown[] } | null) => console.log(`roster: ${sq ? `${sq.code} ${sq.members.length}/4` : 'null'}`))
    setTimeout(() => process.exit(0), 25000)
  }, 600)
})
s.on('connect_error', (e: Error) => { console.error('connect_error', e.message); process.exit(1) })
setTimeout(() => { console.error('timeout'); process.exit(1) }, 8000)
