// Visual-QA helper: join a room, auto-accept any squad invite, log received
// gifts, and stay alive ~45s so a browser player can gift via the row button.
// Run: bun gift-buddy.ts <roomCode> [name]
import { io, type Socket } from 'socket.io-client'

const URL = 'http://localhost:3002'
const [room, name] = [process.argv[2] ?? 'INV10', process.argv[3] ?? 'GiftBuddy']

const bootGuard = setTimeout(() => { console.error('timeout'); process.exit(1) }, 8000)

const s: Socket = io(URL, { transports: ['websocket', 'polling'], forceNew: true, timeout: 5000 })
s.on('connect', () => s.emit('game:join', { name, archetype: 'student', roomCode: room }))
s.on('game:joined', (ack: { ok: boolean; playerId: string }) => {
  if (!ack.ok) { console.error('join failed'); process.exit(1) }
  clearTimeout(bootGuard)
  console.log(`joined ${room} as ${ack.playerId}`)
  s.on('game:squadInvite', (inv: { fromId: string; code: string }) => {
    console.log(`invite from ${inv.fromId} → cell ${inv.code} — accepting`)
    s.emit('game:squadInviteAccept', { fromId: inv.fromId })
  })
  s.on('game:squad', (sq: { code: string; members: { id: string; name: string }[] } | null) => {
    console.log(`roster: ${sq ? `${sq.code} [${sq.members.map((m) => m.name).join(', ')}]` : 'null'}`)
  })
  s.on('game:gift', (g: { fromName: string; type: string }) => console.log(`🎁 GIFT RECEIVED: ${g.type} from ${g.fromName}`))
  setTimeout(() => process.exit(0), 45000)
})
s.on('connect_error', (e: Error) => { console.error('connect_error', e.message); process.exit(1) })
