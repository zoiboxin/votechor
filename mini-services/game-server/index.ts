// VoteChor authoritative multiplayer game server (socket.io, port 3002).
// Imports shared pure logic via RELATIVE paths — no path aliases in mini-services.
import { createServer } from 'http'
import { Server } from 'socket.io'
import {
  ROOM_CAP,
  PLAYER_CAP,
  WORLD,
  Room,
} from './room'
import { TOKENS_NEEDED, ARCHETYPES } from '../../src/game/shared/constants'
import type { ProjectileNetState } from '../../src/game/shared/types'

const PORT = 3002
const ARCHETYPE_IDS = new Set(ARCHETYPES.map(a => a.id))

const httpServer = createServer()

const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Health endpoint: plain HTTP GET / (no ?EIO=...) → 200 'ok'.
// engine.io captures the 'request' listeners at attach time, so we re-wrap them:
// socket.io/engine.io traffic always carries the EIO query param; everything else is health.
{
  const engineListeners = httpServer.listeners('request').slice(0)
  httpServer.removeAllListeners('request')
  httpServer.on('request', (req, res) => {
    const url = req.url ?? '/'
    const isEngineIo = url.includes('EIO=')
    if (!isEngineIo) {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
      return
    }
    for (const l of engineListeners) (l as (r: unknown, s: unknown) => void)(req, res)
  })
}

// ---------- room registry ----------

const rooms = new Map<string, Room>()
const privateRooms = new Map<string, Room>() // code -> room
let pubCounter = 0

function totalPlayers(): number {
  let n = 0
  for (const r of rooms.values()) n += r.size
  return n
}

function createRoom(id: string, code: string, isPublic: boolean): Room {
  const room = new Room(io, id, code, isPublic)
  rooms.set(id, room)
  if (!isPublic && code) privateRooms.set(code, room)
  return room
}

function findPublicRoom(): Room {
  for (let i = 1; i <= pubCounter; i++) {
    const r = rooms.get(`pub_${i}`)
    if (r && r.size < ROOM_CAP) return r
  }
  pubCounter++
  return createRoom(`pub_${pubCounter}`, '', true)
}

function sanitizeCode(raw: unknown): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
}

function randomCode(): string {
  let c = ''
  while (c.length < 6) c += 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
  return c
}

/** Join (or create) a private room by 6-char code. Returns null if full. */
function findPrivateRoom(code: string): Room | null {
  const existing = privateRooms.get(code)
  if (existing) return existing.size < ROOM_CAP ? existing : null
  return createRoom(`pri_${code}`, code, false)
}

function leaveRoom(socketId: string) {
  const roomId = socketRooms.get(socketId)
  if (!roomId) return
  socketRooms.delete(socketId)
  const room = rooms.get(roomId)
  if (!room) return
  squadLeaveInternal(socketId) // remove from any squad, notify remaining members
  const player = room.removePlayer(socketId)
  if (player) {
    io.to(room.id).emit('game:playerleft', socketId, player.name)
  }
  if (room.size === 0) {
    room.dispose()
    rooms.delete(room.id)
    if (!room.isPublic && room.code) privateRooms.delete(room.code)
  }
}

// ---------- squads (§15 social — per-room protest cells of up to 4) ----------
const SQUAD_CAP = 4
const SQUAD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
interface Squad { code: string; members: Set<string> }
const roomSquads = new Map<string, Map<string, Squad>>() // roomId -> code -> squad
const socketSquad = new Map<string, { roomId: string; code: string }>() // socketId -> membership

function emitSquad(room: Room, squad: Squad) {
  const members = [...squad.members].map((id) => ({ id, name: room.getPlayer(id)?.name ?? 'Protester' }))
  const payload = { code: squad.code, members }
  for (const id of squad.members) io.to(id).emit('game:squad', payload)
}

