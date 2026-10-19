// VoteChor networking client — socket.io protocol wrapper for the game server.
'use client'
import { io, type Socket } from 'socket.io-client'
import type {
  AnimName, BossNetState, DroppedItemNetState, ItemNetState, MatchEndPayload, NpcNetState, PlayerNetState,
} from './shared/types'

export interface JoinPayload {
  name: string
  archetype: string
  roomCode: string | null
  cosmetics?: Record<string, unknown>
  season?: boolean // solo queue → persistent Season (99 backfill bots)
  role?: 'protector' | 'police' // police → officer rig + arrest powers, NPC officers stand down
}

/** Season metadata from the server (join ack + game:season updates). */
export interface SeasonNetInfo {
  id: string
  name: string
  humans: number
  bots: number
  cap: number
  humansMax: number
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
  season?: SeasonNetInfo | null
}

export type NetEvents = {
  onJoinAck: (ack: JoinAck) => void
  onPlayers: (players: PlayerNetState[]) => void
  onNpcs: (npcs: NpcNetState[]) => void
  onItems: (items: ItemNetState[]) => void
  onBoss: (boss: BossNetState, ballots: { id: string; x: number; z: number; taken: boolean }[]) => void
  onCapture: (playerId: string, until: number, message: string, lostTokens?: number) => void
  /** Police role: server confirmed one of OUR arrests (honest counting). */
  onArrested: (targetId: string, targetName: string, totalArrests: number) => void
  /** Police-role baton strike (F) landed somewhere in the room — swing anim + impact FX. */
  onStrike: (fromId: string, targetId: string, x: number, z: number) => void
  onRelease: (playerId: string, x: number, z: number, label?: string) => void
  onDropped: (drops: DroppedItemNetState[]) => void
  onDropTaken: (itemId: string, byId: string, byName: string) => void
  onDropGone: (itemIds: string[]) => void
  onCheckpoint: (checkpointId: number, byName: string, total: number) => void
  onProjectile: (p: { id: string; type: string; x: number; y: number; z: number; vx: number; vy: number; vz: number }) => void
  onEmote: (playerId: string, emote: string) => void
  onQuickMsg: (playerId: string, msgId: number) => void
  onChat: (playerId: string, name: string, text: string) => void
  /** v45 — a room-mate shouted/whistled at (x, z): spatially audible to everyone near. */
  onShout: (playerId: string, x: number, z: number, whistle: boolean, line: string) => void
  onPlayerLeft: (playerId: string, name: string) => void
  onPlayerJoined: (playerId: string, name: string, archetype?: string, cosmetics?: Record<string, string | boolean>, role?: 'protector' | 'police') => void
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
  onSeason: (s: SeasonNetInfo) => void
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
  private bytesSampleAt = 0
  private bytesPerSecEstimate = 0

  /** Cheap download estimate for the perf HUD: sampled 'game:players' payload × 12Hz broadcast. */
  get bytesPerSec() { return this.bytesPerSecEstimate }

  connect(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        // Game server URL. Default: relative gateway form (this sandbox's Caddy
        // gateway routes ?XTransformPort=3002 → game server; never put the port
        // in the path). Running locally WITHOUT the gateway? Set
        // NEXT_PUBLIC_GAME_SERVER_URL=http://localhost:3002 in .env — the game
        // server allows all CORS origins, so a direct connection just works.
        const gameServerUrl = process.env.NEXT_PUBLIC_GAME_SERVER_URL || '/?XTransformPort=3002'
        const socket = io(gameServerUrl, {
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
        socket.on('game:players', (p: PlayerNetState[]) => {
          // perf HUD: sample the AOI player-state payload size every ~2s (one stringify — negligible CPU)
          const now = performance.now()
          if (now - this.bytesSampleAt >= 2000) {
            this.bytesSampleAt = now
            try { this.bytesPerSecEstimate = JSON.stringify(p).length * 12 } catch { /* estimate only */ }
          }
          this.ev.onPlayers?.(p)
        })
        socket.on('game:npcs', (n: NpcNetState[]) => this.ev.onNpcs?.(n))
        socket.on('game:items', (i: ItemNetState[]) => this.ev.onItems?.(i))
        socket.on('game:boss', (b: BossNetState, ballots: { id: string; x: number; z: number; taken: boolean }[]) => this.ev.onBoss?.(b, ballots))
        socket.on('game:capture', (playerId: string, until: number, message: string, lostTokens?: number) => this.ev.onCapture?.(playerId, until, message, lostTokens))
        socket.on('game:arrested', (targetId: string, targetName: string, total: number) => this.ev.onArrested?.(targetId, targetName, total))
        socket.on('game:strike', (fromId: string, targetId: string, x: number, z: number) => this.ev.onStrike?.(fromId, targetId, x, z))
        socket.on('game:release', (playerId: string, x: number, z: number, label?: string) => this.ev.onRelease?.(playerId, x, z, label))
        socket.on('game:dropped', (drops: DroppedItemNetState[]) => this.ev.onDropped?.(drops))
        socket.on('game:dropTaken', (itemId: string, byId: string, byName: string) => this.ev.onDropTaken?.(itemId, byId, byName))
        socket.on('game:dropGone', (itemIds: string[]) => this.ev.onDropGone?.(itemIds))
        socket.on('game:checkpoint', (cp: number, byName: string, total: number) => this.ev.onCheckpoint?.(cp, byName, total))
        socket.on('game:projectile', (p: { id: string; type: string; x: number; y: number; z: number; vx: number; vy: number; vz: number }) => this.ev.onProjectile?.(p))
        socket.on('game:emote', (playerId: string, emote: string) => this.ev.onEmote?.(playerId, emote))
        socket.on('game:quickmsg', (playerId: string, msgId: number) => this.ev.onQuickMsg?.(playerId, msgId))
        socket.on('game:chat', (playerId: string, name: string, text: string) => this.ev.onChat?.(playerId, name, text))
        socket.on('game:shout', (playerId: string, x: number, z: number, whistle: boolean, line: string) => this.ev.onShout?.(playerId, x, z, whistle, line))
        socket.on('game:playerleft', (playerId: string, name: string) => this.ev.onPlayerLeft?.(playerId, name))
        socket.on('game:playerjoined', (playerId: string, name: string, archetype?: string, cosmetics?: Record<string, string | boolean>, role?: 'protector' | 'police') => this.ev.onPlayerJoined?.(playerId, name, archetype, cosmetics, role))
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
        socket.on('game:season', (s: SeasonNetInfo) => this.ev.onSeason?.(s))
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
  /** Detained: report inventory cards for police confiscation (server drops them as loot). */
  confiscateInventory(types: string[]) { this.socket?.emit('game:confiscate', { items: types }) }
  /**
   * Report a player-initiated ground drop: a deliberately dropped inventory item
   * (HUD right-click) or a thrown item's landing spot. The server validates +
   * registers it in its drop registry and relays game:dropped to the WHOLE room
   * (including us — the relay is the single spawn source, so no client-side dupes).
   */
  dropItem(type: string, x: number, z: number) { this.socket?.emit('game:dropItem', { type, x, z }) }
  throwItem(type: string, x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    this.socket?.emit('game:throw', { type, x, y, z, vx, vy, vz })
  }
  noiseEvent(x: number, z: number) { this.socket?.emit('game:noise', { x, z }) }
  /** v45 — relay my shout/whistle so the rest of the room hears it spatially. */
  shoutEvent(x: number, z: number, whistle: boolean, line: string) {
    this.socket?.emit('game:shout', { x, z, whistle, line })
  }
  /** Police role: request to detain the nearest suspect — server validates range/role/cooldown. */
  arrest(targetId: string) { this.socket?.emit('game:arrest', { targetId }) }
  /** Police role: lathi strike (F) — server validates and applies the damage. */
  strike(targetId: string) { this.socket?.emit('game:policeHit', { targetId }) }
  emote(emote: string) { this.socket?.emit('game:emote', { emote }) }
  quickMsg(msgId: number) { this.socket?.emit('game:quickmsg', { msgId }) }
  /** v44 — free-text chat line (server sanitizes + rate-limits, then relays to the room). */
  chat(text: string) { this.socket?.emit('game:chat', { text }) }
  reviveTarget(targetId: string) { this.socket?.emit('game:revive', { targetId }) }
  healTarget(targetId: string) { this.socket?.emit('game:heal', { targetId }) }
  /** v68 — killed by the deep-jungle undead: the server picks a random validated
   *  respawn point (re-baselining its anti-warp tracker) and answers game:release. */
  wildDeath() { this.socket?.emit('game:wildDeath', {}) }
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
    this.bytesPerSecEstimate = 0
    if (this.pingTimer) clearInterval(this.pingTimer)
  }
}
