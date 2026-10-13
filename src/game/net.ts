// VoteChor networking client — socket.io protocol wrapper for the game server.
'use client'
import { io, type Socket } from 'socket.io-client'
import type {
  AnimName, BossNetState, ItemNetState, MatchEndPayload, NpcNetState, PlayerNetState,
} from './shared/types'

export interface JoinPayload {
  name: string
  archetype: string
  roomCode: string | null
  cosmetics?: Record<string, unknown>
}

export interface JoinAck {
  ok: boolean
  error?: string
  playerId: string
  roomId: string
  roomCode: string
  serverTime: number
  players: PlayerNetState[]
  npcs: NpcNetState[]
  items: ItemNetState[]
  checkpoints: number[]
  tokensNeeded: number
  tokensCollected: number
  boss: BossNetState | null
  matchStartedAt: number
}

export type NetEvents = {
  onJoinAck: (ack: JoinAck) => void
  onPlayers: (players: PlayerNetState[]) => void
  onNpcs: (npcs: NpcNetState[]) => void
  onItems: (items: ItemNetState[]) => void
  onBoss: (boss: BossNetState, ballots: { id: string; x: number; z: number; taken: boolean }[]) => void
  onCapture: (playerId: string, until: number, message: string) => void
  onRelease: (playerId: string, x: number, z: number) => void
  onCheckpoint: (checkpointId: number, byName: string, total: number) => void
  onProjectile: (p: { id: string; type: string; x: number; y: number; z: number; vx: number; vy: number; vz: number }) => void
  onEmote: (playerId: string, emote: string) => void
  onQuickMsg: (playerId: string, msgId: number) => void
  onPlayerLeft: (playerId: string, name: string) => void
  onPlayerJoined: (playerId: string, name: string) => void
  onHealth: (playerId: string, health: number, dazed: boolean) => void
  onDamage: (playerId: string, amount: number, kind: string) => void
  onMatchEnd: (payload: MatchEndPayload) => void
  onTokens: (count: number) => void
  onGate: (open: boolean) => void
  onSquad: (squad: { code: string; members: { id: string; name: string }[] } | null) => void
  onSquadError: (reason: 'SQUAD_NOT_FOUND' | 'SQUAD_FULL') => void
  onSquadInvite: (inv: { fromId: string; fromName: string; code: string }) => void
  onSquadInviteSent: (s: { targetId: string; targetName: string }) => void
  onSquadInviteAccepted: (s: { byId: string; byName: string }) => void
  onSquadInviteDeclined: (s: { byId: string; byName: string }) => void
  onSquadInviteError: (s: { targetId: string; reason: 'TARGET_NOT_FOUND' | 'SQUAD_FULL' | 'ALREADY_IN_CELL' | 'INVITE_EXPIRED' }) => void
  onGift: (g: { fromId: string; fromName: string; type: string }) => void
  onGiftBounce: (g: { toId: string; toName: string; type: string }) => void
  onGiftRefund: (type: string) => void
  onKudos: (k: { fromId: string; fromName: string }) => void
  onKudosSent: (k: { targetId: string; targetName: string }) => void
  onMvpTally: (t: { tally: { id: string; name: string; votes: number }[]; voters: number; roomPlayers: number }) => void
  onMvpFinal: (f: { winnerId: string | null; winnerName: string | null; tally: { id: string; name: string; votes: number }[]; voters: number }) => void
  onMvpError: (e: { reason: 'SELF_VOTE' | 'TARGET_LEFT' }) => void
  onDisconnect: () => void
  onConnect: () => void
  onPing: (ms: number) => void
}

export class NetClient {
  socket: Socket | null = null
  connected = false
  playerId = ''
  ping = 0
  ev: Partial<NetEvents> = {}
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private lastPingSent = 0