/** Remove a socket from its squad (if any) and notify the remaining members. */
function squadLeaveInternal(socketId: string) {
  const membership = socketSquad.get(socketId)
  if (!membership) return
  socketSquad.delete(socketId)
  const room = rooms.get(membership.roomId)
  const squads = room ? roomSquads.get(membership.roomId) : undefined
  if (!room || !squads) return
  const squad = squads.get(membership.code)
  if (!squad) return
  squad.members.delete(socketId)
  if (squad.members.size === 0) {
    squads.delete(squad.code)
    if (squads.size === 0) roomSquads.delete(membership.roomId)
    return
  }
  emitSquad(room, squad)
}

// socketId -> roomId
const socketRooms = new Map<string, string>()

// ---------- connection handling ----------

io.on('connection', (socket) => {
  console.log(`[conn] ${socket.id} connected`)

  socket.on('game:join', (payload: { name?: unknown; archetype?: unknown; roomCode?: unknown } = {}) => {
    if (socketRooms.has(socket.id)) return // already joined
    if (totalPlayers() >= PLAYER_CAP) {
      socket.emit('game:joined', { ok: false, error: 'Server full' })
      return
    }

    const name = String(payload.name ?? '').trim().slice(0, 24) || 'Protester'
    const archetypeRaw = String(payload.archetype ?? 'student')
    const archetype = ARCHETYPE_IDS.has(archetypeRaw) ? archetypeRaw : 'student'

    let room: Room | null = null
    const code = sanitizeCode(payload.roomCode)
    if (code) {
      room = findPrivateRoom(code)
      if (!room) {
        socket.emit('game:joined', { ok: false, error: 'Room full' })
        return
      }
    } else {
      room = findPublicRoom()
    }

    socket.join(room.id)
    socketRooms.set(socket.id, room.id)
    const player = room.addPlayer(socket.id, name, archetype)

    socket.emit('game:joined', {
      ok: true,
      playerId: socket.id,
      roomId: room.id,
      roomCode: room.code,
      serverTime: Date.now(),
      players: room.playersArray(),
      npcs: room.npcsArray(),
      items: room.itemsArray(),
      checkpoints: [...room.checkpoints],
      tokensNeeded: TOKENS_NEEDED,
      tokensCollected: room.tokens,
      boss: room.bossPayload().boss,
      matchStartedAt: room.matchStartedAt,
    })
    socket.to(room.id).emit('game:playerjoined', socket.id, player.name)
    console.log(`[join] ${player.name}(${socket.id}) → ${room.id} (${room.size}/${ROOM_CAP})`)
  })

  socket.on('game:state', (s: Record<string, unknown> = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    room?.handleState(socket.id, s)
  })

  socket.on('game:pickup', (data: { itemId?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    room?.pickup(socket.id, data.itemId)
  })

  socket.on('game:throw', (data: Record<string, unknown> = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    if (!room) return
    const x = Number(data.x), y = Number(data.y), z = Number(data.z)
    const vx = Number(data.vx), vy = Number(data.vy), vz = Number(data.vz)
    if (![x, y, z, vx, vy, vz].every(Number.isFinite)) return
    if (Math.hypot(vx, vy, vz) >= 30) return // sanity: |v| < 30
    const proj: ProjectileNetState & { owner: string } = {
      id: `p_${Math.random().toString(36).slice(2, 10)}`,
      type: String(data.type ?? 'bottle').slice(0, 16),
      x, y, z, vx, vy, vz,
      owner: socket.id,
    }
    socket.to(room.id).emit('game:projectile', proj)
  })

  socket.on('game:noise', (data: { x?: unknown; z?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    room?.noise(socket.id, data.x, data.z)
  })

  socket.on('game:emote', (data: { emote?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    const p = room?.getPlayer(socket.id)
    if (!room || !p) return
    if (!room.rateLimit(p, 'emoteTimes')) return
    io.to(room.id).emit('game:emote', socket.id, String(data.emote ?? '').slice(0, 24))
  })

  socket.on('game:quickmsg', (data: { msgId?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    const p = room?.getPlayer(socket.id)
    if (!room || !p) return
    if (!room.rateLimit(p, 'emoteTimes')) return
    const msgId = Number(data.msgId)
    if (!Number.isInteger(msgId) || msgId < 0 || msgId > 9) return
    io.to(room.id).emit('game:quickmsg', socket.id, msgId)
  })

  socket.on('game:revive', (data: { targetId?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    room?.revive(socket.id, data.targetId)
  })

  // ---------- squad handlers ----------

  socket.on('game:squadCreate', () => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    if (!roomId || !room || !room.getPlayer(socket.id)) return
    squadLeaveInternal(socket.id) // leave any previous squad first
    let squads = roomSquads.get(roomId)
    if (!squads) { squads = new Map(); roomSquads.set(roomId, squads) }
    let code = ''
    do {
      code = ''
      for (let i = 0; i < 4; i++) code += SQUAD_ALPHABET[Math.floor(Math.random() * SQUAD_ALPHABET.length)]
    } while (squads.has(code))
    const squad: Squad = { code, members: new Set([socket.id]) }
    squads.set(code, squad)
    socketSquad.set(socket.id, { roomId, code })
    emitSquad(room, squad)
  })

  socket.on('game:squadJoin', (data: { code?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    if (!roomId || !room || !room.getPlayer(socket.id)) return
    const code = String(data.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
    const squad = roomSquads.get(roomId)?.get(code)
    if (!squad) { socket.emit('game:squadError', 'SQUAD_NOT_FOUND'); return }
    if (squad.members.has(socket.id)) { emitSquad(room, squad); return }
    if (squad.members.size >= SQUAD_CAP) { socket.emit('game:squadError', 'SQUAD_FULL'); return }
    squadLeaveInternal(socket.id)
    squad.members.add(socket.id)
    socketSquad.set(socket.id, { roomId, code })
    emitSquad(room, squad)
  })

  socket.on('game:squadLeave', () => {
    squadLeaveInternal(socket.id)
    socket.emit('game:squad', null)
  })

  socket.on('game:heal', (data: { targetId?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    room?.heal(socket.id, data.targetId)
  })

  socket.on('game:gift', (data: { targetId?: unknown; type?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    // rejected gifts (bad type / rate limit / too far / self) are refunded client-side
    if (!room || !room.gift(socket.id, data.targetId, data.type)) {
      socket.emit('game:giftRefund', { type: String(data.type ?? '') })
    }
  })

  socket.on('game:giftBounce', (data: { targetId?: unknown; type?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    room?.giftBounce(socket.id, data.targetId, data.type)
  })

  socket.on('game:bossHit', () => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    room?.bossHit(socket.id)
  })

  socket.on('game:bossBallot', () => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    room?.bossBallot(socket.id)
  })

  socket.on('game:bossDeposit', () => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    room?.bossDeposit(socket.id)
  })

  socket.on('game:ping', (sentAt: unknown) => {
    socket.emit('game:pong', sentAt)
  })

  socket.on('game:leave', () => {
    leaveRoom(socket.id)
  })

  socket.on('disconnect', () => {
    leaveRoom(socket.id)
    console.log(`[conn] ${socket.id} disconnected`)
  })

  socket.on('error', (err: unknown) => {
    console.error(`[err] ${socket.id}:`, err)
  })
})

httpServer.listen(PORT, () => {
  console.log(`VoteChor game server on :${PORT} — world ${WORLD.bounds.minX}..${WORLD.bounds.maxX} x / ${WORLD.bounds.minZ}..${WORLD.bounds.maxZ} z, ${WORLD.npcs.length} npcs, ${WORLD.items.length} items`)
})

// ---------- graceful shutdown ----------

let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[shutdown] ${signal} received, closing server...`)
  for (const room of rooms.values()) room.dispose()
  io.close(() => {
    httpServer.close(() => {
      console.log('[shutdown] closed')
      process.exit(0)
    })
  })
  // Fallback force-exit if connections hang
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
