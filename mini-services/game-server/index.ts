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
import { SeasonManager } from './season'
import type { SeasonInfo } from './season'
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
const seasonManager = new SeasonManager(io, rooms)
let pubCounter = 0

function totalPlayers(): number {
  // Only real socket-backed players count against the global cap — season bots are free.
  let n = 0
  for (const r of rooms.values()) n += r.humansCount()
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
  dropAllInvitesFor(socketId) // pending invites die with either endpoint
  const player = room.removePlayer(socketId)
  dropMvpVote(socketId, roomId) // retract the departed voter's MVP ballot (after removal → accurate room count)
  if (player) {
    io.to(room.id).emit('game:playerleft', socketId, player.name)
  }
  if (seasonManager.get(roomId)) {
    // Season: bots keep the world alive — a backfill bot walks in, retirement
    // happens only after the last human has been gone for the grace period.
    seasonManager.get(roomId)!.onHumanLeft()
    return
  }
  if (room.size === 0) {
    const mvpState = roomMvpVotes.get(room.id)
    if (mvpState?.timer) clearTimeout(mvpState.timer)
    roomMvpVotes.delete(room.id)
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

// ---------- squad invites (§15 — direct invite → accept/decline, 20s expiry) ----------
const INVITE_TTL_MS = 20_000
interface PendingInvite { code: string; fromName: string; expires: number }
const pendingInvites = new Map<string, Map<string, PendingInvite>>() // targetSocketId -> inviterSocketId -> invite

function dropInvite(targetId: string, fromId: string) {
  const invs = pendingInvites.get(targetId)
  if (!invs) return
  invs.delete(fromId)
  if (invs.size === 0) pendingInvites.delete(targetId)
}

/** Remove every pending invite involving a socket (as target or as inviter) — used on leave/disconnect. */
function dropAllInvitesFor(socketId: string) {
  const invs = pendingInvites.get(socketId)
  if (invs) {
    invs.clear()
    pendingInvites.delete(socketId)
  }
  for (const [targetId, map] of pendingInvites) {
    if (map.delete(socketId) && map.size === 0) pendingInvites.delete(targetId)
  }
}

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

/** Put a socket into a fresh squad in their room and broadcast the roster. */
function squadCreateInternal(socketId: string, roomId: string, room: Room) {
  squadLeaveInternal(socketId)
  let squads = roomSquads.get(roomId)
  if (!squads) { squads = new Map(); roomSquads.set(roomId, squads) }
  let code = ''
  do {
    code = ''
    for (let i = 0; i < 4; i++) code += SQUAD_ALPHABET[Math.floor(Math.random() * SQUAD_ALPHABET.length)]
  } while (squads.has(code))
  const squad: Squad = { code, members: new Set([socketId]) }
  squads.set(code, squad)
  socketSquad.set(socketId, { roomId, code })
  emitSquad(room, squad)
  return squad
}

type JoinResult = 'ok' | 'already' | 'SQUAD_NOT_FOUND' | 'SQUAD_FULL'

/** Put a socket into the squad `code` of their room and broadcast the roster. */
function squadJoinInternal(socketId: string, roomId: string, room: Room, code: string): JoinResult {
  const squad = roomSquads.get(roomId)?.get(code)
  if (!squad) return 'SQUAD_NOT_FOUND'
  if (squad.members.has(socketId)) { emitSquad(room, squad); return 'already' }
  if (squad.members.size >= SQUAD_CAP) return 'SQUAD_FULL'
  squadLeaveInternal(socketId)
  squad.members.add(socketId)
  socketSquad.set(socketId, { roomId, code })
  emitSquad(room, squad)
  return 'ok'
}

// ---------- post-match honors (§15 — kudos + MVP voting) ----------
interface MvpVoteState { votes: Map<string, string>; timer: ReturnType<typeof setTimeout> | null }
const MVP_VOTE_WINDOW_MS = 15_000
const roomMvpVotes = new Map<string, MvpVoteState>() // roomId -> vote state

function mvpTallyPayload(room: Room, state: MvpVoteState) {
  const counts = new Map<string, number>()
  for (const targetId of state.votes.values()) counts.set(targetId, (counts.get(targetId) ?? 0) + 1)
  const tally = [...counts.entries()]
    .map(([id, votes]) => ({ id, name: room.getPlayer(id)?.name ?? 'Protester', votes }))
    .sort((a, b) => b.votes - a.votes)
  return { tally, voters: state.votes.size, roomPlayers: room.humansCount() }
}

function finalizeMvp(roomId: string) {
  const room = rooms.get(roomId)
  const state = roomMvpVotes.get(roomId)
  if (!room || !state) return
  if (state.timer) { clearTimeout(state.timer); state.timer = null }
  const { tally, voters } = mvpTallyPayload(room, state)
  const top = tally[0]
  const winner = top
    ? tally.filter((t) => t.votes === top.votes)[Math.floor(Math.random() * tally.filter((t) => t.votes === top.votes).length)]
    : null
  roomMvpVotes.delete(roomId)
  io.to(room.id).emit('game:mvpFinal', {
    winnerId: winner?.id ?? null,
    winnerName: winner?.name ?? null,
    tally, voters,
  })
}

/** Register/re-register an MVP vote and broadcast the live tally. */
function castMvpVote(room: Room, voterId: string, targetId: string) {
  let state = roomMvpVotes.get(room.id)
  if (!state) {
    state = { votes: new Map(), timer: null }
    roomMvpVotes.set(room.id, state)
    state.timer = setTimeout(() => finalizeMvp(room.id), MVP_VOTE_WINDOW_MS)
    state.timer.unref?.()
  }
  state.votes.set(voterId, targetId)
  io.to(room.id).emit('game:mvpTally', mvpTallyPayload(room, state))
  if (state.votes.size >= room.humansCount()) finalizeMvp(room.id) // every human voted → instant verdict
}

/** Remove a departing voter's ballot and refresh the tally (vote session survives). */
function dropMvpVote(socketId: string, knownRoomId?: string) {
  const roomId = knownRoomId ?? socketRooms.get(socketId)
  if (!roomId) return
  const state = roomMvpVotes.get(roomId)
  if (!state || !state.votes.has(socketId)) return
  state.votes.delete(socketId)
  const room = rooms.get(roomId)
  if (room && roomMvpVotes.has(roomId)) {
    io.to(room.id).emit('game:mvpTally', mvpTallyPayload(room, state))
  }
}

// socketId -> roomId
const socketRooms = new Map<string, string>()

// ---------- connection handling ----------

io.on('connection', (socket) => {
  console.log(`[conn] ${socket.id} connected`)

  socket.on('game:join', (payload: { name?: unknown; archetype?: unknown; roomCode?: unknown; season?: unknown } = {}) => {
    if (socketRooms.has(socket.id)) return // already joined
    if (totalPlayers() >= PLAYER_CAP) {
      socket.emit('game:joined', { ok: false, error: 'Server full' })
      return
    }

    const name = String(payload.name ?? '').trim().slice(0, 24) || 'Protester'
    const archetypeRaw = String(payload.archetype ?? 'student')
    const archetype = ARCHETYPE_IDS.has(archetypeRaw) ? archetypeRaw : 'student'

    let room: Room | null = null
    let seasonInfo: SeasonInfo | undefined
    const code = sanitizeCode(payload.roomCode)
    const wantsSeason = payload.season === true && !code
    if (wantsSeason) {
      // Solo queue → persistent Season: liveliest season with room, else a new one.
      const season = seasonManager.assign()
      room = season.room
    } else if (code) {
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

    if (wantsSeason) {
      // One bot steps aside, bots top back up to SEASON_CAP — all BEFORE the ack
      // so the joiner instantly sees the full 100-protester roster.
      const season = seasonManager.get(room.id)! 
      season.onHumanJoined()
      seasonInfo = season.info()
    }
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
      season: seasonInfo ?? null,
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
    squadCreateInternal(socket.id, roomId, room)
  })

  socket.on('game:squadJoin', (data: { code?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    if (!roomId || !room || !room.getPlayer(socket.id)) return
    const code = String(data.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
    const res = squadJoinInternal(socket.id, roomId, room, code)
    if (res === 'SQUAD_NOT_FOUND') socket.emit('game:squadError', 'SQUAD_NOT_FOUND')
    if (res === 'SQUAD_FULL') socket.emit('game:squadError', 'SQUAD_FULL')
  })

  socket.on('game:squadLeave', () => {
    squadLeaveInternal(socket.id)
    socket.emit('game:squad', null)
  })

  // ---------- squad invite handlers (§15) ----------

  socket.on('game:squadInvite', (data: { targetId?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    const me = room?.getPlayer(socket.id)
    if (!roomId || !room || !me) return
    const targetId = String(data.targetId ?? '')
    const target = room.getPlayer(targetId)
    if (!targetId || targetId === socket.id || !socketRooms.has(targetId) || socketRooms.get(targetId) !== roomId || !target) {
      socket.emit('game:squadInviteError', { targetId, reason: 'TARGET_NOT_FOUND' })
      return
    }
    if (!room.rateLimit(me, 'inviteTimes')) return // silent: spam guard
    // auto-create a cell on first invite so the flow needs zero preparation
    let membership = socketSquad.get(socket.id)
    if (!membership || membership.roomId !== roomId) {
      const squad = squadCreateInternal(socket.id, roomId, room)
      membership = { roomId, code: squad.code }
    }
    const squad = roomSquads.get(roomId)?.get(membership.code)
    if (!squad) return
    if (squad.members.size >= SQUAD_CAP) {
      socket.emit('game:squadInviteError', { targetId, reason: 'SQUAD_FULL' })
      return
    }
    if (squad.members.has(targetId)) {
      socket.emit('game:squadInviteError', { targetId, reason: 'ALREADY_IN_CELL' })
      return
    }
    const expires = Date.now() + INVITE_TTL_MS
    let invs = pendingInvites.get(targetId)
    if (!invs) { invs = new Map(); pendingInvites.set(targetId, invs) }
    invs.set(socket.id, { code: squad.code, fromName: me.name, expires })
    setTimeout(() => dropInvite(targetId, socket.id), INVITE_TTL_MS + 500).unref()
    io.to(targetId).emit('game:squadInvite', { fromId: socket.id, fromName: me.name, code: squad.code })
    socket.emit('game:squadInviteSent', { targetId, targetName: target.name })
  })

  socket.on('game:squadInviteAccept', (data: { fromId?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    if (!roomId || !room || !room.getPlayer(socket.id)) return
    const fromId = String(data.fromId ?? '')
    const invite = pendingInvites.get(socket.id)?.get(fromId)
    if (!invite || invite.expires <= Date.now()) {
      dropInvite(socket.id, fromId)
      socket.emit('game:squadInviteError', { targetId: fromId, reason: 'INVITE_EXPIRED' })
      return
    }
    dropInvite(socket.id, fromId)
    const res = squadJoinInternal(socket.id, roomId, room, invite.code)
    if (res === 'SQUAD_FULL') {
      socket.emit('game:squadInviteError', { targetId: fromId, reason: 'SQUAD_FULL' })
      return
    }
    if (res === 'ok') {
      io.to(fromId).emit('game:squadInviteAccepted', { byId: socket.id, byName: room.getPlayer(socket.id)?.name ?? 'Protester' })
    }
  })

  socket.on('game:squadInviteDecline', (data: { fromId?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    if (!roomId || !room) return
    const fromId = String(data.fromId ?? '')
    const invite = pendingInvites.get(socket.id)?.get(fromId)
    if (!invite) return
    dropInvite(socket.id, fromId)
    io.to(fromId).emit('game:squadInviteDeclined', { byId: socket.id, byName: room.getPlayer(socket.id)?.name ?? 'Protester' })
  })

  socket.on('game:kudos', (data: { targetId?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    const me = room?.getPlayer(socket.id)
    if (!room || !me) return
    const targetId = String(data.targetId ?? '')
    const target = targetId === socket.id ? undefined : room.getPlayer(targetId)
    if (!target || socketRooms.get(targetId) !== roomId) return
    if (!room.rateLimit(me, 'kudosTimes')) return // silent: spam guard
    io.to(targetId).emit('game:kudos', { fromId: socket.id, fromName: me.name })
    socket.emit('game:kudosSent', { targetId, targetName: target.name })
  })

  socket.on('game:mvpVote', (data: { targetId?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    if (!room || !room.getPlayer(socket.id)) return
    const targetId = String(data.targetId ?? '')
    if (targetId === socket.id) {
      socket.emit('game:mvpError', { reason: 'SELF_VOTE' })
      return
    }
    if (targetId.startsWith('bot_')) return // bots are not MVP candidates
    const target = room.getPlayer(targetId)
    if (!target || socketRooms.get(targetId) !== roomId) {
      socket.emit('game:mvpError', { reason: 'TARGET_LEFT' })
      return
    }
    castMvpVote(room, socket.id, targetId)
  })

  socket.on('game:heal', (data: { targetId?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    room?.heal(socket.id, data.targetId)
  })

  socket.on('game:gift', (data: { targetId?: unknown; type?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    // Bots carry nothing and own nothing — refund immediately so the client restores the item.
    if (typeof data.targetId === 'string' && data.targetId.startsWith('bot_')) {
      socket.emit('game:giftRefund', { type: String(data.type ?? '') })
      return
    }
    // rejected gifts (bad type / rate limit / too far / self) are refunded client-side
    if (!room || !room.gift(socket.id, data.targetId, data.type)) {
      socket.emit('game:giftRefund', { type: String(data.type ?? '') })
    }
  })

  socket.on('game:giftBounce', (data: { targetId?: unknown; type?: unknown } = {}) => {
    const roomId = socketRooms.get(socket.id)
    const room = roomId ? rooms.get(roomId) : undefined
    if (typeof data.targetId === 'string' && data.targetId.startsWith('bot_')) return
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