  connect(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        // Never put the port in the URL path — Caddy gateway uses XTransformPort
        const socket = io('/?XTransformPort=3002', {
          transports: ['websocket', 'polling'],
          forceNew: true,
          reconnection: true,
          // keep retrying for as long as the match is running — the reconnect
          // overlay lets the player quit or fall back to offline sim instead
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 3000,
          timeout: 6000,
        })
        this.socket = socket
        const timeout = setTimeout(() => {
          if (!this.connected) { socket.disconnect(); this.socket = null; resolve(false) }
        }, 7000)
        socket.on('connect', () => {
          this.connected = true
          clearTimeout(timeout)
          this.startPing()
          this.ev.onConnect?.()
          resolve(true)
        })
        socket.on('disconnect', () => { this.connected = false; this.ev.onDisconnect?.() })
        socket.on('connect_error', () => { /* handled by timeout */ })
        socket.on('game:joined', (ack: JoinAck) => { if (ack.ok) this.playerId = ack.playerId; this.ev.onJoinAck?.(ack) })
        socket.on('game:players', (p: PlayerNetState[]) => this.ev.onPlayers?.(p))
        socket.on('game:npcs', (n: NpcNetState[]) => this.ev.onNpcs?.(n))
        socket.on('game:items', (i: ItemNetState[]) => this.ev.onItems?.(i))
        socket.on('game:boss', (b: BossNetState, ballots: { id: string; x: number; z: number; taken: boolean }[]) => this.ev.onBoss?.(b, ballots))
        socket.on('game:capture', (playerId: string, until: number, message: string) => this.ev.onCapture?.(playerId, until, message))
        socket.on('game:release', (playerId: string, x: number, z: number) => this.ev.onRelease?.(playerId, x, z))
        socket.on('game:checkpoint', (cp: number, byName: string, total: number) => this.ev.onCheckpoint?.(cp, byName, total))
        socket.on('game:projectile', (p: { id: string; type: string; x: number; y: number; z: number; vx: number; vy: number; vz: number }) => this.ev.onProjectile?.(p))
        socket.on('game:emote', (playerId: string, emote: string) => this.ev.onEmote?.(playerId, emote))
        socket.on('game:quickmsg', (playerId: string, msgId: number) => this.ev.onQuickMsg?.(playerId, msgId))
        socket.on('game:playerleft', (playerId: string, name: string) => this.ev.onPlayerLeft?.(playerId, name))
        socket.on('game:playerjoined', (playerId: string, name: string) => this.ev.onPlayerJoined?.(playerId, name))
        socket.on('game:health', (playerId: string, health: number, dazed: boolean) => this.ev.onHealth?.(playerId, health, dazed))
        socket.on('game:damage', (playerId: string, amount: number, kind: string) => this.ev.onDamage?.(playerId, amount, kind))
        socket.on('game:matchend', (payload: MatchEndPayload) => this.ev.onMatchEnd?.(payload))
        socket.on('game:tokens', (count: number) => this.ev.onTokens?.(count))
        socket.on('game:gate', (open: boolean) => this.ev.onGate?.(open))
        socket.on('game:squad', (s: { code: string; members: { id: string; name: string }[] } | null) => this.ev.onSquad?.(s))
        socket.on('game:squadError', (reason: 'SQUAD_NOT_FOUND' | 'SQUAD_FULL') => this.ev.onSquadError?.(reason))
        socket.on('game:squadInvite', (inv: { fromId: string; fromName: string; code: string }) => this.ev.onSquadInvite?.(inv))
        socket.on('game:squadInviteSent', (s: { targetId: string; targetName: string }) => this.ev.onSquadInviteSent?.(s))
        socket.on('game:squadInviteAccepted', (s: { byId: string; byName: string }) => this.ev.onSquadInviteAccepted?.(s))
        socket.on('game:squadInviteDeclined', (s: { byId: string; byName: string }) => this.ev.onSquadInviteDeclined?.(s))
        socket.on('game:squadInviteError', (s: { targetId: string; reason: 'TARGET_NOT_FOUND' | 'SQUAD_FULL' | 'ALREADY_IN_CELL' | 'INVITE_EXPIRED' }) => this.ev.onSquadInviteError?.(s))
        socket.on('game:gift', (g: { fromId: string; fromName: string; type: string }) => this.ev.onGift?.(g))
        socket.on('game:giftBounce', (g: { toId: string; toName: string; type: string }) => this.ev.onGiftBounce?.(g))
        socket.on('game:giftRefund', (r: { type: string }) => this.ev.onGiftRefund?.(r.type))
        socket.on('game:kudos', (k: { fromId: string; fromName: string }) => this.ev.onKudos?.(k))
        socket.on('game:kudosSent', (k: { targetId: string; targetName: string }) => this.ev.onKudosSent?.(k))
        socket.on('game:mvpTally', (t: { tally: { id: string; name: string; votes: number }[]; voters: number; roomPlayers: number }) => this.ev.onMvpTally?.(t))
        socket.on('game:mvpFinal', (f: { winnerId: string | null; winnerName: string | null; tally: { id: string; name: string; votes: number }[]; voters: number }) => this.ev.onMvpFinal?.(f))
        socket.on('game:mvpError', (e: { reason: 'SELF_VOTE' | 'TARGET_LEFT' }) => this.ev.onMvpError?.(e))
        socket.on('game:pong', (sentAt: number) => {
          this.ping = Math.round(performance.now() - sentAt)
          this.ev.onPing?.(this.ping)
        })
      } catch {
        resolve(false)
      }
    })
  }

  private startPing() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = setInterval(() => {
      if (!this.connected) return
      this.lastPingSent = performance.now()
      this.socket?.emit('game:ping', this.lastPingSent)
    }, 3000)
  }

  join(payload: JoinPayload) { this.socket?.emit('game:join', payload) }
  sendState(x: number, y: number, z: number, ry: number, anim: AnimName, extra?: { tokens?: number; carrying?: boolean }) {
    this.socket?.emit('game:state', { x, y, z, ry, anim, ...extra })
  }
  pickupItem(itemId: string) { this.socket?.emit('game:pickup', { itemId }) }
  throwItem(type: string, x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    this.socket?.emit('game:throw', { type, x, y, z, vx, vy, vz })
  }
  noiseEvent(x: number, z: number) { this.socket?.emit('game:noise', { x, z }) }
  emote(emote: string) { this.socket?.emit('game:emote', { emote }) }
  quickMsg(msgId: number) { this.socket?.emit('game:quickmsg', { msgId }) }
  reviveTarget(targetId: string) { this.socket?.emit('game:revive', { targetId }) }
  healTarget(targetId: string) { this.socket?.emit('game:heal', { targetId }) }
  bossHit() { this.socket?.emit('game:bossHit', {}) }
  bossGrabBallot(x: number, z: number) { this.socket?.emit('game:bossBallot', { x, z }) }
  bossDeposit(x: number, z: number) { this.socket?.emit('game:bossDeposit', { x, z }) }
  squadCreate() { this.socket?.emit('game:squadCreate') }
  squadJoin(code: string) { this.socket?.emit('game:squadJoin', { code }) }
  squadLeave() { this.socket?.emit('game:squadLeave') }
  squadInvite(targetId: string) { this.socket?.emit('game:squadInvite', { targetId }) }
  squadInviteAccept(fromId: string) { this.socket?.emit('game:squadInviteAccept', { fromId }) }
  squadInviteDecline(fromId: string) { this.socket?.emit('game:squadInviteDecline', { fromId }) }
  gift(targetId: string, type: string) { this.socket?.emit('game:gift', { targetId, type }) }
  giftBounce(targetId: string, type: string) { this.socket?.emit('game:giftBounce', { targetId, type }) }
  kudos(targetId: string) { this.socket?.emit('game:kudos', { targetId }) }
  mvpVote(targetId: string) { this.socket?.emit('game:mvpVote', { targetId }) }
  leave() {
    this.socket?.emit('game:leave')
    this.socket?.disconnect()
    this.socket = null
    this.connected = false
    if (this.pingTimer) clearInterval(this.pingTimer)
  }
}
