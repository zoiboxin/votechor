// VoteChor networking client — socket.io protocol wrapper for the game server.
'use client'
import { io, type Socket } from 'socket.io-client'
import type {
  AnimName, BossNetState, DroppedItemNetState, ItemNetState, MatchEndPayload, NpcNetState, PlayerNetState,
  WildNetState, WildEventNet,
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
  /** v87 — SHARED WILD: the authoritative horde + animals, exactly where they are right now. */
  wild?: WildNetState | null
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
  /** v87 — SHARED WILD: 10 Hz zombie + animal snapshots (single room-wide truth). */
  onWild: (wild: WildNetState) => void
  /** v87 — discrete wild events: spot scares, zombie hits, feeding, pet timeouts. */
  onWildEvent: (ev: WildEventNet) => void
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

/**
 * One socket.io endpoint candidate: a base URL ('' + origin forms resolved by
 * socket.io-client) plus a label used for diagnostics.
 */
export interface NetCandidate {
  url: string
  label: string
}

/**
 * The socket.io path used by EVERY client and by the game server itself.
 * v92: moved from '/' to '/gs/' so that a single-host deployment can relay
 * game traffic through the web server (see server.js) — required behind a
 * Cloudflare Tunnel / any one-port reverse proxy.
 */
export const GAME_SOCKET_PATH = '/gs/'

/**
 * Build the ORDERED list of game-server endpoints to try until one connects.
 *
 * Resolution order (first match wins, fallbacks always appended):
 *  1. NEXT_PUBLIC_GAME_SERVER_URL — explicit override, baked at build time.
 *     For dedicated/remote hosting, e.g. http://192.168.1.50:3002. NOTE: a
 *     public https://domain:3002 value can NOT work (Cloudflare's proxy only
 *     accepts a fixed port list and 3002 is not one of them) — if it fails we
 *     automatically fall through to the relay below.
 *  2. Local/one-PC deployments: connect DIRECTLY to the game server on port
 *     3002 when the page itself is opened on a local address (localhost /
 *     127.0.0.1 / a LAN private IP). The game server listens on all interfaces
 *     and allows every CORS origin, so home/local hosting needs no env var.
 *  3. Public/tunneled origins (e.g. https://votechor.app behind a Cloudflare
 *     Tunnel): connect to the SAME origin the page was loaded from — the
 *     production web server (server.js) relays /gs/* to the game server on
 *     127.0.0.1:3002. One port, one hostname, zero CORS, WSS included.
 *  4. Fallbacks for every origin: the same-origin relay (also covers odd
 *     hostnames served by our custom server) and finally the sandbox's Caddy
 *     gateway form (?XTransformPort=3002).
 */
function resolveCandidates(): NetCandidate[] {
  const out: NetCandidate[] = []
  const explicit = process.env.NEXT_PUBLIC_GAME_SERVER_URL?.trim()
  if (explicit) out.push({ url: explicit, label: 'env' })
  if (typeof window !== 'undefined') {
    const h = window.location.hostname
    const proto = window.location.protocol
    const origin = window.location.origin
    const isLoop = h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
    const isLan = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)
    if (isLoop) {
      out.push({ url: `${proto}//localhost:3002`, label: 'local-direct' })
    } else if (isLan) {
      out.push({ url: `${proto}//${h}:3002`, label: 'lan-direct' })
    } else {
      out.push({ url: origin, label: 'tunnel-relay' })
    }
    // universal fallbacks, in order:
    if (isLoop || isLan) out.push({ url: origin, label: 'same-origin-relay' })
    out.push({ url: '/?XTransformPort=3002', label: 'gateway' })
  }
  return out
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
      const candidates = resolveCandidates()
      let idx = 0
      let settled = false
      let candidateTimer: ReturnType<typeof setTimeout> | null = null
      let current: Socket | null = null

      const dropCurrent = () => {
        if (candidateTimer) { clearTimeout(candidateTimer); candidateTimer = null }
        if (current) {
          current.removeAllListeners()
          try { current.disconnect() } catch { /* already down */ }
          current = null
        }
      }
      const tryNextCandidate = () => {
        if (settled) return
        if (idx >= candidates.length) {
          // every endpoint failed → caller falls back to the offline sim
          dropCurrent()
          this.socket = null
          resolve(false)
          return
        }
        const cand = candidates[idx++]
        try {
          const socket = io(cand.url, {
            path: GAME_SOCKET_PATH,
            // polling FIRST, then upgrade to websocket: this connects through
            // ANY one-port relay/tunnel (Cloudflare Tunnel, server.js) even
            // when the WS hop is degraded, and silently upgrades to WS when
            // the full path supports it (node-run server.js, direct :3002).
            transports: ['polling', 'websocket'],
            forceNew: true,
            reconnection: true,
            // keep retrying for as long as the match is running — the reconnect
            // overlay lets the player quit or fall back to offline sim instead
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 3000,
            timeout: 6000,
          })
          current = socket
          this.socket = socket
          // per-candidate backstop: if this endpoint has not connected within
          // 7 s, move on to the next one (connect_error usually fires sooner).
          candidateTimer = setTimeout(() => {
            if (!this.connected && !settled) { dropCurrent(); tryNextCandidate() }
          }, 7000)
          socket.on('connect', () => {
            if (settled) return
            settled = true
            if (candidateTimer) { clearTimeout(candidateTimer); candidateTimer = null }
            this.connected = true
            this.activeSource = cand.label
            console.info(`[net] connected via ${cand.label} → ${cand.url || 'same origin'} (path ${GAME_SOCKET_PATH})`)
            this.attach(socket)
            this.startPing()
            this.ev.onConnect?.()
            resolve(true)
          })
          // during the initial selection a hard connect error means this
          // candidate is dead → try the next one. After a successful connect
          // this listener is gone and socket.io's own reconnection takes over.
          socket.on('connect_error', () => {
            if (!settled && current === socket) { dropCurrent(); tryNextCandidate() }
          })
        } catch {
          dropCurrent()
          tryNextCandidate()
        }
      }
      tryNextCandidate()
    })
  }

  /** Which endpoint candidate actually connected (diagnostics/QA). */
  activeSource = ''

  /**
   * Attach the game protocol handlers to the CHOSEN socket (once — fallback
   * candidates that failed to connect never receive these listeners).
   */
  private attach(socket: Socket) {
        socket.on('disconnect', () => { this.connected = false; this.ev.onDisconnect?.() })
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
        // v87 — SHARED WILD
        socket.on('game:wild', (w: WildNetState) => this.ev.onWild?.(w))
        socket.on('game:wildEvent', (e: WildEventNet) => this.ev.onWildEvent?.(e))
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

  /** v87 — ask the server to feed street animal #i (validated room-wide; the
   *  requester's food is consumed only when the fedStart broadcast confirms). */
  animalFeed(i: number) { this.socket?.emit('game:animalFeed', { i }) }
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
