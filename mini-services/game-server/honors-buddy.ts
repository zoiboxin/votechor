// VoteChor honors-visual buddy: joins a room, logs kudos + auto-votes MVP.
// Used by browser QA to exercise the EndScreen Match Honors card live.
// Run: bun honors-buddy.ts <ROOM> <NAME> <LIVE_SECONDS>
import { io, type Socket } from 'socket.io-client'

const URL = 'http://localhost:3002'
const ROOM = process.argv[2] ?? 'HON11'
const NAME = process.argv[3] ?? 'HonorsBuddy'
const LIVE_MS = Number(process.argv[4] ?? 120000)

const s: Socket = io(URL, { transports: ['websocket', 'polling'], forceNew: true, timeout: 5000 })
let myId = ''
let otherId = ''

s.on('connect', () => {
  s.emit('game:join', { name: NAME, archetype: 'journalist', roomCode: ROOM })
})

s.on('game:joined', (ack: { ok: boolean; playerId: string; players: { id: string }[] }) => {
  if (ack.ok) {
    myId = ack.playerId
    otherId = ack.players.find((p) => p.id !== myId)?.id ?? ''
    console.log(`BUDDY-JOINED ${NAME} (${myId}) in ${ROOM} other=${otherId || 'none'}`)
  }
})

s.on('game:players', (players: { id: string }[]) => {
  if (!otherId) otherId = players.find((p) => p.id !== myId)?.id ?? ''
})

s.on('game:kudos', (k: { fromName: string }) => {
  console.log(`BUDDY-KUDOS from ${k.fromName}`)
})

s.on('game:mvpTally', (t: { voters: number; roomPlayers: number }) => {
  console.log(`BUDDY-TALLY ${t.voters}/${t.roomPlayers}`)
  if (otherId) {
    s.emit('game:mvpVote', { targetId: otherId })
    console.log(`BUDDY-VOTED for ${otherId}`)
  }
})

s.on('game:mvpFinal', (f: { winnerName: string | null }) => {
  console.log(`BUDDY-FINAL winner=${f.winnerName ?? 'none'}`)
})

s.on('disconnect', () => console.log('BUDDY-DISCONNECT'))

setTimeout(() => {
  console.log('BUDDY-EXIT')
  s.disconnect()
  process.exit(0)
}, LIVE_MS)
