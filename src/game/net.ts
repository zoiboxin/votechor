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
          reconnectionAttempts: 3,
          reconnectionDelay: 1200,
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
  leave() {
    this.socket?.emit('game:leave')
    this.socket?.disconnect()
    this.socket = null
    this.connected = false
    if (this.pingTimer) clearInterval(this.pingTimer)
  }
}
