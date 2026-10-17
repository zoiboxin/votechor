// VoteChor game orchestrator — owns the engine, entities, net, and match flow.
'use client'
import * as THREE from 'three'
import { Engine } from './engine'
import type { SkySystem } from './sky'
import { PhysicsWorld } from './physics'
import { WorldRenderer } from './world'
import { WorldDistanceCuller } from './lod'
import { InputManager } from './input'
import { ThirdPersonCamera } from './camera'
import { PlayerController } from './player'
import { CharacterRig } from './character'
import { CrowdLod, type CrowdEntry } from './crowd'
import { NpcSystem, VehicleSystem } from './npcs'
import { ItemSystem } from './items'
import { AnimalSystem, type AnimalHandle } from './animals'
import { BossClient } from './boss'
import { NetClient, type JoinAck } from './net'
import { AudioManager } from './audio'
import { FxSystem } from './fx'
import { SpeechBubbleSystem } from './bubbles'
import { buildWorldDef } from './shared/world-def'
import { mapById, mapForLevel } from './shared/maps'
import { createNpcStates, tickNpc, type NpcBrainState, type NpcPlayerView } from './shared/npc-brain'
import { createBossBrain, tickBoss, grabBallot, depositBallot, registerBossHit, type BossBrain } from './shared/boss-brain'
import {
  MOVE, TOKENS_NEEDED, DETENTION_SECONDS, MATCH_TIME_LIMIT, ITEM_CONFIG, INVENTORY_MAX,
  archetypeById, XP_TABLE, levelFromXp, CAPTURE_MESSAGES, RANDOM_NOTIFICATIONS, BOSS_NAME,
  BOSS_PHASE_NAMES, GIFT_RADIUS, GIFT_TYPES, SHOUT_COOLDOWN_SEC, SHOUT_LINES, PLAYER_ROLE, POLICE_STRIKE,
  FEED_RADIUS, PET_FOLLOW_SEC, FEED_FOODS,
} from './shared/constants'
import type { AABB, AnimName, BossNetState, ItemType } from './shared/types'
import { useGameStore, registerUIActions, type MatchSummary } from '@/lib/game-store'
import { drawCircularMinimap, type MinimapRemote } from './minimap'
import { SuspectSystem } from './suspects'
import { sharedGLBAssets, hiFiUrlFor, type GLBInstance } from './glb'
import { GLBAnimDriver, GlbLocoFallback } from './anim'
import { applyAvatarPalette } from './avatar-tint'
import type { LocoState } from './anim'
import { emoteIsUnlocked, unlockedEmoteIds, EMOTE_CATALOG, policeUniformColors } from '@/lib/cosmetics'

/** A remote protester (human or bot): data always present, rig/GLB attached by budget. */
interface RemoteEntry {
  rig: import('./character').CharacterRig | null
  /** High-Fi GLB model instance (replaces the procedural body; rig keeps the name tag). */
  glb: { inst: GLBInstance; driver: GLBAnimDriver; loading: boolean; loco?: GlbLocoFallback } | null
  target: { x: number; y: number; z: number; ry: number }
  anim: AnimName
  name: string
  health: number
  detained: boolean
  archetype: string
  role?: 'protector' | 'police'
  cosmetics?: Record<string, string | boolean>
  lastSeen: number
  animAcc: number
}

export const QUICK_MESSAGES = [
  'Chai break, anyone?', 'Follow me!', 'POLICE! Scatter!', 'Nice one!', 'Help! Detained!',
  'To the flyover!', 'Uncle Ji approves.', 'Form a squad!', 'The gate needs votes!', 'Boss time!',
]

export const EMOTES = ['wave', 'salute', 'dance', 'facepalm', 'flex', 'cry']

/** Shown in speech bubbles above the emoting player's head. */
export const EMOTE_LABELS: Record<string, string> = {
  wave: 'Hello, democracy!',
  salute: 'Salute to the cause!',
  dance: 'Protest dance move!',
  facepalm: 'Not this again…',
  flex: 'Strong together!',
  cry: 'The votes… they are gone…',
  chant: 'AIYOO COMMITTEE! AIYOO AIYOO!',
  chai: 'Chai break! Sipped proudly.',
}

/** Anim each emote maps to on remote rigs. */
const EMOTE_ANIMS: Record<string, AnimName> = {
  wave: 'celebrate',
  dance: 'celebrate',
  salute: 'idle',
  facepalm: 'dazed',
  flex: 'celebrate',
  cry: 'dazed',
  chant: 'celebrate',
  chai: 'heal',
}

/** Speech-bubble quips when handing a gift over. */
const GIFT_QUIPS = [
  'For the cause!',
  'Mutual aid in action.',
  'The committee hates this trick.',
  'From my pockets to yours.',
  'Share the supplies. Share the sentence.',
]

interface MatchStats {
  tokens: number
  checkpoints: number
  rescues: number
  revives: number
  itemsCollected: number
  detentions: number
  bossHits: number
  distractions: number
  gifts: number
  confiscated: number // vote tokens seized by police on detention
  confiscatedItems: number // inventory cards seized by police on detention
  arrests: number // suspects detained by a police-role player
}

export class Game {
  private engine!: Engine
  private physics = new PhysicsWorld()
  private worldRenderer!: WorldRenderer
  /** Static-geometry distance culling — the measured dominant draw-call cost beyond the fog wall. */
  private culler!: WorldDistanceCuller
  private input!: InputManager
  private camRig!: ThirdPersonCamera
  private player: PlayerController | null = null
  private npcs!: NpcSystem
  private vehicles!: VehicleSystem
  private items!: ItemSystem
  private animals!: AnimalSystem
  private bossClient = new BossClient()
  private fx = new FxSystem()
  private playerBubbles = new SpeechBubbleSystem()
  private lastHunted = false
  private photoWheelHandler: ((e: WheelEvent) => void) | null = null
  private net = new NetClient()
  private world = buildWorldDef()
  /** v43 — the district currently built into this.world (rebuilt on map change at match start) */
  private worldId = 'classic'

  private mode: 'solo' | 'multiplayer' | null = null
  private offline = false
  private lastRoomCode: string | null = null
  private reconnectNotified = false
  private onboardingTimers: ReturnType<typeof setTimeout>[] = []
  private serverMatchStart: number | null = null
  private running = false
  private worldTime = 0
  private matchTime = 0
  private stateSendAccum = 0
  private hudAccum = 0
  private store = useGameStore.getState()
  private unsubStore: (() => void) | null = null

  // local sim (offline)
  private localNpcBrains: NpcBrainState[] = []
  private localBoss: BossBrain | null = null
  private localBossAccum = 0

  // match state
  private tokens = 0
  private tokensNeeded = TOKENS_NEEDED
  private gateOpen = false
  private activatedCheckpoints = new Set<number>()
  private inventory: { uid: string; type: ItemType }[] = []
  private stats: MatchStats = { tokens: 0, checkpoints: 0, rescues: 0, revives: 0, itemsCollected: 0, detentions: 0, bossHits: 0, distractions: 0, gifts: 0, confiscated: 0, confiscatedItems: 0, arrests: 0 }
  private detainUntil = 0
  private carryingBallot = false
  private carryingBallotId: string | null = null
  private remotePlayers = new Map<string, RemoteEntry>()
  private static MAX_RIGS = 24 // rig budget: nearby protesters get full characters, the rest stay as data dots
  private crowd: CrowdLod | null = null // instanced impostors for the rig-less majority
  private lastCrowdSync = 0
  private lastFps = 60
  private perfRigs = 0
  private rigsRebuiltAt = 0
  private serverNpcRys: Record<string, number> = {}
  private lastTokenPos = { x: 0, z: 0 }
  private humorTimer = 30
  // ---- sprint/slide camera feel (speed FOV kick + slide dip + dust) ----
  private slideAmt = 0
  private slideDustT = 0
  // ---- police melee telegraphs (Phase 5 client feel) ----
  private pendingPoliceStrike: { npcId: string; attackAt: number } | null = null
  private lastPoliceDamageAt = 0
  private lastShoutAt = 0 // V-key shout/whistle cooldown gate
  private lastPauseToggleAt = 0 // v35 — debounce Escape keydown + pointerlockchange double-delivery
  private squadPanelOffNotified = false // v42 — one gentle reminder when Tab is pressed while the squad panel setting is off
  private lastArrestAttemptAt = 0 // police-role arrest spam gate (client side)
  private lastPlayerStrikeAt = 0 // police-role baton strike (F) spam gate — distinct from the NPC telegraph above
  // ---- High-Fi GLB player model (Step 2/3/4 integration — auto-fallback to procedural) ----
  // sharedGLBAssets: one process-wide cache shared with the wardrobe preview
  private glbMgr = sharedGLBAssets
  private hiFiPalette: { shirt: string; pants: string; skin: string; accent: string } | null = null
  private hiFiGender: 'male' | 'female' = 'male'
  private role: 'protector' | 'police' = 'protector' // chosen side (profile.role)
  private suspects: SuspectSystem | null = null // offline police-role arrest targets
  private windupUntil = new Map<string, number>()
  private staggerUntil = new Map<string, number>()
  // engine-level damage vignette (DOM overlay owned here, Hud.tsx untouched)
  private dmgFlashEl: HTMLDivElement | null = null
  private dmgFlashTimer: ReturnType<typeof setTimeout> | null = null
  private lastDynSync = 0
  private minimapCanvas: HTMLCanvasElement | null = null
  private hudMinimapCanvas: HTMLCanvasElement | null = null
  private matchEnded = false
  private endHandled = false
  private archetype = 'student'
  private lastSearchlightRys: Record<string, number> = {}
  private localSearchlightAngles: Record<string, number> = {}
  private interacting = false
  private reviveProgress = 0
  private reviveTargetId: string | null = null
  private bossActiveLocal = false
  private bossCinematic = { active: false, t: 0, fired: false }
  private photoMode = false
  private photoKeyHandler: ((e: KeyboardEvent) => void) | null = null
  private canvasEl: HTMLCanvasElement | null = null
  private spectateName: string | null = null
  private unlockedEmotes = new Set<string>(['wave', 'salute', 'facepalm', 'cry'])
  private squad = { code: null as string | null, memberIds: new Set<string>() }
  private lastSquadCode: string | null = null
  private squadAutoRejoin = false
  private kudosSentTo = new Set<string>()
  private rallyReadyAt = 0
  private inviteClearTimer: ReturnType<typeof setTimeout> | null = null
  private static RALLY_COOLDOWN_MS = 45000
  private static INVITE_TTL_MS = 20000

  /** Boot entry with a hard failure guarantee: ANY throw during engine/world/NPC
   *  construction (WebGL unavailable, out-of-memory during city build on a
   *  low-end device, …) previously died as an unhandled rejection — a silent,
   *  dead canvas. Now the user gets a visible fatal-error card with the reason
   *  and a Reload button instead of a mysterious blank/blue screen. */
  async boot(canvas: HTMLCanvasElement, minimap: HTMLCanvasElement) {
    try {
      await this.bootUnsafe(canvas, minimap)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[VoteChor] FATAL: game boot failed', e)
      const w = window as unknown as { __vcDiag?: Array<Record<string, unknown>> }
      ;(w.__vcDiag ??= []).push({ kind: 'bootFatal', msg: msg.slice(0, 200), t: Date.now() })
      useGameStore.getState().setFatalError(msg.slice(0, 200))
    }
  }

  private async bootUnsafe(canvas: HTMLCanvasElement, minimap: HTMLCanvasElement) {
    this.minimapCanvas = minimap
    this.canvasEl = canvas
    this.engine = new Engine(canvas)
    // lightning → white HUD flash + delayed thunder roll
    this.engine.sky.onLightning = () => {
      const st = useGameStore.getState()
      st.patchHud({ env: { ...st.hud.env, flashAt: Date.now() } })
      window.setTimeout(() => AudioManager.play('thunder'), 260 + Math.random() * 950)
    }
    // ---- render-fault telemetry → visible recovery (device-specific GL failures must surface) ----
    const markGl = (gl: 'ok' | 'lost' | 'error', msg = '') => {
      const st = useGameStore.getState()
      if (st.hud.perf.gl !== gl || st.hud.perf.glMsg !== msg) {
        st.patchHud({ perf: { ...st.hud.perf, gl, glMsg: msg } })
      }
      const w = window as unknown as { __vcDiag?: Array<Record<string, unknown>> }
      ;(w.__vcDiag ??= []).push({ kind: `gl-${gl}`, msg, t: Date.now() })
    }
    /** One guarded auto-reload per 30s window — a lost GL context / collapsed draw
     *  pipeline recovers far more reliably through a fresh page than in-place. */
    const guardedReload = (reason: string) => this.guardedReload(reason)
    this.engine.onError = (phase, message) => {
      markGl('error', `${phase}: ${message.slice(0, 80)}`)
      console.error(`[VoteChor] render fault (${phase})`, message)
    }
    this.engine.onContextLost = () => {
      markGl('lost', 'WebGL context lost')
      this.store.notify('Graphics context lost — reloading…', 'warning')
      window.setTimeout(() => { if (this.engine.contextLost) guardedReload('webgl context lost') }, 4500)
    }
    this.engine.onContextRestored = () => {
      markGl('ok')
      this.store.notify('Graphics restored', 'info')
    }
    this.physics.setColliders(this.world.colliders)
    // QA/debug handle — lets test scripts probe the live atmosphere state (window.__sky)
    if (typeof window !== 'undefined') {
      (window as unknown as { __sky?: SkySystem }).__sky = this.engine.sky
    }
    this.worldRenderer = new WorldRenderer(this.world, 'high')
    if (typeof window !== 'undefined') {
      (window as unknown as { __wr?: WorldRenderer }).__wr = this.worldRenderer
      // QA/debug handle — staged E2E checks (capture flow, pickups) drive the live Game
      ;(window as unknown as { __game?: Game }).__game = this
    }
    this.engine.scene.add(this.worldRenderer.group)
    this.culler = new WorldDistanceCuller(this.worldRenderer.group, 195) // fog far is 210 — cull just inside it
    // honor the user's performance-visibility preference (Options → Performance).
    // Opt-in: default OFF renders the exact proven v25 path (everything always drawn).
    this.culler.enabled = useGameStore.getState().settings.distanceCulling === true
    // fail-safe host: if the culler ever mass-hides on this device it has already
    // restored the world and disabled itself — make it visible + reportable
    this.culler.onAnomaly = (visibleNear) => {
      console.warn(`[VoteChor] Distance-culler fail-safe — only ${visibleNear} meshes visible near the player; culling disabled, world fully restored`, {
        mode: this.mode, offline: this.offline, t: new Date().toISOString(),
      })
      const w = window as unknown as { __vcDiag?: Array<Record<string, unknown>> }
      ;(w.__vcDiag ??= []).push({ kind: 'cullerFailSafe', visibleNear, t: Date.now(), at: { x: this.player?.pos.x ?? 0, z: this.player?.pos.z ?? 0 } })
      this.store.notify('Graphics safety: distance culling disabled — world fully restored', 'warning')
    }
    this.engine.scene.add(this.bossClient.group)
    this.engine.scene.add(this.fx.group)
    this.engine.scene.add(this.playerBubbles.group)

    this.input = new InputManager(canvas)
    this.input.onOneShot = (a) => this.handleOneShot(a)
    this.camRig = new ThirdPersonCamera(this.engine.camera, this.physics)

    this.npcs = new NpcSystem(this.world, this.physics, 'high')
    this.npcs.farLod = useGameStore.getState().settings.distanceCulling === true // opt-in (v25 default: off)
    this.engine.scene.add(this.npcs.group)
    // offline solo: police captures + melee hits come from the local sim
    this.npcs.onLocalCapture = () => {
      if (!this.player || this.player.isDetained || this.player.isDazed || this.matchEnded) return
      this.onCapture('me', Date.now() + DETENTION_SECONDS * 1000, '', 0)
    }
    this.npcs.onLocalHit = (amount) => {
      if (!this.player || this.player.isDetained || this.player.isDazed) return
      this.applyDamage(amount, 'police')
    }
    this.vehicles = new VehicleSystem(this.world, this.engine.renderer)
    this.engine.scene.add(this.vehicles.group)
    this.vehicles.onPlayerHit = (kind, x, z, dmg) => this.handleVehicleHit(kind, x, z, dmg)

    // street animals + sky birds — independent client bots with a feed-to-follow
    // pet mechanic (audio + hearts are self-driven; notifications come via hooks)
    this.animals = new AnimalSystem(this.physics, this.fx, {
      onFed: (label, kind, extended) => {
        const emoji = kind === 'dog' ? '🐕' : kind === 'cat' ? '🐈' : '🐄'
        this.store.notify(
          extended
            ? `${emoji} ${label} is extra happy! Friendship extended (+${PET_FOLLOW_SEC}s)`
            : `${emoji} ${label} loved the food! It will follow you for ${PET_FOLLOW_SEC}s — feed again to extend`,
          'squad',
        )
      },
      onPetOver: (label) => this.store.notify(`${label} wanders off — feed again to be friends`, 'info'),
    })
    this.engine.scene.add(this.animals.group)

    this.items = new ItemSystem(this.world.items, this.physics)
    this.engine.scene.add(this.items.group)

    // patrol passed RAW — createNpcStates handles both [x,z] tuples and {x,z} objects;
    // pre-spreading ({...p}) exploded [x,z] arrays into {0:x,1:z} and NaN-froze offline NPCs
    this.localNpcBrains = createNpcStates(this.world.npcs.map(n => ({ id: n.id, type: n.type, x: n.x, z: n.z, patrol: n.patrol })))
    for (const sl of this.world.searchlights) this.localSearchlightAngles[sl.id] = sl.ry

    // net events
    this.net.ev = {
      onJoinAck: (ack) => this.onJoinAck(ack),
      onPlayers: (players) => this.onServerPlayers(players),
      onNpcs: (npcs) => {
        this.npcs.applyServerState(npcs)
        for (const n of npcs) this.serverNpcRys[n.id] = n.ry
        this.observePoliceTelegraphs(npcs)
      },
      onItems: (items) => this.items.applyServerState(items, this.worldTime),
      onBoss: (boss, ballots) => this.onServerBoss(boss, ballots),
      onCapture: (playerId, until, message, lostTokens) => this.onCapture(playerId, until, message, lostTokens),
      onArrested: (_targetId, targetName, totalArrests) => {
        // server-confirmed arrest — trust the count, celebrate the cuff
        this.stats.arrests = totalArrests
        AudioManager.play('capture')
        const p = this.player
        if (p) this.fx.popup(`ARRESTED — ${targetName}`, '#4e7fb5', p.pos.x, 2.2, p.pos.z)
        this.store.notify(`Suspect ${targetName} detained — ${totalArrests} cuffed this shift.`, 'capture')
      },
      onStrike: (fromId, targetId, x, z) => this.onRemoteStrike(fromId, targetId, x, z),
      onRelease: (playerId, x, z) => this.onRelease(playerId, x, z),
      onDropped: (drops) => {
        for (const d of drops) {
          if (this.items.items.some(i => i.def.id === d.id)) continue
          this.items.spawnDropped({ id: d.id, type: d.type, x: d.x, y: d.y, z: d.z, respawn: 0 })
        }
      },
      onDropTaken: (itemId, byId, byName) => {
        // self-pickups already got the standard pickup FX via local prediction
        this.items.removeDropped(itemId)
        if (byId !== this.net.playerId && !byId.startsWith('bot_')) {
          this.store.notify(`${byName} recovered confiscated gear`, 'squad')
        }
      },
      onDropGone: (itemIds) => { for (const id of itemIds) this.items.removeDropped(id) },
      onCheckpoint: (cp, byName, total) => this.onCheckpoint(cp, byName, total),
      onProjectile: (p) => this.items.spawnRemoteProjectile(p.id, p.type, p.x, p.y, p.z, p.vx, p.vy, p.vz),
      onEmote: (playerId, emote) => this.playRemoteEmote(playerId, emote),
      onQuickMsg: (playerId, msgId) => this.onRemoteQuickMsg(playerId, msgId),
      onChat: (playerId, name, text) => this.onRemoteChat(playerId, name, text),
      onShout: (playerId, x, z, whistle, line) => this.onRemoteShout(playerId, x, z, whistle, line),
      onPlayerLeft: (playerId, name) => {
        this.removeRemote(playerId)
        this.syncRoomRoster()
        if (playerId.startsWith('bot_')) {
          useGameStore.getState().patchSeason({ lastEvent: `${name} left the season`, lastEventAt: Date.now() })
        } else {
          this.store.notify(`${name} left the protest`, 'info')
        }
      },
      onPlayerJoined: (playerId, name, _archetype, cosmetics, role) => {
        if (cosmetics) this.pendingCosmetics.set(playerId, cosmetics)
        if (role) this.pendingRoles.set(playerId, role)
        this.deferredRosterAdd(playerId, name)
        if (playerId.startsWith('bot_')) {
          useGameStore.getState().patchSeason({ lastEvent: `${name} joined the season`, lastEventAt: Date.now() })
        } else {
          this.store.notify(`${name} joined the protest!`, 'squad')
        }
      },
      onHealth: (playerId, health, dazed) => this.onRemoteHealth(playerId, health, dazed),
      onDamage: (playerId, amount, kind) => { if (playerId === this.net.playerId) this.applyDamage(amount, kind) },
      onMatchEnd: (payload) => this.handleMatchEnd(payload),
      onTokens: (count) => { this.tokens = count; this.checkGate() },
      onGate: (open) => this.setGate(open),
      onSquad: (s) => this.onSquadUpdate(s),
      onGift: (g) => this.onGiftReceived(g),
      onGiftBounce: (g) => this.onGiftBounced(g),
      onGiftRefund: (type) => this.onGiftRefund(type),
      onKudos: (k) => this.onKudosReceived(k),
      onKudosSent: (k) => {
        this.kudosSentTo.add(k.targetId)
        this.store.notify(`Kudos sent to ${k.targetName} — solidarity saluted 🙌`, 'squad')
      },
      onMvpTally: (t) => useGameStore.getState().setMvpTally(t),
      onMvpFinal: (f) => this.onMvpFinal(f),
      onMvpError: (e) => {
        const why = e.reason === 'SELF_VOTE'
          ? 'No voting for yourself — the committee frowns on ballot fraud'
          : 'That protester left before the vote landed'
        this.store.notify(why, 'warning')
      },
      onSeason: (s) => {
        useGameStore.getState().patchSeason({ id: s.id, name: s.name, humans: s.humans, bots: s.bots, cap: s.cap, humansMax: s.humansMax })
      },
      onSquadInvite: (inv) => this.onSquadInvite(inv),
      onSquadInviteSent: (s) => this.store.notify(`Invite sent to ${s.targetName} — the cell awaits`, 'squad'),
      onSquadInviteAccepted: (s) => {
        AudioManager.play('checkpoint')
        this.store.notify(`${s.byName} accepted — your cell just got louder!`, 'squad')
      },
      onSquadInviteDeclined: (s) => this.store.notify(`${s.byName} declined your invite — more marching for you`, 'info'),
      onSquadInviteError: (s) => {
        const why =
          s.reason === 'TARGET_NOT_FOUND' ? 'That protester has left the room'
          : s.reason === 'SQUAD_FULL' ? 'Your cell is full (4 max)'
          : s.reason === 'ALREADY_IN_CELL' ? 'They are already in your cell'
          : 'That invite expired — ask for a fresh one'
        this.store.notify(why, 'warning')
      },
      onSquadError: (reason) => {
        if (this.squadAutoRejoin) {
          this.squadAutoRejoin = false
          return // silent: squad did not survive the room change after reconnect
        }
        const why = reason === 'SQUAD_FULL' ? 'That squad is full (4 max)' : 'No squad with that code in this room'
        this.store.notify(why, 'warning')
      },
      onPing: (ms) => this.store.patchHud({ ping: ms }),
      onDisconnect: () => {
        if (this.running && !this.offline) {
          if (this.mode === 'multiplayer') {
            this.reconnectNotified = true
            this.store.notify('Connection lost — attempting to reconnect…', 'warning')
          } else {
            this.store.notify('Connection lost — switching to offline mode', 'warning')
          }
          // squads are room-scoped: drop the local cell state until we land back in one
          this.squad = { code: null, memberIds: new Set() }
          useGameStore.getState().setSquad(null)
          this.offline = true
          this.store.patchHud({ connection: 'offline' })
        }
      },
      onConnect: () => {
        if (this.running) {
          this.store.patchHud({ connection: 'connected' })
          // auto-rejoin after mid-match reconnect (server dropped our session)
          if (this.mode === 'multiplayer' && this.reconnectNotified) {
            this.reconnectNotified = false
            const profile = useGameStore.getState().profile
            this.net.join({
              name: profile?.name ?? 'Protester',
              archetype: this.archetype,
              roomCode: this.lastRoomCode,
              cosmetics: profile?.cosmetics as Record<string, unknown> | undefined,
              role: this.role,
            })
            this.offline = false
            this.store.notify('Reconnected to the protest!', 'squad')
            // attempt to restore the protest cell if it survived in the room
            if (this.lastSquadCode) {
              this.squadAutoRejoin = true
              this.net.squadJoin(this.lastSquadCode)
            }
          }
        }
      },
    }

    // store subscription for settings + map/pause input orchestration
    this.unsubStore = useGameStore.subscribe((s, prev) => {
      this.store = s
      AudioManager.setVolumes({ master: s.settings.masterVolume, music: s.settings.musicVolume, sfx: s.settings.sfxVolume })
      this.input.keybinds = s.settings.keybinds
      this.input.sensitivity = s.settings.mouseSensitivity
      this.input.invertY = s.settings.invertY
      // ---- High-Fi GLB model toggle (live swap mid-match) ----
      if (s.settings.hiFiModel !== prev.settings.hiFiModel) this.applyHiFiSetting(s.settings.hiFiModel)
      // ---- performance-visibility toggle (live; off = the proven v25 rendering path) ----
      if (s.settings.distanceCulling !== prev.settings.distanceCulling) {
        const on = s.settings.distanceCulling === true
        this.culler.enabled = on
        if (!on) this.culler.showAll() // turning it off must restore anything currently hidden
        this.engine.shadowThrottle = on // off = shadows refresh every frame (v25 cadence)
        if (this.npcs) this.npcs.farLod = on // off = every NPC rig always drawn (v25)
      }
      // ---- map toggled from ANY source (M key, HUD minimap click, big-map X / backdrop / Escape) ----
      if (s.mapOpen !== prev.mapOpen || s.chatOpen !== prev.chatOpen) {
        const overlay = s.mapOpen || s.chatOpen
        this.input.suppressed = overlay
        this.input.pauseOnUnlock = !overlay
        if (overlay) {
          this.input.clearKeys() // stop mid-stride
          this.input.releasePointer() // free the mouse for the overlay UI — no pause side-effect
        } else if (s.uiMode === 'playing') {
          this.input.clearKeys()
          this.input.setEnabled(true) // re-arm keyboard + pointer lock (fixes frozen controls)
        }
      }
      // ---- returning to 'playing' from the pause menu must ALWAYS restore input ----
      // (the Resume button only flips uiMode; without this the keyboard stays dead)
      if (s.uiMode !== prev.uiMode && s.uiMode === 'playing' && prev.uiMode === 'paused') {
        this.input.suppressed = s.mapOpen || s.chatOpen
        if (!(s.mapOpen || s.chatOpen)) { this.input.clearKeys(); this.input.setEnabled(true) }
      }
    })

    this.engine.onFixedUpdate = (dt) => this.fixedUpdate(dt)
    this.engine.onRender = (dt) => this.renderUpdate(dt)
    this.engine.onFps = (fps) => {
      this.lastFps = fps
      useGameStore.getState().setFps(fps)
    }
    this.engine.setQuality(this.store.settings.quality)
    // Shadow-pass throttle + NPC far-LOD are part of the opt-in performance-visibility
    // package (same switch as distance culling). Default OFF = the exact rendering
    // cadence of the build the affected device confirmed working (5b08baf / "v25").
    this.engine.shadowThrottle = this.store.settings.distanceCulling === true
    window.addEventListener('resize', () => this.engine.resize())

    registerUIActions({
      startSolo: () => void this.startMatch('solo', null),
      joinMultiplayer: (roomCode) => void this.startMatch('multiplayer', roomCode),
      leaveMatch: () => this.leaveMatch(),
      selectArchetype: (id) => { this.archetype = id },
      updateCosmetics: () => {},
      useItem: (uid) => this.useInventoryItem(uid),
      dropItem: (uid) => this.dropInventoryItem(uid),
      sendEmote: (emote) => this.playEmote(emote),
      sendQuickMessage: (id) => {
        const msg = QUICK_MESSAGES[id] ?? ''
        this.net.quickMsg(id)
        this.sayBubble('me', msg)
        this.store.notify(`You: ${msg}`, 'squad')
      },
      sendChatMessage: (text) => this.sendChat(text),
      respawnRequest: () => {},
      photoToggle: () => this.togglePhotoMode(),
      photoFilter: () => this.cyclePhotoFilter(),
      photoSnapshot: () => this.takeSnapshot(),
      photoZoom: (dir) => this.photoZoom(dir),
      squadCreate: () => {
        if (this.offline) { this.store.notify('Squads need a live room — go multiplayer!', 'warning'); return }
        this.net.squadCreate()
      },
      squadJoin: (code) => {
        if (this.offline) { this.store.notify('Squads need a live room — go multiplayer!', 'warning'); return }
        const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
        if (clean.length !== 4) { this.store.notify('Squad codes are 4 characters', 'warning'); return }
        this.net.squadJoin(clean)
      },
      squadLeave: () => this.net.squadLeave(),
      squadInvite: (targetId) => {
        if (this.offline) { this.store.notify('Squads need a live room — go multiplayer!', 'warning'); return }
        if (!targetId || targetId === this.net.playerId) return
        this.net.squadInvite(targetId)
      },
      squadInviteAccept: (fromId) => this.net.squadInviteAccept(fromId),
      squadInviteDecline: (fromId) => this.net.squadInviteDecline(fromId),
      rallyToCell: () => this.rallyToCell(),
      giftNearest: () => this.giftNearest(),
      giftTo: (targetId) => this.giftTo(targetId),
      kudosTo: (targetId) => {
        if (this.offline) { this.store.notify('Kudos need teammates — go multiplayer!', 'warning'); return }
        if (!targetId || targetId === this.net.playerId) return
        if (this.kudosSentTo.has(targetId)) { this.store.notify('You already saluted this protester', 'info'); return }
        this.net.kudos(targetId)
      },
      mvpVote: (targetId) => {
        if (this.offline) { this.store.notify('MVP voting needs teammates — go multiplayer!', 'warning'); return }
        if (!targetId || targetId === this.net.playerId) return
        this.net.mvpVote(targetId)
      },
      setHudMinimap: (c) => this.setHudMinimapCanvas(c),
    })

    this.ensurePhotoKeyHandler()
    // speech bubbles hide when the speaker is occluded from the camera (NPC + player bubbles)
    this.npcs.bubbles.occlusionCheck = (x, y, z) =>
      this.physics.raycastBlocked(
        this.engine.camera.position.x, this.engine.camera.position.y, this.engine.camera.position.z,
        x, y, z,
      )
    this.playerBubbles.occlusionCheck = this.npcs.bubbles.occlusionCheck
    this.engine.start()
    AudioManager.resume()
    // v48: menus are silent — no crowd bed, no menu theme on the landing page.
    // startMatch() starts both; leaveMatch()/finalizeMatch() stop them.
    useGameStore.getState().setUIMode('menu')
    // debug handle for QA tooling
    ;(window as unknown as { __vc: unknown }).__vc = this
    // QA affordance: direct store access for tooling (same contract as __vc)
    ;(window as unknown as { __vcStore: unknown }).__vcStore = useGameStore
    // QA affordance: audio state for silent-menu verification (theme/crowdSource)
    ;(window as unknown as { __vcAudio: unknown }).__vcAudio = AudioManager
  }

  // ================= match lifecycle =================
  async startMatch(mode: 'solo' | 'multiplayer', roomCode: string | null) {
    const store = useGameStore.getState()
    store.setUIMode('loading')
    this.mode = mode
    store.setMatchMode(mode)
    this.lastRoomCode = roomCode
    this.reconnectNotified = false
    this.clearOnboarding()
    this.matchEnded = false
    this.endHandled = false
    // force-close any overlays so a fresh match never boots with stuck suppressed input
    useGameStore.getState().toggleMap(false)
    useGameStore.getState().toggleSquad(false)
    useGameStore.getState().toggleEmoteWheel(false)
    this.input.suppressed = false
    this.tokens = 0
    this.kudosSentTo.clear()
    useGameStore.getState().resetPostMatch()
    useGameStore.getState().setRoomRoster([])
    useGameStore.getState().setSeason(null)
    this.gateOpen = false
    this.activatedCheckpoints.clear()
    this.inventory = []
    this.stats = { tokens: 0, checkpoints: 0, rescues: 0, revives: 0, itemsCollected: 0, detentions: 0, bossHits: 0, distractions: 0, gifts: 0, confiscated: 0, confiscatedItems: 0, arrests: 0 }
    this.lastArrestAttemptAt = 0
    this.carryingBallot = false
    this.carryingBallotId = null
    this.matchTime = 0
    this.humorTimer = 24
    this.squad = { code: null, memberIds: new Set() }
    this.lastSquadCode = null
    this.squadAutoRejoin = false
    this.rallyReadyAt = 0
    this.clearPendingInvite()
    useGameStore.getState().setSquad(null)

    // ---- v43 district maps: solo plays the map earned by the profile level ----
    // Multiplayer rooms stay on the classic city (shared room world). When the
    // district changes, the client-side world is rebuilt: render group disposed,
    // colliders swapped, culler re-armed. The SYNCED skeleton (spawn, zones,
    // checkpoints, items/npcs/vehicles/searchlights ids) is identical in every
    // variant, so the authoritative server never notices the difference.
    const mapId = mode === 'solo' ? this.pickSoloMapId(store) : 'classic'
    if (mapId !== this.worldId) {
      this.worldId = mapId
      this.world = buildWorldDef(mapId)
      this.physics.setColliders(this.world.colliders)
      this.worldRenderer.dispose()
      this.worldRenderer = new WorldRenderer(this.world, 'high')
      this.engine.scene.add(this.worldRenderer.group)
      ;(window as unknown as { __wr?: WorldRenderer }).__wr = this.worldRenderer
      this.culler = new WorldDistanceCuller(this.worldRenderer.group, 195) // fog far is 210 — cull just inside it
    }
    const district = mapById(this.worldId)

    // fresh skies each match: v38 — every session opens in the MORNING (08:00–09:45)
    // instead of any hour 07:00–19:00; with the 20-min day + day-skew the player now
    // gets ~12+ real minutes of daylight before nightfall. + reset weather roll.
    // v43 — the district pins its own sky window, but ONLY while the player's
    // settings are on the cycle/auto defaults: an explicit user choice always wins.
    this.engine.sky.timeOfDay = 8 + Math.random() * 1.75
    this.engine.sky.setWeatherMode('auto')
    this.engine.sky.setTimeMode(useGameStore.getState().settings.timeMode ?? 'cycle')
    const liveSettings = useGameStore.getState().settings
    if (liveSettings.timeMode === 'cycle' && district.timeOfDay) {
      this.engine.sky.timeOfDay = district.timeOfDay[0] + Math.random() * (district.timeOfDay[1] - district.timeOfDay[0])
    }
    if (liveSettings.weatherMode === 'auto' && district.weather) {
      this.engine.sky.setWeatherMode(district.weather)
    }
    useGameStore.getState().patchHud({ env: { ...useGameStore.getState().hud.env, flashAt: 0 }, mapName: district.name, mapDifficulty: district.difficulty, mapXpMul: district.xpMul })

    const profile = store.profile
    this.archetype = profile?.archetype ?? 'student'
    const name = profile?.name ?? 'Protester'
    // chosen side: profile.role (server-persisted) → localStorage fallback → protector
    this.role = profile?.role === 'police' ? 'police' : profile?.role === 'protector' ? 'protector' : (() => {
      try { return localStorage.getItem('votechor_role') === 'police' ? 'police' : 'protector' } catch { return 'protector' as const }
    })()
    this.refreshUnlockedEmotes()
    // scrub the role-dependent HUD NOW (the connect window can take seconds —
    // otherwise the previous match's objective/officer badge lingers on screen)
    store.patchHud({
      role: this.role,
      arrests: 0,
      objective: this.role === 'police' ? 'Reporting for duty…' : 'Recover the stolen vote tokens!',
    })

    // reset world states
    this.net.leave() // drop any lingering previous-room socket (post-match ghosts)
    useGameStore.getState().clearChat() // fresh comms feed per match
    this.worldRenderer.setBossGateOpen(false)
    this.bossClient.hideAll()
    this.fx.clear()
    this.playerBubbles.clear()
    for (const it of this.items.items) { it.taken = false; it.group.visible = true; it.respawnAt = 0 }
    for (const [id] of this.remotePlayers) this.removeRemote(id)
    this.localBoss = createBossBrain(this.world.bossArena)
    this.bossActiveLocal = false

    // fresh player — free the previous rig's GPU resources before rebuilding
    if (this.player) {
      if (this.player.glb) {
        this.engine.scene.remove(this.player.glb.inst.group)
        this.glbMgr.disposeInstance(this.player.glb.inst)
        this.player.detachGlb()
      }
      this.engine.scene.remove(this.player.rig.group)
      this.player.rig.dispose()
    }
    const cosmetics = profile?.cosmetics
    const gender = cosmetics?.gender === 'female' ? 'female' as const : 'male' as const
    // High-Fi GLB palette — mirrors PlayerController's color resolution exactly
    {
      const arch = archetypeById(this.archetype)
      const pal = { shirt: arch.colors.shirt, pants: arch.colors.pants, skin: arch.colors.skin, accent: arch.colors.accent }
      if (cosmetics?.skinTone && typeof cosmetics.skinTone === 'string') pal.skin = cosmetics.skinTone
      if (this.role === 'police') {
        const u = policeUniformColors(typeof cosmetics?.policeOutfit === 'string' ? cosmetics.policeOutfit : undefined)
        pal.shirt = u.shirt; pal.pants = u.pants; pal.accent = u.accent
      }
      this.hiFiPalette = pal
      this.hiFiGender = gender
    }
    this.player = new PlayerController(this.archetype, name, this.world.spawn, this.physics, {
      hat: cosmetics?.hat as string | undefined,
      glasses: cosmetics?.glasses as boolean | undefined,
      gender,
      hair: cosmetics?.hair as string | undefined,
      // officer look: the uniform must read cleanly — protest outfit/sign stay home,
      // dress style comes from the Police Department wardrobe (policeOutfit/policeHat)
      signText: this.role === 'police' ? undefined : cosmetics?.signText as string | undefined,
      face: cosmetics?.face as string | undefined,
      build: cosmetics?.build as string | undefined,
      outfit: this.role === 'police' ? undefined : cosmetics?.outfit as string | undefined,
      footwear: cosmetics?.footwear as string | undefined,
      gear: this.role === 'police' ? 'none' : cosmetics?.gear as string | undefined,
      held: this.role === 'police' ? undefined : cosmetics?.held as string | undefined,
      ...(this.role === 'police' ? {
        npcType: 'police' as const,
        policeOutfit: cosmetics?.policeOutfit as string | undefined,
        policeHat: cosmetics?.policeHat as string | undefined,
      } : {}),
      cosmetics,
    })
    this.player.onFootstep = (running) => AudioManager.play(running ? 'footstepRun' : 'footstep')
    this.player.onLand = (hard) => AudioManager.play(hard ? 'land' : 'footstep')
    this.player.onJump = () => AudioManager.play('jump')
    this.player.onDoubleJump = () => {
      AudioManager.play('doublejump')
      const p = this.player!
      this.fx.burst(p.pos.x, p.pos.y + 0.25, p.pos.z, '#f2c14e', 14, 3.6, 0.5)
      this.fx.burst(p.pos.x, p.pos.y + 0.15, p.pos.z, '#ffffff', 8, 2.4, 0.4)
      p.rig.flip() // quick procedural front-flip flourish
      p.glb?.loco.triggerFlip() // the GLB body mirrors it (held 360° spin, v52)
    }
    this.player.onVault = () => AudioManager.play('vault')
    this.player.onSlide = () => {
      AudioManager.play('slide')
      this.camRig.addShake(0.1) // ground-contact thump as the slide starts
    }
    this.player.onDazed = () => { AudioManager.play('hit'); this.store.notify(randomOf(RANDOM_NOTIFICATIONS), 'warning') }
    this.player.onFallRecover = () => {
      AudioManager.play('land')
      this.store.notify('Fall recovery — back on solid ground', 'info')
      this.fx.burst(this.player!.pos.x, this.player!.pos.y + 0.4, this.player!.pos.z, '#f2c14e', 10, 2.6, 0.4)
    }
    this.player.onNanRecover = (reason) => {
      // positional glitch self-healed — tell the player (so a repeat is reportable)
      // and keep a diagnostic breadcrumb for QA on the live game handle.
      const g = this.player!
      const w = window as unknown as { __vcDiag?: Array<Record<string, unknown>> }
      if (reason === 'bounds') {
        // finite-but-outside-the-map position (survives the NaN sentinel) — the
        // city is left behind beyond the cull radius, reading as a sky-only world
        console.warn('[VoteChor] Out-of-bounds position recovered — returned to last safe ground', {
          mode: this.mode, offline: this.offline, worldTime: Math.round(this.worldTime),
          restoredTo: { x: g.pos.x, y: g.pos.y, z: g.pos.z }, t: new Date().toISOString(),
        })
        ;(w.__vcDiag ??= []).push({ kind: 'boundsRecover', t: Date.now(), mode: this.mode, at: { x: g.pos.x, z: g.pos.z } })
        this.store.notify('You wandered off the map — returned to the protest zone', 'info')
        return
      }
      console.warn('[VoteChor] Numeric glitch recovered — position snapped back to last safe ground', {
        mode: this.mode, offline: this.offline, worldTime: Math.round(this.worldTime),
        restoredTo: { x: g.pos.x, y: g.pos.y, z: g.pos.z }, t: new Date().toISOString(),
      })
      ;(w.__vcDiag ??= []).push({ kind: 'nanRecover', t: Date.now(), mode: this.mode, at: { x: g.pos.x, z: g.pos.z } })
      this.store.notify('Recovered from a graphics glitch — world restored', 'warning')
    }
    this.engine.scene.add(this.player.rig.group)
    // High-Fi GLB player model (settings toggle; silently skips when the asset fails)
    if (useGameStore.getState().settings.hiFiModel) void this.tryAttachHiFi()
    this.camRig.yaw = 0 // camera behind player, looking down the road (-z)

    // impostor crowd for rig-less remotes — every mode needs it (solo seasons spawn ~99 bots)
    if (!this.crowd) this.crowd = new CrowdLod(this.engine.scene)
    this.crowd.setVisible(true)
    this.lastCrowdSync = 0

    // reset local npc brains (patrol passed RAW — see note in boot())
    this.localNpcBrains = createNpcStates(this.world.npcs.map(n => ({ id: n.id, type: n.type, x: n.x, z: n.z, patrol: n.patrol })))

    // connect to authoritative server (both modes use it; fallback offline)
    this.offline = true
    store.patchHud({ connection: 'connecting' })
    const connected = await this.net.connect()
    if (connected) {
      this.net.join({
        name,
        archetype: this.archetype,
        roomCode: mode === 'multiplayer' ? roomCode : null,
        cosmetics,
        season: mode === 'solo', // solo queue joins a persistent 100-protester Season
        role: this.role,
      })
      // wait briefly for join ack; ack sets offline=false
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (this.net.playerId || !this.net.connected) { clearInterval(check); resolve() }
        }, 100)
        setTimeout(() => { clearInterval(check); resolve() }, 4000)
      })
      this.offline = !this.net.playerId
    }
    if (this.offline) {
      store.patchHud({ connection: 'offline', playersOnline: 1 })
      store.notify('Offline mode — local patrols active', 'info')
    } else {
      store.patchHud({ connection: 'connected' })
    }

    // police role: swap the suspect roster for the right mode — online has 99 season
    // bots to cuff; offline gets a local "training day" squad so duty is never empty.
    if (this.suspects) { this.suspects.dispose(); this.engine.scene.remove(this.suspects.group); this.suspects = null }
    if (this.role === 'police' && this.offline) {
      this.suspects = new SuspectSystem(this.world, this.world.colliders)
      this.engine.scene.add(this.suspects.group)
    }
    store.patchHud({ role: this.role, arrests: 0 })

    AudioManager.setTheme('ambient')
    AudioManager.startCrowd() // idempotent — rebuilds the bed after a silent-menu stopCrowd()
    AudioManager.setCrowdLevel(0.7)
    store.setUIMode('playing')
    this.input.setEnabled(true)
    this.running = true
    store.notify(this.role === 'police'
      ? 'Officer on duty — detain rowdy protesters! Walk close and press E.'
      : 'The votes are missing. The protest is on. Everybody run!', 'info')
    this.maybeOnboard()
  }

  /** One-time contextual onboarding hints for brand-new protesters. */
  private maybeOnboard() {
    try {
      if (localStorage.getItem('votechor_onboarded')) return
      const tips: [number, string, 'info' | 'squad' | 'warning' | 'boss'][] = [
        [2500, 'Tip: follow the compass up top — gold markers are stolen vote tokens', 'info'],
        [9500, 'Tip: press E near tokens & items to grab them · Q throws a distraction', 'squad'],
        [16500, 'Tip: checkpoints save progress, heal you, and free detained squadmates', 'warning'],
        [23500, 'Warning: get detained and police confiscate ALL your votes & items — your gear drops where you were caught!', 'warning'],
        [30500, 'Tip: 12 tokens unlock the boss gate in the Government District. Good luck!', 'boss'],
      ]
      for (const [delay, text, kind] of tips) {
        this.onboardingTimers.push(setTimeout(() => {
          if (this.running) useGameStore.getState().notify(text, kind)
        }, delay))
      }
      localStorage.setItem('votechor_onboarded', '1')
    } catch { /* private browsing — skip */ }
  }

  private clearOnboarding() {
    for (const t of this.onboardingTimers) clearTimeout(t)
    this.onboardingTimers = []
  }

  /** Refresh the unlocked-emote set (level from profile + medal codes from the API). */
  private refreshUnlockedEmotes() {
    const store = useGameStore.getState()
    const level = store.profile?.level ?? 1
    const seed = new Set<string>()
    for (const e of EMOTE_CATALOG) if (e.unlock.type === 'free') seed.add(e.id)
    this.unlockedEmotes = seed
    try {
      const raw = localStorage.getItem('votechor_profile')
      const token = raw ? (JSON.parse(raw) as { token?: string }).token : null
      fetch('/api/achievements', { headers: token ? { 'x-vc-token': token } : {} })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { unlocked?: string[] } | null) => {
          if (!data?.unlocked) return
          this.unlockedEmotes = new Set([...unlockedEmoteIds(level, data.unlocked)])
        })
        .catch(() => { /* offline — free emotes remain usable */ })
    } catch { /* private browsing — free emotes remain usable */ }
  }

  leaveMatch(force = false) {
    if (this.matchEnded && !force) return // normal mid-match quit; the end screen passes force=true
    this.exitPhotoMode(false)
    this.culler?.showAll() // menu keeps the world group on screen — no cull holes behind the UI
    this.net.leave()
    this.running = false
    this.input.setEnabled(false)
    this.input.suppressed = false
    useGameStore.getState().toggleMap(false)
    useGameStore.getState().toggleSquad(false)
    useGameStore.getState().toggleEmoteWheel(false)
    this.clearOnboarding()
    this.npcs.bubbles.clear()
    this.playerBubbles.clear()
    for (const [id] of this.remotePlayers) this.removeRemote(id) // rigs + GLB instances leave with the match
    if (this.suspects) { this.suspects.dispose(); this.engine.scene.remove(this.suspects.group); this.suspects = null }
    this.crowd?.dispose()
    this.crowd = null
    this.perfRigs = 0
    this.lastHunted = false
    this.squad = { code: null, memberIds: new Set() }
    this.lastSquadCode = null
    this.squadAutoRejoin = false
    this.rallyReadyAt = 0
    this.clearPendingInvite()
    useGameStore.getState().patchHud({ hunted: false, rallyReadyAt: 0 })
    useGameStore.getState().setSquad(null)
    AudioManager.setTheme('none') // v48: landing page is silent — background sound only while a match runs
    AudioManager.stopCrowd()
    AudioManager.stopRain() // v49: kill any lingering weather bed
    const st = useGameStore.getState()
    st.setUIMode('menu')
    st.setMenuScreen('main')
    st.setMatchMode(null)
  }

  // ================= server ack & sync =================
  private onJoinAck(ack: JoinAck) {
    if (!ack.ok) {
      useGameStore.getState().setJoining(false, ack.error ?? 'Join failed')
      useGameStore.getState().notify(ack.error ?? 'Join failed', 'warning')
      return
    }
    this.offline = false
    this.net.playerId = ack.playerId
    this.serverMatchStart = ack.matchStartedAt
    useGameStore.getState().setRoomCode(ack.roomCode)
    useGameStore.getState().patchHud({ playersOnline: ack.players.length })
    // season metadata (solo queue) — the HUD chip + SquadPanel season roster feed off this
    if (ack.season) {
      useGameStore.getState().setSeason(ack.season)
      useGameStore.getState().notify(`Joined ${ack.season.name} — ${ack.season.humans + ack.season.bots} protesters inside (${ack.season.humans} human${ack.season.humans === 1 ? '' : 's'})`, 'squad')
    } else {
      useGameStore.getState().notify(`Joined room ${ack.roomCode}`, 'squad')
    }
    this.tokens = ack.tokensCollected
    this.tokensNeeded = ack.tokensNeeded
    for (const p of ack.players) {
      if (p.id !== ack.playerId) this.addRemote(p)
    }
    // sync world state
    if (ack.checkpoints) ack.checkpoints.forEach(cp => this.activatedCheckpoints.add(cp))
    if (ack.boss && ack.boss.active) this.bossActiveLocal = true
    this.syncRoomRoster()
    // invite deep-link (§15): ?squad=CODE auto-joins the cell right after the room
    if (this.mode === 'multiplayer') {
      try {
        const deepCode = sessionStorage.getItem('vc_squad_deeplink')
        if (deepCode && /^[A-Z0-9]{4}$/.test(deepCode)) {
          sessionStorage.removeItem('vc_squad_deeplink')
          this.squadAutoRejoin = true // silent error path if the cell is gone/full
          this.net.squadJoin(deepCode)
          useGameStore.getState().notify(`Invite link detected — joining cell ${deepCode}…`, 'squad')
        }
      } catch { /* sessionStorage unavailable */ }
    }
  }

  private onServerPlayers(players: import('./shared/types').PlayerNetState[]) {
    if (!this.player) return
    const seen = new Set<string>()
    const now = Date.now()
    for (const p of players) {
      seen.add(p.id)
      if (p.id === this.net.playerId) continue
      let r = this.remotePlayers.get(p.id)
      if (!r) { r = this.addRemote(p) }
      // rogue-snapshot shield: a non-finite remote transform would poison this
      // client's interpolation, name tags and squad rally — drop the sample.
      if (!Number.isFinite(p.x + p.y + p.z + p.ry)) continue
      r.target = { x: p.x, y: p.y, z: p.z, ry: p.ry }
      r.anim = p.anim
      r.health = p.health
      r.detained = p.detained
      r.lastSeen = now
      if (r.rig) r.rig.group.visible = true
    }
    for (const [id, r] of this.remotePlayers) {
      // AOI snapshots omit far bots — only prune entries we haven't heard from in 6s
      if (!seen.has(id) && now - r.lastSeen > 6000) { this.removeRemote(id) }
    }
    const season = useGameStore.getState().season
    useGameStore.getState().patchHud({
      playersOnline: season ? season.humans + season.bots : Math.max(1, seen.size),
    })
    this.ensureRemoteRigs(now)
    this.syncRoomRoster()
  }

  /**
   * Rig budgeting: season worlds hold 100 protesters, but full character rigs are
   * expensive. Humans always get rigs; bots get them by distance rank until the
   * budget is spent (data-only bots remain as minimap/roster dots). A few rigs
   * are created per pass to avoid a single-frame spike on arrival.
   */
  private ensureRemoteRigs(now: number) {
    if (now - this.rigsRebuiltAt < 700) return
    this.rigsRebuiltAt = now
    const px = this.player!.pos.x
    const pz = this.player!.pos.z
    const entries = [...this.remotePlayers.entries()]
    const humans = entries.filter(([id]) => !id.startsWith('bot_'))
    const bots = entries
      .filter(([id]) => id.startsWith('bot_'))
      .sort((a, b) =>
        ((a[1].target.x - px) ** 2 + (a[1].target.z - pz) ** 2) -
        ((b[1].target.x - px) ** 2 + (b[1].target.z - pz) ** 2))
    const botBudget = Math.max(4, Game.MAX_RIGS - humans.length)
    let created = 0
    // humans first — always rigged
    for (const [id, r] of humans) if (!r.rig && created < 4) { this.attachRig(id, r); created++ }
    for (const [id, r] of humans) if (!r.rig) this.attachRig(id, r)
    // bots by distance rank
    let rank = 0
    for (const [id, r] of bots) {
      if (rank < botBudget) {
        if (!r.rig && created < 4) { this.attachRig(id, r); created++ }
        else if (!r.rig) this.attachRig(id, r)
      } else if (r.rig) {
        this.detachRemoteGlb(r) // budget eviction — GLB goes with the rig
        this.engine.scene.remove(r.rig.group)
        r.rig.dispose()
        r.rig = null
      }
      rank++
    }
  }

  private attachRig(id: string, r: RemoteEntry) {
    const c = r.cosmetics
    const skinTone = typeof c?.skinTone === 'string' ? c.skinTone : undefined
    const police = r.role === 'police'
    const rig = new CharacterRig({
      archetype: r.archetype,
      name: r.name,
      hat: typeof c?.hat === 'string' ? c.hat : undefined,
      glasses: c?.glasses === true,
      gender: c?.gender === 'female' ? 'female' : 'male',
      hair: typeof c?.hair === 'string' ? c.hair : undefined,
      signText: typeof c?.signText === 'string' && c.signText ? c.signText : undefined,
      face: typeof c?.face === 'string' ? c.face : undefined,
      build: typeof c?.build === 'string' ? c.build : undefined,
      outfit: police ? undefined : typeof c?.outfit === 'string' ? c.outfit : undefined,
      footwear: typeof c?.footwear === 'string' ? c.footwear : undefined,
      gear: police ? 'none' : typeof c?.gear === 'string' ? c.gear : undefined,
      held: police ? undefined : typeof c?.held === 'string' ? c.held : undefined,
      ...(police ? {
        npcType: 'police' as const,
        policeOutfit: typeof c?.policeOutfit === 'string' ? c.policeOutfit : undefined,
        policeHat: typeof c?.policeHat === 'string' ? c.policeHat : undefined,
      } : {}),
      // uniform palette applies to EVERY police rig (was previously tied to skinTone — fixed in r23)
      ...((police || skinTone) ? (() => {
        const u = police ? policeUniformColors(typeof c?.policeOutfit === 'string' ? c.policeOutfit : undefined) : null
        return {
          colors: {
            ...archetypeById(r.archetype).colors,
            ...(skinTone ? { skin: skinTone } : {}),
            ...(u ? { shirt: u.shirt, pants: u.pants, accent: u.accent } : {}),
          },
        }
      })() : {}),
    })
    rig.group.position.set(r.target.x, r.target.y, r.target.z)
    rig.group.rotation.y = r.target.ry
    this.engine.scene.add(rig.group)
    rig.setNameColor(r.name, police ? '#9ecbff' : this.squad.memberIds.has(id) ? '#7ee08a' : '#ffffff')
    r.rig = rig
    // High-Fi GLB for the remote too (same pipeline as the local player — assets are
    // cached per URL so N remotes share one download). Fire-and-forget; the procedural
    // body stays until the instance is ready, then hides behind the name tag.
    if (this.store.settings.hiFiModel) void this.attachRemoteGlb(id, r)
  }

  /**
   * Attach a gender-matching, archetype-tinted GLB to a remote entry. Reuses the
   * shared GLBAssetManager cache (no duplicate downloads) and never blocks gameplay:
   * any failure leaves the procedural rig rendering as before.
   */
  private async attachRemoteGlb(id: string, r: RemoteEntry) {
    if (r.glb || !r.rig) return
    // police stay on the procedural rig: their uniform/hat/lathi identity reads clearly
    // there, while the textured avatar GLB has no uniform to tint (tintGlb matches no
    // mesh names on it) — an untinted protestor-looking cop would confuse chases.
    if (r.role === 'police') return
    r.glb = { inst: null as unknown as GLBInstance, driver: null as unknown as GLBAnimDriver, loading: true }
    const gender = r.cosmetics?.gender === 'female' ? 'female' : 'male'
    const url = hiFiUrlFor(gender)
    const asset = await this.glbMgr.load(url)
    if (!asset) { r.glb = null; return }
    // entry may have been pruned / rig budget-evicted / setting flipped mid-load
    if (this.remotePlayers.get(id) !== r || !r.rig || !this.store.settings.hiFiModel) { r.glb = null; return }
    const inst = this.glbMgr.instantiate(asset)
    if (!inst) { r.glb = null; return }
    // palette: solid replace on the rigged family's mesh names, multiply tint on
    // the textured avatar's (applyAvatarPalette picks the right map per name)
    const c = r.cosmetics
    const arch = archetypeById(r.archetype)
    const pal = {
      shirt: arch.colors.shirt, pants: arch.colors.pants, accent: arch.colors.accent,
      skin: typeof c?.skinTone === 'string' ? c.skinTone : arch.colors.skin,
    }
    applyAvatarPalette(inst.group, pal)
    inst.group.visible = true
    inst.group.position.set(r.target.x, r.target.y, r.target.z)
    inst.group.rotation.y = r.target.ry
    this.engine.scene.add(inst.group)
    const driver = new GLBAnimDriver(inst.mixer, inst.clips)
    const loco = new GlbLocoFallback()
    loco.patch(inst.group) // arm-swing layer for clip-less models (harmless when clips exist)
    r.rig.setBodyVisible(false) // name tag + alert sprites stay
    r.glb = { inst, driver, loading: false, loco }
    // catch the GLB up to wherever interpolation is right now
    inst.group.position.copy(r.rig.group.position)
    inst.group.rotation.y = r.rig.group.rotation.y
    driver.snap(r.detained ? 'detained' : (r.anim === 'dazed' ? 'hit' : r.anim === 'run' ? 'run' : r.anim === 'walk' ? 'walk' : 'idle') as LocoState)
  }

  /** Dispose one remote entry's GLB instance (scene removal + GPU teardown). */
  private detachRemoteGlb(r: RemoteEntry) {
    if (!r.glb) return
    if (r.glb.inst) { this.engine.scene.remove(r.glb.inst.group); this.glbMgr.disposeInstance(r.glb.inst) }
    r.glb = null
    r.rig?.setBodyVisible(true)
  }

  // ---- High-Fi GLB player model (integration of the GLB pipeline with the player controller) ----

  /**
   * Load + instantiate the gender-matching GLB and attach it to the local player.
   * NEVER blocks the match and NEVER throws — any failure leaves the procedural
   * rig visible (the pipeline's fallback contract).
   */
  private async tryAttachHiFi() {
    const p = this.player
    if (!p || p.glb || !this.hiFiPalette) return
    // police play on the procedural rig (uniform/hat identity — see attachRemoteGlb)
    if (this.role === 'police') return
    const url = hiFiUrlFor(this.hiFiGender)
    const asset = await this.glbMgr.load(url)
    if (!asset) return // loader already logged the reason; procedural stays
    if (!this.player || this.player !== p || p.glb) return // match ended/changed mid-load
    const inst = this.glbMgr.instantiate(asset)
    if (!inst) return
    applyAvatarPalette(inst.group, this.hiFiPalette)
    inst.group.visible = true
    this.engine.scene.add(inst.group)
    const driver = new GLBAnimDriver(inst.mixer, inst.clips)
    p.attachGlb(inst, driver)
  }

  /** Live settings toggle — swap between the GLB and procedural rigs mid-match. */
  private applyHiFiSetting(on: boolean) {
    const p = this.player
    if (!p) return
    if (!on) {
      if (p.glb) {
        this.engine.scene.remove(p.glb.inst.group)
        this.glbMgr.disposeInstance(p.glb.inst)
        p.detachGlb()
      }
      // remotes: restore their procedural bodies, drop the GLB instances
      for (const [, r] of this.remotePlayers) this.detachRemoteGlb(r)
    } else {
      if (!p.glb) void this.tryAttachHiFi()
      for (const [id, r] of this.remotePlayers) if (r.rig && !r.glb) void this.attachRemoteGlb(id, r)
    }
  }

  /** Wardrobe broadcasts race ahead of the first AOI snapshot — stash them here. */
  private pendingCosmetics = new Map<string, Record<string, string | boolean>>()
  /** Same for the chosen side (join events carry role; 10Hz snapshots omit it). */
  private pendingRoles = new Map<string, 'protector' | 'police'>()

  private addRemote(p: import('./shared/types').PlayerNetState) {
    // data-only entry — the rig budget pass (ensureRemoteRigs) attaches real characters
    const cosmetics = p.cosmetics ?? this.pendingCosmetics.get(p.id)
    const role = p.role ?? this.pendingRoles.get(p.id)
    const r: RemoteEntry = { rig: null as import('./character').CharacterRig | null, glb: null, target: { x: p.x, y: p.y, z: p.z, ry: p.ry }, anim: p.anim as AnimName, name: p.name, health: p.health, detained: p.detained, archetype: p.archetype, role, cosmetics, lastSeen: Date.now(), animAcc: 0 }
    this.remotePlayers.set(p.id, r)
    return r
  }

  private removeRemote(id: string) {
    const r = this.remotePlayers.get(id)
    if (r) {
      this.detachRemoteGlb(r) // frees the GLB instance (mixer + GPU memory)
      if (r.rig) { this.engine.scene.remove(r.rig.group); r.rig.dispose() }
      this.remotePlayers.delete(id)
    }
  }

  private onServerBoss(boss: BossNetState, ballots: { id: string; x: number; z: number; taken: boolean }[]) {
    this.bossClient.applyState(boss, this.worldTime)
    this.bossClient.setBallots(ballots, this.worldTime)
    const store = useGameStore.getState()
    if (boss.active) {
      let progress = 0
      let objective = ''
      switch (boss.phase) {
        case 0: objective = 'The Committee arrives...'; break
        case 1: progress = boss.interruptPoints / 120; objective = 'Interrupt the speech — hold megaphone stations!'; break
        case 2: progress = boss.documents / 240; objective = 'Sort documents at the desks!'; break
        case 3: progress = boss.hits / 6; objective = boss.dizzyTimer > 0 ? 'BOSS DIZZY — Throw items at him! (Q)' : 'Dodge the giant stamp!'; break
        case 4: progress = boss.teamworkProgress / 12; objective = 'Hold BOTH team stations!'; break
        case 5: progress = boss.votes / boss.votesNeeded; objective = `Grab ballots → deposit at the box! (${boss.votes}/${boss.votesNeeded})`; break
        case 6: objective = 'DEMOCRACY RESTORED!'; break
      }
      store.patchBoss({
        active: true, phase: boss.phase, phaseName: BOSS_PHASE_NAMES[boss.phase] ?? '',
        health: boss.health, maxHealth: boss.maxHealth, objectiveText: objective,
        progress: Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0,
        votes: boss.votes, votesNeeded: boss.votesNeeded,
        dizzy: boss.stateName === 'dizzy',
      })
    } else {
      store.patchBoss({ active: false })
    }
  }

  /** Offline police duty: a training-day suspect was cuffed (local honesty — same shape as game:arrested). */
  private onLocalArrest(name: string) {
    this.stats.arrests++
    AudioManager.play('capture')
    const p = this.player
    if (p) this.fx.popup(`ARRESTED — ${name}`, '#4e7fb5', p.pos.x, 2.2, p.pos.z)
    this.store.notify(`You detained ${name}. Paperwork pending, obviously.`, 'capture')
  }

  private onCapture(playerId: string, until: number, message: string, lostTokens = 0) {
    if (!this.player) return
    if (playerId === this.net.playerId || this.offline) {
      this.exitPhotoMode(false)
      this.player.detain()
      this.stats.detentions++
      this.detainUntil = until
      this.store.notify(message || randomOf(CAPTURE_MESSAGES), 'capture')
      AudioManager.play('capture')
      this.addShake(0.7)

      // ---- BUSTED: police confiscate all collections & cards ----
      this.carryingBallot = false
      this.carryingBallotId = null
      const droppedTypes = this.inventory.map(i => i.type)
      this.stats.confiscatedItems += droppedTypes.length
      // offline: this.tokens is the personal count; online: the server's lostTokens
      // is authoritative (this.tokens is the GLOBAL team count and must not be used)
      const lost = this.offline ? Math.max(0, this.tokens) : (lostTokens ?? 0)
      if (lost > 0) {
        this.stats.confiscated += lost
        const voteWord = lost === 1 ? 'vote' : 'votes'
        if (droppedTypes.length > 0) {
          this.store.notify(`BUSTED — police confiscated ${lost} ${voteWord} and ${droppedTypes.length} item${droppedTypes.length === 1 ? '' : 's'}! Your gear dropped where you were caught.`, 'capture')
        } else {
          this.store.notify(`BUSTED — police confiscated ${lost} ${voteWord}! They are re-hidden back in the city.`, 'capture')
        }
        this.fx.popup(`−${lost} VOTES CONFISCATED`, '#e2b714', this.player.pos.x, 2.3, this.player.pos.z)
      } else if (droppedTypes.length > 0) {
        this.store.notify(`BUSTED — police dumped your ${droppedTypes.length} item${droppedTypes.length === 1 ? '' : 's'} on the street!`, 'capture')
      }
      if (this.offline) {
        // local sim: re-hide the confiscated votes and scatter the gear right here
        if (lost > 0) {
          let toFree = lost
          for (const it of this.items.items) {
            if (toFree <= 0) break
            if (it.def.type !== 'token' || !it.taken) continue
            it.taken = false
            it.group.visible = true
            it.respawnAt = 0
            toFree--
          }
          this.tokens = 0
        }
        if (droppedTypes.length > 0) {
          this.inventory = []
          this.dropInventoryLocal(droppedTypes, this.player.pos.x, this.player.pos.z)
        }
        this.syncHud()
      } else if (droppedTypes.length > 0) {
        this.inventory = []
        this.net.confiscateInventory(droppedTypes)
        this.syncHud()
      }
    } else {
      const r = this.remotePlayers.get(playerId)
      if (r) r.detained = true
      // season bots get detained constantly — it is world flavor, not toast-worthy
      if (!playerId.startsWith('bot_')) this.store.notify(`Teammate detained: ${r?.name ?? 'someone'}`, 'squad')
    }
  }

  /** Scatter confiscation loot in a ring around a capture spot (offline mode). */
  private dropInventoryLocal(types: ItemType[], cx: number, cz: number) {
    const step = (Math.PI * 2) / Math.max(1, types.length)
    for (let i = 0; i < types.length; i++) {
      const ang = i * step + Math.random() * 0.6
      const r = 1.5 * (0.55 + Math.random() * 0.45)
      this.items.spawnDropped({
        id: `drop_${Date.now().toString(36)}_${Math.floor(Math.random() * 46656).toString(36)}${i}`,
        type: types[i],
        x: cx + Math.cos(ang) * r,
        y: 0.1,
        z: cz + Math.sin(ang) * r,
        respawn: 0, // never respawns — a one-shot loot pile
      })
    }
  }

  private onRelease(playerId: string, x: number, z: number) {
    if (!this.player) return
    if (playerId === this.net.playerId || this.offline) {
      this.player.release(x, z)
      this.store.notify('Released! The paperwork was, tragically, in order.', 'info')
      AudioManager.play('release')
    } else {
      const r = this.remotePlayers.get(playerId)
      if (r) r.detained = false
    }
  }

  private onCheckpoint(cp: number, byName: string, total: number) {
    if (this.activatedCheckpoints.has(cp)) return
    this.activatedCheckpoints.add(cp)
    this.stats.checkpoints = total
    if (this.player) this.fx.popup('CHECKPOINT +60 XP', '#4e9b6e', this.player.pos.x, 2.1, this.player.pos.z)
    this.store.notify(`Checkpoint ${cp} unlocked by ${byName}! (${total}/4)`, 'achievement')
    AudioManager.play('checkpoint')
  }

  private onRemoteHealth(playerId: string, health: number, dazed: boolean) {
    const r = this.remotePlayers.get(playerId)
    if (r) { r.health = health; if (dazed) r.anim = 'dazed' }
  }

  private playRemoteEmote(playerId: string, emote: string) {
    const r = this.remotePlayers.get(playerId)
    if (!r) return
    r.anim = EMOTE_ANIMS[emote] ?? 'celebrate'
    this.sayBubble(playerId, EMOTE_LABELS[emote] ?? emote)
  }

  // ================= squads (§15) =================

  /** Rally perk: teleport to the nearest free cellmate (45s cooldown, multiplayer only). */
  rallyToCell() {
    const store = useGameStore.getState()
    if (!this.player || !this.running) return
    if (this.offline) { store.notify('Rallying needs a live room — go multiplayer!', 'warning'); return }
    if (this.player.state !== 'normal') { store.notify('Cannot rally while detained or dazed', 'warning'); return }
    if (this.squad.memberIds.size < 2) { store.notify('Rally needs a cellmate — form a squad first (Tab)', 'warning'); return }
    if (Date.now() < this.rallyReadyAt) {
      store.notify(`Rally recharging — ${Math.ceil((this.rallyReadyAt - Date.now()) / 1000)}s`, 'warning')
      return
    }
    let best: { id: string; name: string; x: number; y: number; z: number; d: number } | null = null
    for (const [id, r] of this.remotePlayers) {
      if (!this.squad.memberIds.has(id) || r.detained) continue
      const p = r.target
      const d = Math.hypot(p.x - this.player.pos.x, p.z - this.player.pos.z)
      if (!best || d < best.d) best = { id, name: r.name, x: p.x, y: p.y, z: p.z, d }
    }
    if (!best) { store.notify('No free cellmate to rally to — everyone is detained!', 'warning'); return }
    this.player.teleport(best.x, best.z)
    // only trust a finite, world-plausible remote altitude (a rogue/glitched remote
    // snapshot must never poison the local position — see numeric-glitch sentinel)
    if (Number.isFinite(best.y) && best.y >= -2 && best.y <= 16) this.player.pos.y = best.y
    this.camRig.yaw = 0
    this.rallyReadyAt = Date.now() + Game.RALLY_COOLDOWN_MS
    useGameStore.getState().patchHud({ rallyReadyAt: this.rallyReadyAt })
    this.fx.popup('SOLIDARITY RALLY!', '#2e6e4e', best.x, 2.4, best.z)
    this.store.notify(`Rallied to ${best.name} (${Math.round(best.d)}m closer to the cause)`, 'squad')
    AudioManager.play('checkpoint')
  }

  // ================= gifting (§11 eligible item sharing) =================

  /**
   * Feed a nearby street animal (F key, both roles) — consumes one food item
   * (chai / snack / samosa), drops it as a crumb, and the animal walks over,
   * eats, then follows the player as a pet for PET_FOLLOW_SEC. Feeding a
   * current pet again extends the friendship. Works offline AND online (the
   * animal bots are client-side, like the birds).
   */
  private feedAnimal(a: AnimalHandle) {
    if (!this.player || !this.running) return
    if (this.player.isDetained || this.player.isDazed) { this.store.notify('Cannot feed while detained or dazed', 'warning'); return }
    const idx = this.inventory.findIndex((i) => FEED_FOODS.includes(i.type))
    if (idx === -1) {
      this.store.notify(`No food to share — ${a.label} loves chai, snacks & samosas!`, 'info')
      return
    }
    const food = this.inventory[idx]
    this.inventory.splice(idx, 1)
    const res = this.animals.feed(a.idx, this.worldTime, { x: this.player.pos.x, z: this.player.pos.z })
    if (!res) return
    this.player.playAnim('heal', 0.35) // offering gesture
    AudioManager.play('paperRustle', 0.5) // unwrapping the snack
    const foodName = ITEM_CONFIG[food.type as ItemType]?.name ?? food.type
    this.fx.popup(`${res.kind === 'dog' ? '🐕' : res.kind === 'cat' ? '🐈' : '🐄'} ${foodName}!`, '#f2c14e', this.player.pos.x, 2.1, this.player.pos.z)
    if (res.extended) this.store.notify(`${res.label} perks up — friendship extended!`, 'squad')
    this.syncHud()
  }

  /**
   * Gift the most useful inventory item to the nearest live teammate (F key).
   * Server validates distance/rate/type; a rejected gift is refunded via game:giftRefund,
   * and a full-pocket receiver bounces the item back via game:giftBounce.
   */
  giftNearest() {
    const store = useGameStore.getState()
    if (!this.player || !this.running) return
    if (this.offline) { store.notify('Gifting needs teammates — go multiplayer!', 'warning'); return }
    if (this.player.isDetained || this.player.isDazed) { store.notify('Cannot gift while detained or dazed', 'warning'); return }
    if (this.inventory.length === 0) { store.notify('Pockets are empty — nothing to gift!', 'info'); return }
    // nearest live HUMAN within gift range (interpolated positions ≈ server positions;
    // season bots carry no inventory so they are never gift targets)
    let best: { id: string; name: string; d: number; health: number } | null = null
    for (const [id, r] of this.remotePlayers) {
      if (r.detained || id.startsWith('bot_')) continue
      const d = Math.hypot(r.target.x - this.player.pos.x, r.target.z - this.player.pos.z)
      if (d <= GIFT_RADIUS && (!best || d < best.d)) best = { id, name: r.name, d, health: r.health }
    }
    if (!best) { store.notify(`No teammate within ${GIFT_RADIUS}m — get closer to share supplies`, 'info'); return }
    this.giftItemTo(best.id, best.name, best.health)
  }

  /** Gift the most useful item to a SPECIFIC teammate (SquadPanel row button). */
  giftTo(targetId: string) {
    const store = useGameStore.getState()
    if (!this.player || !this.running) return
    if (this.offline) { store.notify('Gifting needs teammates — go multiplayer!', 'warning'); return }
    if (this.player.isDetained || this.player.isDazed) { store.notify('Cannot gift while detained or dazed', 'warning'); return }
    if (this.inventory.length === 0) { store.notify('Pockets are empty — nothing to gift!', 'info'); return }
    const r = this.remotePlayers.get(targetId)
    if (!r) { store.notify('That teammate has left the protest', 'warning'); return }
    if (targetId.startsWith('bot_')) { store.notify('Bots carry no supplies — gift a human teammate', 'info'); return }
    if (r.detained) { store.notify(`${r.name} is detained — bail them out first (hold E)`, 'warning'); return }
    const d = Math.hypot(r.target.x - this.player.pos.x, r.target.z - this.player.pos.z)
    if (d > GIFT_RADIUS) { store.notify(`${r.name} is ${Math.round(d)}m away — get within ${GIFT_RADIUS}m to hand things over`, 'info'); return }
    this.giftItemTo(targetId, r.name, r.health)
  }

  /** Shared gifting core: smart item pick + optimistic send + feedback (caller does the guards). */
  private giftItemTo(targetId: string, targetName: string, targetHealth: number) {
    if (!this.player) return
    // pick the most useful item: firstaid when they are hurt, chai, other consumables, then throwables
    const has = (t: string) => this.inventory.find((i) => i.type === t)
    const pick =
      (targetHealth < 55 ? has('firstaid') : undefined) ??
      has('chai') ?? has('firstaid') ?? has('snack') ?? has('joke') ??
      this.inventory.find((i) => GIFT_TYPES.includes(i.type))
    if (!pick) { this.store.notify('That item cannot be gifted', 'info'); return }
    const idx = this.inventory.findIndex((i) => i.uid === pick.uid)
    this.inventory.splice(idx, 1)
    this.net.gift(targetId, pick.type)
    this.player.playAnim('heal', 0.35)
    const tr = this.remotePlayers.get(targetId)?.target
    if (tr) this.fx.burst(tr.x, 1.2, tr.z, '#f2c14e', 12, 2.4, 0.55) // gift sparkle at the receiver
    this.fx.popup(`🎁 GIFT → ${targetName}`, '#f2c14e', this.player.pos.x, 2.2, this.player.pos.z)
    this.sayBubble('me', randomOf(GIFT_QUIPS))
    AudioManager.play('pickup')
    this.stats.gifts++
    this.store.notify(`Gifted ${ITEM_CONFIG[pick.type as ItemType]?.name ?? pick.type} to ${targetName} — support +1`, 'squad')
    this.syncHud()
  }

  // ================= squad invites (§15) =================

  /** A protester invited us to their cell — show the interactive flyer toast (auto-expires). */
  private onSquadInvite(inv: { fromId: string; fromName: string; code: string }) {
    const store = useGameStore.getState()
    store.setPendingInvite({ fromId: inv.fromId, fromName: inv.fromName, code: inv.code, at: Date.now() })
    store.notify(`${inv.fromName} invites you to cell ${inv.code} — check the flyer!`, 'squad')
    AudioManager.play('token')
    if (this.inviteClearTimer) clearTimeout(this.inviteClearTimer)
    this.inviteClearTimer = setTimeout(() => this.clearPendingInvite(), Game.INVITE_TTL_MS)
  }

  /** Drop the invite flyer (expiry, match end, or a newer invite replacing it). */
  private clearPendingInvite() {
    if (this.inviteClearTimer) { clearTimeout(this.inviteClearTimer); this.inviteClearTimer = null }
    useGameStore.getState().setPendingInvite(null)
  }

  /** A teammate handed us an item (server-validated, targeted event). */
  private onGiftReceived(g: { fromId: string; fromName: string; type: string }) {
    if (this.inventory.length >= INVENTORY_MAX) {
      this.net.giftBounce(g.fromId, g.type)
      this.store.notify(`${g.fromName} tried to gift you ${ITEM_CONFIG[g.type as ItemType]?.name ?? g.type} — pockets full, it bounced!`, 'warning')
      return
    }
    this.inventory.push({ uid: `${g.type}_gift_${Date.now().toString(36)}_${Math.floor(Math.random() * 999)}`, type: g.type as ItemType })
    AudioManager.play('token')
    const r = this.remotePlayers.get(g.fromId)
    if (r?.rig) {
      const pos = r.rig.group.position
      this.fx.popup('🎁 GIFT!', '#7de3a8', pos.x, 2.2, pos.z)
    }
    this.sayBubble(g.fromId, randomOf(GIFT_QUIPS))
    this.player?.playAnim('heal', 0.3) // grateful wiggle
    this.store.notify(`${g.fromName} gifted you a ${ITEM_CONFIG[g.type as ItemType]?.name ?? g.type}! Solidarity!`, 'squad')
    this.syncHud()
  }

  /** Receiver's pockets were full — the item card comes back to us. */
  private onGiftBounced(g: { toId: string; toName: string; type: string }) {
    if (GIFT_TYPES.includes(g.type) && this.inventory.length < INVENTORY_MAX) {
      this.inventory.push({ uid: `${g.type}_back_${Date.now().toString(36)}_${Math.floor(Math.random() * 999)}`, type: g.type as ItemType })
    }
    this.stats.gifts = Math.max(0, this.stats.gifts - 1) // bounced = no support credit
    this.store.notify(`${g.toName}'s pockets are full — your gift bounced back`, 'warning')
    this.syncHud()
  }

  /** Server rejected the gift (distance/rate/type) — refund the item locally. */
  private onGiftRefund(type: string) {
    if (GIFT_TYPES.includes(type) && this.inventory.length < INVENTORY_MAX) {
      this.inventory.push({ uid: `${type}_refund_${Date.now().toString(36)}_${Math.floor(Math.random() * 999)}`, type: type as ItemType })
    }
    this.store.notify('Gift did not land — item returned to your pockets', 'warning')
    this.stats.gifts = Math.max(0, this.stats.gifts - 1)
    this.syncHud()
  }

  // ================= post-match honors (§15 — kudos + MVP) =================

  /** Someone saluted us — celebrate, count it, and persist the stat. */
  private onKudosReceived(k: { fromId: string; fromName: string }) {
    const store = useGameStore.getState()
    store.bumpKudosReceived()
    AudioManager.play('token')
    const pos = this.player?.rig.group.position
    if (pos) this.fx.popup('🙌 KUDOS!', '#f2c14e', pos.x, 2.4, pos.z)
    this.player?.playAnim('celebrate', 0.8)
    store.notify(`${k.fromName} salutes your protest — kudos received! 🙌`, 'squad')
    this.flushSocialStat({ kudos: 1 })
  }

  /** The room's MVP vote concluded — crown the winner (and log our own titles). */
  private onMvpFinal(f: { winnerId: string | null; winnerName: string | null; tally: { id: string; name: string; votes: number }[]; voters: number }) {
    const store = useGameStore.getState()
    if (f.winnerId && f.winnerName) {
      store.setMvpWinner({ winnerId: f.winnerId, winnerName: f.winnerName })
      AudioManager.play('checkpoint')
      store.notify(`🏆 MVP: ${f.winnerName} — ${f.voters} vote${f.voters === 1 ? '' : 's'} cast!`, 'squad')
      if (f.winnerId === this.net.playerId) {
        this.fx.popup('🏆 MVP!', '#f2c14e', this.player?.rig.group.position.x ?? 0, 2.6, this.player?.rig.group.position.z ?? 0)
        store.notify('YOU are the Most Valuable Protester! The aunty is telling everyone.', 'achievement')
        this.flushSocialStat({ mvp: true })
      }
    } else {
      store.setMvpTally({ tally: f.tally, voters: f.voters, roomPlayers: store.postMatch.roomPlayers })
    }
  }

  /** Persist kudos/MVP honors to the profile (fire-and-forget; social stats are cosmetic). */
  private flushSocialStat(delta: { kudos?: number; mvp?: boolean }) {
    if (typeof window === 'undefined') return
    try {
      const token = (JSON.parse(localStorage.getItem('votechor_profile') ?? 'null') as { token?: string } | null)?.token
      if (!token) return
      void fetch('/api/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-vc-token': token },
        body: JSON.stringify(delta),
      }).catch(() => { /* social stats are best-effort */ })
    } catch { /* no profile — nothing to persist */ }
  }

  /** Rebuild the EndScreen roster from the live remote-player set. */
  private syncRoomRoster() {
    if (this.offline || !this.net.playerId) { useGameStore.getState().setRoomRoster([]); return }
    const roster = [...this.remotePlayers.entries()]
      .filter(([id]) => id !== this.net.playerId)
      .map(([id, r]) => ({ id, name: r.name, archetype: r.archetype || 'student', bot: id.startsWith('bot_') }))
    useGameStore.getState().setRoomRoster(roster)
  }

  /** playerjoined fires before the next players broadcast — sync once it lands. */
  private deferredRosterAdd(_playerId: string, _name: string) {
    setTimeout(() => this.syncRoomRoster(), 2500)
  }

  private onSquadUpdate(s: { code: string; members: { id: string; name: string }[] } | null) {
    const me = this.net.playerId
    if (!s) {
      this.squad = { code: null, memberIds: new Set() }
      this.lastSquadCode = null
      useGameStore.getState().setSquad(null)
    } else {
      const restoring = this.squadAutoRejoin
      this.squadAutoRejoin = false
      this.squad = { code: s.code, memberIds: new Set(s.members.map((m) => m.id)) }
      this.lastSquadCode = s.code
      useGameStore.getState().setSquad({ code: s.code, members: s.members })
      if (this.squad.memberIds.has(me)) {
        this.store.notify(
          restoring
            ? `Squad ${s.code} restored — back in the cell!`
            : `Squad ${s.code} — ${s.members.length}/4 strong. Name tags recolored!`,
          'squad',
        )
      }
    }
    // squadmates wear green name tags; everyone else stays white
    for (const [id, r] of this.remotePlayers) {
      if (r.rig) r.rig.setNameColor(r.name, this.squad.memberIds.has(id) ? '#7ee08a' : '#ffffff')
    }
  }

  // ================= input & actions =================
  private handleOneShot(a: string) {
    const store = useGameStore.getState()
    switch (a) {
      case 'pause': {
        // while the big map is open, Escape closes the map instead of pausing
        if (store.mapOpen) { store.toggleMap(false); break }
        // v44 — same contract for the T comms panel: Escape closes chat, not the game
        if (store.chatOpen) { store.toggleChat(false); break }
        // v35 debounce — some browsers deliver BOTH the Escape keydown and the
        // pointer-lock change for one physical press; without this latch the toggle
        // would open+close the modal in the same frame and it would never show.
        const now = performance.now()
        if (now - this.lastPauseToggleAt < 350) break
        this.lastPauseToggleAt = now
        if (store.uiMode === 'playing') {
          this.exitPhotoMode(false)
          store.setUIMode('paused')
          this.input.setEnabled(false)
          // v35 — guarantee a visible cursor for the menu buttons even if the
          // browser kept the pointer locked through the keydown path. releasePointer
          // latches pauseOnUnlock=false to suppress the unlock event we ourselves
          // trigger, so re-arm immediately: the unlock (if any) is already gated by
          // enabled=false, and FUTURE user-initiated unlocks must still pause.
          this.input.releasePointer()
          this.input.pauseOnUnlock = true
        } else if (store.uiMode === 'paused') {
          store.setUIMode('playing')
          this.input.setEnabled(true)
        }
        break
      }
      case 'jump': this.pendingOneShot = 'jump'; break
      case 'slide': this.pendingOneShot = 'slide'; break
      case 'throw': this.doThrow(); break
      case 'emote': store.toggleEmoteWheel(); break
      case 'map': store.toggleMap(); break
      case 'squad':
        // v42 — Options → Interface can disable the squad panel entirely. Tab then
        // does nothing except ONE gentle per-session reminder, so a dead key is
        // never a mystery (re-enable from the pause menu → Options → Interface).
        if (store.settings.squadPanel === false) {
          if (!this.squadPanelOffNotified) {
            this.squadPanelOffNotified = true
            store.notify('Squad panel is off — enable it in Options → Interface', 'info')
          }
          break
        }
        store.toggleSquad()
        break
      case 'gift': {
        // context-sensitive F — feeding a street animal always wins (works for
        // both roles: kind officers feed strays too)
        const hungry = this.animals?.nearestFeedable(this.player!.pos.x, this.player!.pos.z, FEED_RADIUS)
        if (hungry) { this.feedAnimal(hungry); break }
        // officers swing the lathi, protesters gift supplies
        if (this.role === 'police') this.doBatonStrike()
        else this.giftNearest()
        break
      }
      case 'strike': this.doBatonStrike(); break // touch button — police role only
      case 'shout': this.doShout(); break
      case 'heal': this.quickHeal(); break
    }
  }

  private doThrow() {
    if (!this.player || this.player.isDetained || this.player.isDazed) return
    const idx = this.inventory.findIndex(i => ['bottle', 'sign', 'foam'].includes(i.type))
    if (idx === -1) { this.store.notify('Nothing to throw! Grab a bottle.', 'info'); return }
    const item = this.inventory[idx]
    this.inventory.splice(idx, 1)
    const camDir = new THREE.Vector3()
    this.engine.camera.getWorldDirection(camDir)
    const dir = { x: camDir.x, z: camDir.z }
    const len = Math.hypot(dir.x, dir.z) || 1
    const power = 11
    const from = this.player.pos
    const impact = (ix: number, _iy: number, iz: number) => {
      AudioManager.play('impact')
      this.stats.distractions++
      // The thrown item SURVIVES the landing — it becomes a ground pickup that
      // anyone (including the thrower) can grab again. Offline: spawn locally.
      // Online: the server drop registry is the single source of truth — report
      // the landing spot and the relayed game:dropped spawns it for everyone.
      if (this.offline) this.spawnLandedItem(item.type, ix, iz)
      else this.net.dropItem(item.type, ix, iz)
      if (this.offline) {
        this.npcs.distraction(ix, iz, this.archetype === 'strategist' ? 9 : 5.5)
      } else {
        this.net.noiseEvent(ix, iz)
      }
      // boss hit check
      if (this.offline && this.localBoss && this.localBoss.phase === 3 && this.localBoss.dizzyTimer > 0) {
        const d = Math.hypot(ix - this.localBoss.x, iz - this.localBoss.z)
        if (d < 4 && registerBossHit(this.localBoss, this.net.playerId || 'local', Date.now())) {
          this.stats.bossHits++
          AudioManager.play('bossHit')
          this.fx.popup('BONK! -1 SHIELD', '#ff9f1c', ix, 3, iz)
        }
      }
    }
    this.items.throwItem(item.type, from, { x: dir.x / len, z: dir.z / len }, power, 'me', this.offline, impact)
    if (!this.offline) this.net.throwItem(item.type, from.x, from.y, from.z, (dir.x / len) * power, 5.2, (dir.z / len) * power)
    this.player.playAnim('throw', 0.35)
    AudioManager.play('throw')
    this.syncHud()
  }

  private useInventoryItem(uid: string) {
    if (!this.player) return
    if (this.player.isDetained) { this.store.notify('No snacking in a police cell.', 'warning'); return }
    const idx = this.inventory.findIndex(i => i.uid === uid)
    if (idx === -1) return
    const item = this.inventory[idx]
    const p = this.player
    switch (item.type) {
      case 'chai':
        p.heal(10)
        p.stamina = p.maxStamina
        p.speedBoostUntil = this.worldTime + 6
        this.fx.burst(p.pos.x, p.pos.y + 0.9, p.pos.z, '#7de3a8', 10, 2.2, 0.5)
        AudioManager.play('heal')
        this.fx.popup('+10 HP', '#ff8fa3', p.pos.x, 2.1, p.pos.z)
        this.store.notify('Chai break! +10 HP, stamina restored. Zindagi ek baar milta hai.', 'info')
        break
      case 'firstaid':
        p.heal(50)
        this.fx.burst(p.pos.x, p.pos.y + 0.9, p.pos.z, '#7de3a8', 14, 2.6, 0.55)
        AudioManager.play('heal')
        this.fx.popup('+50 HP', '#ff8fa3', p.pos.x, 1.9, p.pos.z)
        this.store.notify('Patched up with one (1) band-aid.', 'info')
        break
      case 'snack':
        p.heal(5)
        p.speedBoostUntil = this.worldTime + 8
        this.fx.burst(p.pos.x, p.pos.y + 0.9, p.pos.z, '#7de3a8', 7, 1.8, 0.45)
        AudioManager.play('pickup')
        this.fx.popup('+5 HP', '#ff8fa3', p.pos.x, 2.1, p.pos.z)
        this.store.notify('Sugar rush! +5 HP and speed boost for 8s.', 'info')
        break
      case 'joke': {
        const jokes = ['Delicious. Illegal. Worth it.', 'The samosa was filled with classified documents.', 'You feel oddly empowered.', '+10 confidence. -2 health code compliance.']
        p.heal(10)
        this.fx.burst(p.pos.x, p.pos.y + 0.9, p.pos.z, '#7de3a8', 10, 2.2, 0.5)
        AudioManager.play('cash')
        this.fx.popup('+10 HP', '#ff8fa3', p.pos.x, 2.1, p.pos.z)
        this.store.notify(randomOf(jokes), 'info')
        break
      }
      default:
        this.store.notify(`${ITEM_CONFIG[item.type]?.name}: use Q to throw it!`, 'info')
        return
    }
    this.inventory.splice(idx, 1)
    this.syncHud()
  }

  /** H — eat the most useful food/medkit in the pockets. Big wounds take the first-aid kit,
   *  small ones get chai/samosa/snack so nothing is wasted on overkill. */
  private quickHeal() {
    if (!this.player || this.player.isDetained || this.player.isDazed) return
    if (this.player.health >= this.player.maxHealth) {
      this.store.notify('Health already full — save the food for later.', 'info')
      return
    }
    const missing = this.player.maxHealth - this.player.health
    const has = (t: ItemType) => this.inventory.find((i) => i.type === t)
    // pick ladder: big wounds take the first-aid kit; scrapes take the smallest
    // snack so nothing is wasted on overkill; then chai / joke / snack / kit
    const pick = (missing >= 45 ? has('firstaid') : undefined) ?? (missing <= 6 ? has('snack') : undefined) ?? has('chai') ?? has('joke') ?? has('snack') ?? has('firstaid')
    if (!pick) {
      this.store.notify('Pockets empty — no chai, samosa or first-aid. Collect food to heal!', 'warning')
      return
    }
    this.useInventoryItem(pick.uid)
  }

  /** V — shout / whistle: a free noise distraction that pulls nearby police to investigate. */
  private doShout() {
    if (!this.player || this.player.isDetained || this.player.isDazed) return
    const now = performance.now()
    if (now - this.lastShoutAt < SHOUT_COOLDOWN_SEC * 1000) return
    this.lastShoutAt = now
    const line = randomOf(SHOUT_LINES)
    const whistle = line.startsWith('*')
    const p = this.player
    p.playAnim(whistle ? 'throw' : 'celebrate', 0.9) // hand-to-mouth whistle pose vs arms-up yell
    this.sayBubble('me', line)
    this.fx.burst(p.pos.x, p.pos.y + 0.3, p.pos.z, '#f2c14e', 12, 4.6, 0.65) // expanding noise ring
    AudioManager.play(whistle ? 'whistle' : 'shout')
    if (this.offline) {
      this.npcs.distraction(p.pos.x, p.pos.z, 6)
    } else {
      this.net.noiseEvent(p.pos.x, p.pos.z)
      // v45 — the rest of the room HEARS the shout/whistle from where it came
      this.net.shoutEvent(p.pos.x, p.pos.z, whistle, line)
    }
  }

  /**
   * v45 — a team-mate's V-shout/whistle arrived: spatial voice (pan + distance
   * falloff), their rig does the matching pose, and the bubble shows the same
   * line the shouter saw. This is the "other players can hear you" half of the
   * noise system — previously game:noise only steered NPC police attention.
   */
  private onRemoteShout(playerId: string, x: number, z: number, whistle: boolean, line: string) {
    if (playerId === this.net.playerId || !this.player) return // server relays to the whole room, incl. sender
    const r = this.remotePlayers.get(playerId)
    if (r) {
      r.anim = whistle ? 'throw' : 'celebrate' // hand-to-mouth whistle vs arms-up yell
      this.sayBubble(playerId, line || (whistle ? '*shrill whistle*' : 'AAZADII!'))
    }
    const p = this.player
    AudioManager.playAt(whistle ? 'whistle' : 'shout', x, z, p.pos.x, p.pos.z, this.camRig.yaw, 55, 1.15)
    if (Math.hypot(x - p.pos.x, z - p.pos.z) < 32) {
      this.fx.burst(x, (r ? r.target.y : p.pos.y) + 1.4, z, '#f2c14e', 10, 4.2, 0.6)
    }
  }

  /** Random officer bark shown above the striker when a baton hit connects. */
  private static STRIKE_LINES = ['Stand down!', 'Move along!', 'Committee business here!', 'You are detained… almost.', 'Order! ORDER!']

  /**
   * F (police role) — baton strike. Officers swing the lathi at the nearest
   * protester / training-day suspect within POLICE_STRIKE.range.
   * Offline: suspects take a knockback + stagger (no HP bars on training day).
   * Online: `game:policeHit` → the server re-validates role/range/cooldown and
   * applies POLICE_STRIKE.dmg through damagePlayer (the victim's own client then
   * plays the full police hit feel from the `game:damage` event, kind 'police').
   */
  private doBatonStrike() {
    if (!this.player || this.player.isDetained || this.player.isDazed) return
    if (this.role !== 'police') return // baton is officers-only (touch button safety)
    const now = performance.now()
    if (now - this.lastPlayerStrikeAt < POLICE_STRIKE.cooldownMs) return
    this.lastPlayerStrikeAt = now
    const p = this.player
    p.playAnim('throw', 1.1) // lathi swing
    AudioManager.play('throw') // whoosh

    // v47 — ELEVATION-AWARE REACH: protesters used to perch on carts, the stage,
    // the fountain rim or containers where the officer's collider could not get
    // within the flat 2.6 m lathi range — a free camp-and-taunt spot. The lathi
    // now reaches UP: effective horizontal range grows with the target's height
    // above the officer (same formula the server validates in room.ts).
    const lathiReach = (targetY: number) => POLICE_STRIKE.range + Math.min(Math.max(0, targetY - p.pos.y) * 0.75, 2.2)

    if (this.offline) {
      const s = this.suspects?.nearest(p.pos.x, p.pos.z, lathiReach(1.2)) // suspects are ground-bound; 1.2 covers a step-up perch
      if (!s) { this.fx.popup('whiff…', '#9c948a', p.pos.x, 2.0, p.pos.z); return }
      const hit = this.suspects?.hit(s.id, p.pos.x, p.pos.z, Date.now())
      if (!hit) return
      AudioManager.play('hit')
      this.addShake(0.22) // baton connect weight
      this.fx.burst(hit.x, p.pos.y + 1.1, hit.z, '#f2c14e', 8, 2.6, 0.4)
      this.fx.popup(`THWACK — ${hit.name}`, '#c9482e', hit.x, 2.1, hit.z)
      this.sayBubble('me', randomOf(Game.STRIKE_LINES))
      return
    }

    // online: nearest cuffable protester within lathi reach (height-aware — v47)
    let best: { id: string; name: string; d: number } | null = null
    for (const [id, r] of this.remotePlayers) {
      if (r.detained || r.role === 'police') continue
      const d = Math.hypot(r.target.x - p.pos.x, r.target.z - p.pos.z)
      if (d <= lathiReach(r.target.y) && (!best || d < best.d)) best = { id, name: r.name, d }
    }
    if (!best) { this.fx.popup('whiff…', '#9c948a', p.pos.x, 2.0, p.pos.z); return }
    this.net.strike(best.id) // server confirms via game:damage on the victim + game:strike broadcast
    AudioManager.play('hit')
    this.addShake(0.22) // baton connect weight
    const r = this.remotePlayers.get(best.id)
    if (r) {
      this.fx.burst(r.target.x, 1.1, r.target.z, '#f2c14e', 8, 2.6, 0.4)
      this.fx.popup(`THWACK — ${r.name}`, '#c9482e', p.pos.x, 2.3, p.pos.z)
    }
    this.sayBubble('me', randomOf(Game.STRIKE_LINES))
  }

  /** Room-wide baton FX: someone (possibly me) just connected a strike. */
  private onRemoteStrike(fromId: string, targetId: string, x: number, z: number) {
    // my own strikes already played their local prediction FX in doBatonStrike
    if (fromId === this.net.playerId) return
    const from = this.remotePlayers.get(fromId)
    if (from?.rig) {
      // one-shot swing pose — state updates at 12Hz would overwrite r.anim, so force it
      from.rig.forceAnim = 'throw'
      setTimeout(() => { if (from.rig) from.rig.forceAnim = null }, 380)
    }
    // victim handles their own damage feel via game:damage; everyone nearby hears the thwack
    if (targetId === this.net.playerId || !this.player) return
    const d = Math.hypot(x - this.player.pos.x, z - this.player.pos.z)
    if (d < 26) {
      AudioManager.play('hit')
      this.fx.burst(x, 1.1, z, '#f2c14e', 8, 2.6, 0.4)
    }
  }

  /** A landed (thrown) or dropped item becomes a shared world pickup. Offline
   *  helper — online the server's game:dropped relay spawns it for everyone. */
  private spawnLandedItem(type: ItemType, x: number, z: number) {
    const y = this.physics.groundHeight(x, z, 2) + 0.1
    this.items.spawnDropped({
      id: `drop_${Date.now().toString(36)}_${Math.floor(Math.random() * 46656).toString(36)}l`,
      type, x, y, z,
      respawn: 0, // one-shot: taken = gone (no infinite item fountain)
    })
  }

  private dropInventoryItem(uid: string) {
    const idx = this.inventory.findIndex(i => i.uid === uid)
    if (idx === -1 || !this.player) return
    const item = this.inventory[idx]
    this.inventory.splice(idx, 1)
    if (this.offline) {
      // world drop beside the player — visible, pickable, one-shot
      this.spawnLandedItem(item.type, this.player.pos.x + (Math.random() - 0.5) * 1.6, this.player.pos.z + (Math.random() - 0.5) * 1.6)
      AudioManager.play('paperRustle')
    } else {
      // server registers the drop + relays game:dropped to the room (us included)
      this.net.dropItem(item.type, this.player.pos.x, this.player.pos.z)
      AudioManager.play('paperRustle')
    }
    this.store.notify(`${ITEM_CONFIG[item.type]?.name ?? item.type} dropped — anyone can pick it up`, 'info')
    this.syncHud()
  }

  private playEmote(emote: string) {
    if (!this.player) return
    // §16 progression gate — server catalog shared with the emote wheel UI
    const level = useGameStore.getState().profile?.level ?? 1
    if (!emoteIsUnlocked(emote, level, this.unlockedEmotes)) {
      const item = EMOTE_CATALOG.find((e) => e.id === emote)
      if (item) {
        const why = item.unlock.type === 'level'
          ? `Reach level ${item.unlock.level}`
          : item.unlock.type === 'achievement'
            ? `Earn medal: ${item.unlock.code.replaceAll('_', ' ').toUpperCase()}`
            : 'Emote locked'
        this.store.notify(`Emote locked — ${why}`, 'warning')
      }
      return
    }
    this.player.playAnim(EMOTE_ANIMS[emote] ?? 'celebrate', 1.6)
    this.net.emote(emote)
    this.sayBubble('me', EMOTE_LABELS[emote] ?? emote)
    useGameStore.getState().toggleEmoteWheel(false)
  }

  /** Speech bubble above a player (local 'me' or a remote rig). */
  private sayBubble(key: string, text: string) {
    if (!text) return
    const getPos = (): THREE.Vector3 | null => {
      if (key === 'me') return this.player ? this.player.pos.clone() : null
      const r = this.remotePlayers.get(key)
      return r?.rig ? r.rig.group.position.clone() : null
    }
    this.playerBubbles.say(key, text, getPos, key === 'me' ? 3.2 : 4)
  }

  private onRemoteQuickMsg(playerId: string, msgId: number) {
    if (playerId === this.net.playerId) return // server relays to the whole room, incl. sender
    const msg = QUICK_MESSAGES[msgId]
    if (!msg) return
    const r = this.remotePlayers.get(playerId)
    if (r) this.sayBubble(playerId, msg)
    // bots chat constantly — bubbles only (nearby rigs), no toast spam
    if (!playerId.startsWith('bot_')) this.store.notify(`${r?.name ?? 'Protester'}: ${msg}`, 'squad')
  }

  // ================= v44 — T comms: free-text chat + coordinate sharing =================

  private chatSeq = 1

  /** Free-text chat from the comms panel: relay, bubble and log locally (offline too). */
  sendChat(raw: string) {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, 90)
    if (!text) return
    const store = useGameStore.getState()
    const name = this.store.profile?.name ?? 'Protester'
    store.pushChat({ id: this.chatSeq++, name, text, at: Date.now(), mine: true, bot: false })
    this.sayBubble('me', text)
    this.net.chat(text)
  }

  private onRemoteChat(playerId: string, name: string, text: string) {
    if (playerId === this.net.playerId) return // server relays to the whole room, incl. sender
    const clean = String(text ?? '').slice(0, 90)
    if (!clean) return
    const bot = playerId.startsWith('bot_')
    const r = this.remotePlayers.get(playerId)
    const shown = r?.name ?? name ?? 'Protester'
    useGameStore.getState().pushChat({ id: this.chatSeq++, name: shown, text: clean, at: Date.now(), mine: false, bot })
    if (r) this.sayBubble(playerId, clean)
    // coordinates shared by humans get a toast so they're hard to miss
    if (!bot && /\bX\s*-?\d/i.test(clean)) this.store.notify(`${shown}: ${clean}`, 'squad')
  }

  /**
   * v44 — which district does THIS solo match play? `selectedMapId` (Play screen
   * picker) wins when it is still unlocked by the current profile level; anything
   * stale/locked falls back to the level-earned district. Multiplayer is untouched
   * (rooms are the classic city — the shared room world).
   */
  private pickSoloMapId(store: { profile?: { level?: number } | null; selectedMapId?: string | null }): string {
    const level = store.profile?.level ?? 1
    const sel = store.selectedMapId ? mapById(store.selectedMapId) : null
    if (sel && sel.minLevel <= level) return sel.id
    return mapForLevel(level).id
  }

  private handleVehicleHit(kind: string, x: number, z: number, dmg: number) {
    if (!this.player) return
    if (this.player.damage(dmg, kind)) {
      this.store.notify(kind === 'cow' ? 'Headbutted by a cow. It regrets nothing.' : 'Traffic remains undefeated.', 'warning')
    }
    this.player.knockback(x, z, kind === 'cow' ? 4 : 9)
    AudioManager.play(kind === 'cow' ? 'moo' : 'horn')
    this.addShake(kind === 'cow' ? 0.3 : 0.8)
    this.applyDamage(0, kind) // trigger HUD update
  }

  private applyDamage(amount: number, kind: string) {
    if (!this.player) return
    if (amount > 0) {
      this.player.damage(amount, kind)
      if (kind === 'police') {
        // police baton (Phase 5 feel) — comic thwack + red vignette + stagger + knockback
        this.lastPoliceDamageAt = Date.now()
        this.applyPoliceHitFeel(amount)
      } else {
        AudioManager.play('hit')
        this.addShake(Math.min(0.8, amount / 40))
      }
    }
    this.syncHud()
  }

  /** Camera shake — gated by the accessibility setting (Settings.reducedShake). */
  private addShake(v: number) {
    if (useGameStore.getState().settings.reducedShake) return
    this.camRig.addShake(v)
  }

  /**
   * Full police-baton hit feel on the local player. Fires exactly once per
   * confirmed `game:damage` kind 'police' event (server-authoritative).
   */
  private applyPoliceHitFeel(amount: number) {
    const p = this.player!
    // knock away from the attacker (nearest chasing/wind-up npc targeting me)
    let ax: number | null = null
    let az: number | null = null
    let bestD = 7
    for (const v of this.npcs.visuals) {
      const st = v.brain.state
      if (st !== 'chase' && st !== 'capture' && !this.windupUntil.has(v.brain.id)) continue
      const d = Math.hypot(v.brain.x - p.pos.x, v.brain.z - p.pos.z)
      if (d < bestD) { bestD = d; ax = v.brain.x; az = v.brain.z }
    }
    if (ax !== null && az !== null) p.knockback(ax, az, 7)
    // brief stagger — animOverride only, player state stays 'normal'
    p.playAnim('dazed', 0.35)
    AudioManager.play('policehit')
    this.addShake(0.55)
    this.showDamageFlash()
    this.fx.popup(`-${amount}`, '#ff3b30', p.pos.x, 2.1, p.pos.z)
    this.fx.burst(p.pos.x, p.pos.y + 1.1, p.pos.z, '#ff9f1c', 8, 2.6, 0.35)
  }

  /** Engine-owned full-screen red vignette flash (no Hud.tsx changes needed). */
  private showDamageFlash() {
    const canvas = this.canvasEl
    if (!canvas) return
    if (!this.dmgFlashEl) {
      const el = document.createElement('div')
      el.setAttribute('data-vc-dmg-flash', '')
      el.style.cssText =
        'position:absolute;inset:0;pointer-events:none;z-index:40;opacity:0;' +
        'transition:opacity 0.38s ease-out;' +
        'background:radial-gradient(ellipse at center, rgba(140,31,40,0) 42%, rgba(140,31,40,0.62) 100%)'
      const parent = canvas.parentElement
      if (!parent) return
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative'
      parent.appendChild(el)
      this.dmgFlashEl = el
    }
    const el = this.dmgFlashEl
    el.style.transition = 'opacity 0.05s linear'
    el.style.opacity = '1'
    if (this.dmgFlashTimer) clearTimeout(this.dmgFlashTimer)
    this.dmgFlashTimer = setTimeout(() => {
      if (!this.dmgFlashEl) return
      this.dmgFlashEl.style.transition = 'opacity 0.38s ease-out'
      this.dmgFlashEl.style.opacity = '0'
    }, 90)
  }

  /** Push current vehicle AABBs into the physics world (solid buses/autos/cows). */
  private syncDynamicColliders() {
    // VehicleSystem.getSolidAABBs() is added by the vehicles workstream this round —
    // consume defensively so an older build simply passes an empty list.
    const vs = this.vehicles as VehicleSystem & { getSolidAABBs?: () => AABB[] }
    const boxes = vs.getSolidAABBs?.() ?? []
    this.physics.setDynamic(boxes)
  }

  /** Track server police wind-up/stagger views + the pending strike at this player. */
  private observePoliceTelegraphs(npcs: import('./shared/types').NpcNetState[]) {
    const now = Date.now()
    this.pendingPoliceStrike = null
    for (const n of npcs) {
      if (n.anim === 'windup' && typeof n.attackAt === 'number') {
        this.windupUntil.set(n.id, n.attackAt + 150) // hold the pose briefly past the strike
        if (n.target === this.net.playerId) {
          this.pendingPoliceStrike = { npcId: n.id, attackAt: n.attackAt }
        }
      } else if (n.anim === 'stagger') {
        this.staggerUntil.set(n.id, now + 500)
      }
    }
  }

  /**
   * Per-frame police telegraph polish:
   *  - rigs mid-wind-up hold the lathi 'throw' pose until the strike lands;
   *  - 'stagger' rigs read dazed for half a second;
   *  - the pending strike on the local player is confirmed when attackAt crosses
   *    AND a kind 'police' game:damage arrived within ±400ms (the damage event
   *    itself drives the full hit feel — this only validates/clears the window).
   */
  private updatePoliceTelegraphs() {
    const now = Date.now()
    for (const v of this.npcs.visuals) {
      const id = v.brain.id
      const wu = this.windupUntil.get(id)
      if (wu !== undefined && wu > now) { v.rig.forceAnim = 'throw'; continue }
      const su = this.staggerUntil.get(id)
      if (su !== undefined && su > now) { v.rig.forceAnim = 'dazed'; continue }
      if (wu !== undefined || su !== undefined) v.rig.forceAnim = null
    }
    if (this.windupUntil.size > 12) for (const [id, at] of this.windupUntil) if (at < now - 1000) this.windupUntil.delete(id)
    if (this.staggerUntil.size > 12) for (const [id, at] of this.staggerUntil) if (at < now - 1000) this.staggerUntil.delete(id)

    const ps = this.pendingPoliceStrike
    if (!ps) return
    if (now >= ps.attackAt - 150 && now <= ps.attackAt + 400) {
      // strike moment — confirmed only if the authoritative damage event arrived
      const confirmed = this.lastPoliceDamageAt >= ps.attackAt - 400 && this.lastPoliceDamageAt <= ps.attackAt + 400
      if (confirmed) this.pendingPoliceStrike = null // feel already fired via game:damage
    } else if (now > ps.attackAt + 400) {
      // dodged, packet loss, or the strike landed on someone else — no FX
      this.pendingPoliceStrike = null
    }
  }

  // ================= core loops =================
  private fixedUpdate(dt: number) {
    if (!this.running || !this.player) return
    const store = useGameStore.getState()
    if (store.uiMode !== 'playing') { return }
    this.worldTime += dt
    this.matchTime += dt

    // input — apply look deltas to the camera rig (mouse/touch orbit)
    const [ldx, ldy] = this.input.consumeLook()
    this.camRig.yaw -= ldx
    this.camRig.pitch = this.photoMode
      ? Math.max(-0.2, Math.min(1.25, this.camRig.pitch + ldy))
      : Math.max(-0.55, Math.min(1.15, this.camRig.pitch + ldy))
    const oneShot = this.pendingOneShot
    this.pendingOneShot = null
    const boosted = this.worldTime < this.player.speedBoostUntil
    this.player.applyInput(dt, this.input.state, this.camRig.yaw, this.archetype, oneShot, boosted)
    this.player.tickRegen(dt) // slow out-of-combat health trickle (food is the real healing)

    // world bounds safety
    const b = this.world.bounds
    this.player.pos.x = Math.max(b.minX, Math.min(b.maxX, this.player.pos.x))
    this.player.pos.z = Math.max(b.minZ, Math.min(b.maxZ, this.player.pos.z))
    if (this.player.pos.y < -5) { this.player.teleport(this.world.spawn.x, this.world.spawn.z) }

    // boss gate: block player when closed
    const gateZ = this.world.bossArena.gateZ
    if (!this.gateOpen && this.player.pos.z < gateZ + 0.5 && this.player.pos.z > gateZ - 2 && Math.abs(this.player.pos.x) < 10.5) {
      this.player.pos.z = gateZ + 0.55
      if (this.player.pos.z < gateZ) this.player.pos.z = gateZ + 0.55
    }

    // detention countdown
    if (this.player.isDetained) {
      const remain = Math.max(0, (this.detainUntil - Date.now()) / 1000)
      if (remain <= 0) {
        const cp = this.activatedCheckpoints.size > 0 ? this.world.checkpoints[Math.min(this.activatedCheckpoints.size, this.world.checkpoints.length) - 1] : this.world.checkpoints[0]
        const dp = cp.detention
        if (this.offline) this.player.release(dp.x, dp.z)
        // server path: server sends game:release
      }
    }

    // checkpoints (offline: local activation; online: server detects from positions)
    if (this.offline) {
      for (const cp of this.world.checkpoints) {
        if (this.activatedCheckpoints.has(cp.id)) continue
        if (Math.hypot(this.player.pos.x - cp.x, this.player.pos.z - cp.z) < cp.radius) {
          this.activatedCheckpoints.add(cp.id)
          this.stats.checkpoints = this.activatedCheckpoints.size
          AudioManager.play('checkpoint')
          this.fx.popup('CHECKPOINT +60 XP', '#4e9b6e', this.player.pos.x, 2.1, this.player.pos.z)
          this.store.notify(`Checkpoint ${cp.id} — ${cp.name} unlocked! (${this.activatedCheckpoints.size}/4)`, 'achievement')
        }
      }
    }

    // offline NPC sim + capture (8s spawn grace so players can orient)
    if (this.offline) {
      const pv: NpcPlayerView = {
        id: 'me', x: this.player.pos.x, z: this.player.pos.z,
        detained: this.player.isDetained, dazed: this.player.isDazed,
        hidden: this.matchTime < 8 && Math.hypot(this.player.pos.x - this.world.spawn.x, this.player.pos.z - this.world.spawn.z) < 16,
        police: this.role === 'police', // fellow officers never chase the officer-player
      }
      this.npcs.simulateLocal(dt, pv, this.world.colliders, Date.now())
      // searchlight rotation local
      for (const sl of this.world.searchlights) {
        this.localSearchlightAngles[sl.id] += sl.speed * dt
      }
      // offline police duty: wandering suspects to detain
      if (this.suspects) this.suspects.update(dt, this.player.pos.x, this.player.pos.z, Date.now())
    } else if (this.suspects && this.suspects.group.visible) {
      this.suspects.group.visible = false // went online mid-match — season bots take over
    }

    // vehicles (clock synced to server when online so damage matches visuals)
    const vehicleTime = this.offline || !this.serverMatchStart ? this.matchTime : (Date.now() - this.serverMatchStart) / 1000
    this.vehicles.update(vehicleTime, dt, this.player.pos, true)

    // street animals + birds — independent bots, frozen with the rest of the sim when paused
    this.animals.update(dt, this.worldTime, this.player.pos, Math.hypot(this.player.vel.x, this.player.vel.z), this.camRig.yaw)

    // solid vehicles: feed their current AABBs to physics at ~10Hz so players
    // cannot walk through buses/autos (defensive optional chain — if the vehicle
    // system has not exposed getSolidAABBs yet, this is a no-op)
    if (this.worldTime - this.lastDynSync >= 0.1) {
      this.lastDynSync = this.worldTime
      this.syncDynamicColliders()
    }

    // offline boss tick
    if (this.offline && this.localBoss) {
      this.localBossAccum += dt
      const step = 1 / 10
      let guard = 0
      while (this.localBossAccum >= step && guard++ < 4) {
        this.localBossAccum -= step
        const pv: import('./shared/boss-brain').BossPlayerView = { id: 'me', x: this.player.pos.x, z: this.player.pos.z, detained: this.player.isDetained, dazed: this.player.isDazed }
        const ev = tickBoss(this.localBoss, [pv], step, Date.now())
        for (const d of ev.damage) this.applyDamage(d.amount, d.kind)
        if (ev.speechShock) { AudioManager.play('shockwave'); this.addShake(0.6) }
        if (ev.phaseDone >= 1) {
          AudioManager.play('checkpoint')
          if (ev.defeated) { this.doVictory() }
          else if (ev.phaseDone === 5) AudioManager.play('gate')
        }
        // ballot proximity (grab) — frozen in custody like every other interaction
        if (this.localBoss.phase === 5 && !this.carryingBallot && !this.player.isDetained && !this.player.isDazed) {
          for (const bl of this.localBoss.ballots) {
            if (!bl.taken && Math.hypot(bl.x - this.player.pos.x, bl.z - this.player.pos.z) < 2) {
              bl.taken = true
              this.carryingBallot = true
              this.carryingBallotId = bl.id
              AudioManager.play('pickup')
              break
            }
          }
        }
        if (this.localBoss.phase === 5 && this.carryingBallot && Math.hypot(this.player.pos.x - this.localBoss.x, this.player.pos.z - (this.localBoss.z + 2)) < 3.4) {
          this.carryingBallot = false
          this.carryingBallotId = null
          this.localBoss.votes++
          AudioManager.play('cash')
        }
        // render local boss state
        const bossNet = this.localBossToNet(this.localBoss)
        this.bossClient.applyState(bossNet, this.worldTime)
        this.bossClient.setBallots(this.localBoss.ballots.map(bl => ({ ...bl })), this.worldTime)
        this.updateBossHudLocal(this.localBoss)
        if (this.localBoss.active) this.bossActiveLocal = true
      }
    }

    // item pickup (proximity + E / auto for tokens) — never while in custody
    const near = this.player.isDetained ? null : this.items.nearestAvailable(this.player.pos.x, this.player.pos.z, this.player.pos.y)
    if (near) {
      const isToken = near.def.type === 'token'
      const inRange = true
      if (inRange) {
        const label = isToken ? `E — Grab ${ITEM_CONFIG.token.name}` : `E — Pick up ${ITEM_CONFIG[near.def.type].name}`
        if (this.store.hud.interactPrompt !== label) this.store.patchHud({ interactPrompt: label })
        if (this.input.state.interact) {
          if (!this.interacting) {
            this.interacting = true
            this.pickupItem(near.def.id, near.def.type)
          }
        } else this.interacting = false
      }
    } else {
      // revive / heal teammates / deposit ballots (all server-validated; also frozen in custody)
      let prompt: string | null = null
      if (this.carryingBallot && this.bossActiveLocal && !this.player.isDetained) prompt = 'E — Deposit ballot'
      if (this.input.state.interact && this.carryingBallot && !this.player.isDetained) {
        if (this.offline && this.localBoss) {
          if (Math.hypot(this.player.pos.x - this.localBoss.x, this.player.pos.z - (this.localBoss.z + 2)) < 3.4 && this.carryingBallot) {
            this.carryingBallot = false; this.localBoss.votes++; AudioManager.play('cash')
          }
        } else this.net.bossDeposit(this.player.pos.x, this.player.pos.z)
      }
      // ---- police role: arrest the nearest suspect ----
      // online: any non-detained protester (human or bot) within 2.8 m — server re-validates
      // role, range and cooldown; offline: the local training-day suspect squad.
      if (this.role === 'police' && !this.player.isDetained && !this.player.isDazed && !prompt &&
          Date.now() - this.lastArrestAttemptAt > PLAYER_ROLE.arrestCooldownMs) {
        let target: { id: string; name: string } | null = null
        if (this.offline) {
          const s = this.suspects?.nearest(this.player.pos.x, this.player.pos.z)
          if (s) target = { id: s.id, name: s.name }
        } else {
          // v47 — elevation-aware arrest range (mirrors the server check in room.ts):
          // perching on objects no longer puts suspects out of cuffing reach
          let bestD = Infinity
          for (const [id, r] of this.remotePlayers) {
            if (r.detained || r.role === 'police') continue
            const d = Math.hypot(r.target.x - this.player.pos.x, r.target.z - this.player.pos.z)
            const reach = PLAYER_ROLE.arrestRange + Math.min(Math.max(0, r.target.y - this.player.pos.y) * 0.75, 2.2)
            if (d < reach && d < bestD) { bestD = d; target = { id, name: r.name } }
          }
        }
        if (target) {
          prompt = `E — Arrest ${target.name}`
          if (this.input.state.interact && !this.interacting) {
            this.interacting = true
            this.lastArrestAttemptAt = Date.now()
            if (this.offline) {
              const name = this.suspects?.arrest(target.id, Date.now())
              if (name) this.onLocalArrest(name)
            } else {
              this.net.arrest(target.id) // confirmation arrives via game:arrested
            }
          }
        }
      }
      // ---- police role: baton prompt (F) — shows whenever a protester is in lathi
      // reach but the E-arrest prompt is not up (arrest takes priority: cuffing,
      // not clubbing, is the win condition). F works regardless of this prompt.
      if (this.role === 'police' && !this.player.isDetained && !this.player.isDazed && !prompt) {
        let strikeTarget: string | null = null
        if (this.offline) {
          const s = this.suspects?.nearest(this.player.pos.x, this.player.pos.z, POLICE_STRIKE.range)
          if (s) strikeTarget = s.name
        } else {
          let bestD = POLICE_STRIKE.range + 2.2 // v47 — upper bound; per-target reach checked below
          for (const [, r] of this.remotePlayers) {
            if (r.detained || r.role === 'police') continue
            const d = Math.hypot(r.target.x - this.player.pos.x, r.target.z - this.player.pos.z)
            const reach = POLICE_STRIKE.range + Math.min(Math.max(0, r.target.y - this.player.pos.y) * 0.75, 2.2)
            if (d <= reach && d <= bestD) { bestD = d; strikeTarget = r.name }
          }
        }
        if (strikeTarget) prompt = `F — Baton ${strikeTarget}`
      }
      // ---- feed prompt (F) — a hungry street animal nearby beats every other hint
      if (!prompt && !this.player.isDetained && !this.player.isDazed) {
        const hungry = this.animals?.nearestFeedable(this.player.pos.x, this.player.pos.z, FEED_RADIUS)
        if (hungry) {
          const hasFood = this.inventory.some((i) => FEED_FOODS.includes(i.type))
          prompt = hasFood
            ? `F — feed the ${hungry.kind}`
            : `${hungry.label.replace(/^The /, 'The ')} looks hungry — bring chai or snacks`
        }
      }
      if (this.store.hud.interactPrompt !== prompt) this.store.patchHud({ interactPrompt: prompt })
    }

    // network send 12Hz
    this.stateSendAccum += dt
    if (this.stateSendAccum >= 1 / 12) {
      this.stateSendAccum = 0
      if (!this.offline && this.net.connected && !this.matchEnded) {
        const anim = this.player.netAnim // state-machine output — correct for BOTH animation backends
        this.net.sendState(this.player.pos.x, this.player.pos.y, this.player.pos.z, this.player.ry, anim, {
          tokens: this.tokens,
          carrying: this.carryingBallot,
        })
      }
    }

    // boss ballot proximity (server mode)
    if (!this.offline && this.bossActiveLocal && this.carryingBallot) {
      // deposit via E handled above; grab via proximity:
    }
    if (!this.offline && this.bossActiveLocal && !this.carryingBallot) {
      // grabbing handled by server broadcast game:bossBallot? -> simplified: client sends grab on proximity
    }

    // humor timer
    this.humorTimer -= dt
    if (this.humorTimer <= 0) {
      this.humorTimer = 26 + Math.random() * 20
      this.store.notify(randomOf(RANDOM_NOTIFICATIONS), 'info')
    }

    // match time limit
    if (this.matchTime > MATCH_TIME_LIMIT && !this.matchEnded) {
      this.doTimeUp()
    }

    // HUD sync at ~8Hz
    this.hudAccum += dt
    if (this.hudAccum >= 0.125) {
      this.hudAccum = 0
      this.syncHud()
      this.drawMinimap()
    }
  }

  private pendingOneShot: 'jump' | 'slide' | null = null

  private pickupItem(id: string, type: ItemType) {
    if (!this.player) return
    if (this.inventory.length >= INVENTORY_MAX && type !== 'token') {
      this.store.notify('Pockets full! Drop something first.', 'warning')
      return
    }
    if (this.offline) {
      const it = this.items.localPickup(id, this.worldTime)
      if (!it) return
    } else {
      this.net.pickupItem(id)
      const it = this.items.localPickup(id, this.worldTime) // predict
      if (!it) return
    }
    if (type === 'token') {
      this.tokens++
      this.stats.tokens++
      AudioManager.play('token')
      this.fx.popup('+45 XP', '#f2c14e', this.player.pos.x, 1.9, this.player.pos.z)
      this.fx.popup('VOTE RECOVERED!', '#7de3a8', this.player.pos.x, 2.4, this.player.pos.z)
      if (this.tokens === this.tokensNeeded) {
        this.store.notify(`All ${this.tokensNeeded} votes recovered! The boss gate is OPEN!`, 'achievement')
        AudioManager.play('gate')
      } else if (this.tokens % 4 === 0) {
        this.store.notify(`${this.tokens}/${this.tokensNeeded} votes recovered!`, 'achievement')
      } else {
        this.store.notify(`Vote token recovered! (${this.tokens}/${this.tokensNeeded})`, 'achievement')
      }
      this.checkGate()
    } else {
      this.stats.itemsCollected++
      this.inventory.push({ uid: `${type}_${Date.now().toString(36)}_${Math.floor(Math.random() * 999)}`, type })
      AudioManager.play('pickup')
      this.fx.popup(ITEM_CONFIG[type].icon + ' ' + ITEM_CONFIG[type].name, '#f5efdc', this.player.pos.x, 1.9, this.player.pos.z)
    }
    this.player.playAnim('heal', 0.3)
    this.syncHud()
  }

  private checkGate() {
    if (!this.gateOpen && this.tokens >= this.tokensNeeded) {
      this.gateOpen = true
      this.worldRenderer.setBossGateOpen(true)
    }
  }

  private setGate(open: boolean) {
    this.gateOpen = open
    this.worldRenderer.setBossGateOpen(open)
    if (open) { AudioManager.play('gate'); this.store.notify('THE GATE IS OPEN — The Vote Collector awaits!', 'boss') }
  }

  private localBossToNet(b: BossBrain): BossNetState {
    return {
      active: b.active, phase: b.phase, health: b.health, maxHealth: b.maxHealth,
      stateName: b.stateName, timer: b.timer, speechProgress: b.speech,
      interruptPoints: b.interruptPoints, documents: b.documents, hits: b.hits,
      dizzyTimer: b.dizzyTimer, teamworkProgress: b.teamworkProgress,
      votes: b.votes, votesNeeded: b.votesNeeded, x: b.x, z: b.z, ry: b.ry,
      telegraphs: b.telegraphs.map(t => ({ ...t })), stations: b.stations.map(s => ({ ...s })),
      paperwork: b.paperwork.map(p => ({ id: p.id, x: p.x, z: p.z, vx: p.vx, vz: p.vz })),
    }
  }

  private updateBossHudLocal(b: BossBrain) {
    const store = useGameStore.getState()
    if (!b.active) { store.patchBoss({ active: false }); return }
    let progress = 0, objective = ''
    switch (b.phase) {
      case 0: objective = 'The Committee arrives...'; break
      case 1: progress = b.interruptPoints / 120; objective = 'Interrupt the speech — hold megaphone stations! (E not needed, just stand)'; break
      case 2: progress = b.documents / 240; objective = 'Sort documents at the desks!'; break
      case 3: progress = b.hits / 6; objective = b.dizzyTimer > 0 ? 'BOSS DIZZY — Throw items at him! (Q)' : 'Dodge the giant stamp!'; break
      case 4: progress = b.teamworkProgress / 12; objective = 'Hold the team stations!'; break
      case 5: progress = b.votes / b.votesNeeded; objective = `Grab ballots → deposit at the box! (${b.votes}/${b.votesNeeded})`; break
      case 6: objective = 'DEMOCRACY RESTORED!'; break
    }
    store.patchBoss({
      active: true, phase: b.phase, phaseName: BOSS_PHASE_NAMES[b.phase] ?? '',
      health: b.health, maxHealth: b.maxHealth, objectiveText: objective,
      progress: Math.min(1, Math.max(0, progress)), votes: b.votes, votesNeeded: b.votesNeeded,
      dizzy: b.stateName === 'dizzy',
    })
    if (b.phase >= 1 && !this.bossActiveLocal) {
      this.bossActiveLocal = true
      AudioManager.setTheme('boss')
      store.notify(`${BOSS_NAME} has appeared!`, 'boss')
    }
  }

  // ================= render loop =================
  private renderUpdate(dt: number) {
    if (!this.player) return
    const store = useGameStore.getState()
    // corner minimap (zoomed player-following window) — every frame for smooth re-centering
    this.drawHudMinimap()
    // fx update (floating popups) + player speech bubbles (emotes, quick messages)
    this.fx.update(dt)
    this.playerBubbles.update(dt)

    // boss intro cinematic — orbit the boss once on activation
    this.updateBossCinematic(dt)
    // remote player interpolation (data-only bots have no rig — their target stays fresh)
    for (const [, r] of this.remotePlayers) {
      if (!r.rig) continue
      const pos = r.rig.group.position
      // teleports (detention release, rally, reconnect respawn) snap instead of glide
      const jump = Math.hypot(r.target.x - pos.x, r.target.z - pos.z)
      if (jump > 25) pos.set(r.target.x, r.target.y, r.target.z)
      else pos.lerp(new THREE.Vector3(r.target.x, r.target.y, r.target.z), Math.min(1, dt * 10))
      let d = r.target.ry - r.rig.group.rotation.y
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      r.rig.group.rotation.y += d * Math.min(1, dt * 8)
      const hSpeed = r.anim === 'run' ? 9 : r.anim === 'walk' ? 5 : 0
      // ---- anim LOD: distant rigs (>45m) update their pose at ~15Hz instead of 60Hz ----
      const rDist = Math.hypot(r.target.x - this.player.pos.x, r.target.z - this.player.pos.z)
      let animDt = 0
      if (rDist > 45) {
        r.animAcc += dt
        if (r.animAcc < 0.066) continue
        animDt = r.animAcc
        r.animAcc = 0
      } else {
        animDt = dt
      }
      r.rig.update(animDt, r.detained ? 'detained' : r.anim, hSpeed)
      // High-Fi backend for remotes: the GLB mirrors the interpolated transform and
      // plays the SAME networked anim state (no bone streaming — state names only)
      if (r.glb?.driver) {
        const loco: LocoState = r.detained ? 'detained' : r.anim === 'dazed' ? 'hit' : (r.anim as LocoState)
        // remote airborne state rides on the networked anim name (jump/fall) so the
        // vertex-shader air pose (legs tuck + arms out) plays for remotes too
        const airborne = r.anim === 'jump' || r.anim === 'fall'
        r.glb.driver.play(loco, {
          grounded: !airborne, vy: 0, hSpeed,
          sliding: false, dazed: r.anim === 'dazed', detained: r.detained,
          landTimer: 0, recoverTimer: 0, jumpsUsed: 0,
        })
        r.glb.driver.update(animDt)
        r.glb.inst.group.position.copy(pos)
        r.glb.inst.group.rotation.y = r.rig.group.rotation.y
        // clip-less models (textured avatar) get the procedural bob/lean/arm+leg layer
        if (r.glb.driver.playableClips === 0 && r.glb.loco) r.glb.loco.apply(r.glb.inst.group, animDt, hSpeed, !airborne, { baseY: pos.y })
      }
    }

    // impostor crowd — cheap silhouettes for rig-less remotes; matrices refreshed at ~10Hz
    if (this.crowd && this.player) {
      const nowMs = performance.now()
      if (nowMs - this.lastCrowdSync >= 100) {
        this.lastCrowdSync = nowMs
        this.syncCrowd(nowMs)
      }
    }

    const playing = store.uiMode === 'playing'
    if (playing) {
      this.player.render(dt)
      this.npcs.update(dt, 1, this.worldTime, this.player.pos.x, this.player.pos.z)
      this.updatePoliceTelegraphs()
      this.items.update(dt, this.worldTime, this.worldTime)
    } else {
      this.npcs.update(dt, 1, this.worldTime)
    }

    // ---- sprint/slide camera feel ----
    // speed FOV kick: walking = baseline, sprint +~3.5°, slide +~6° (hSpeed 12+)
    const hSpeed = Math.hypot(this.player.vel.x, this.player.vel.z)
    const targetFov = 62 + Math.min(6.5, Math.max(0, (hSpeed - 5.4) * 0.9))
    if (Math.abs(this.engine.camera.fov - targetFov) > 0.04) {
      this.engine.camera.fov += (targetFov - this.engine.camera.fov) * Math.min(1, dt * 5)
      this.engine.camera.updateProjectionMatrix()
    }
    // slide dip: the camera sinks toward the road while sliding (lerped both ways)
    const slideTarget = this.player.state === 'sliding' ? 1 : 0
    this.slideAmt += (slideTarget - this.slideAmt) * Math.min(1, dt * 7)
    if (this.slideAmt > 0.001) this.camRig.offset.y = 1.55 - this.slideAmt * 0.42
    // slide dust — small puffs kicked up behind the glide
    if (this.player.state === 'sliding' && this.player.grounded) {
      this.slideDustT -= dt
      if (this.slideDustT <= 0) {
        this.slideDustT = 0.07
        this.fx.burst(this.player.pos.x, this.player.pos.y + 0.14, this.player.pos.z, '#cfc4b0', 3, 1.8, 0.4)
      }
    }

    // camera — spectate a live teammate while detained; photo mode orbits the player
    let focus: THREE.Vector3 = this.player.pos
    this.spectateName = null
    if (this.player.isDetained) {
      let bestDist = Infinity
      for (const [, r] of this.remotePlayers) {
        if (r.detained) continue
        const d = Math.hypot(r.target.x - this.player.pos.x, r.target.z - this.player.pos.z)
        if (d < bestDist) {
          bestDist = d
          focus = new THREE.Vector3(r.target.x, r.target.y, r.target.z)
          this.spectateName = r.name
        }
      }
    }
    if (this.photoMode) {
      this.camRig.yaw -= dt * 0.1 // slow cinematic drift when the mouse is still
      // NOTE: targetDistance is owned by photoZoom (wheel/buttons); do not reset it here
      this.camRig.update(dt, focus, 0, 0)
    } else if (!this.bossCinematic.active) {
      this.camRig.update(dt, focus, 0, 0)
    }
    this.engine.trackSun(focus)

    // ---- atmosphere: day/night cycle + weather (drives fog, lights, exposure, rain) ----
    const gst = useGameStore.getState()
    const settings = gst.settings
    const sky = this.engine.sky
    sky.setTimeMode(settings.timeMode ?? 'cycle')
    sky.setWeatherMode(settings.weatherMode ?? 'auto')
    sky.update(dt, focus)
    this.engine.renderer.toneMappingExposure = sky.exposure
    this.worldRenderer.setNight(sky.nightFactor, focus)
    // v49: rain AUDIO only while a match session is on screen — renderUpdate keeps running
    // behind menus, and an ungated setRain() used to park a looping rain bed after quit.
    AudioManager.setRain(this.running && (gst.uiMode === 'playing' || gst.uiMode === 'paused') ? sky.rainLevel : 0)
    this.envTick += dt
    if (this.envTick >= 1) {
      this.envTick = 0
      const info = sky.envInfo()
      const st = useGameStore.getState()
      const prev = st.hud.env
      if (prev.time !== info.time || prev.phase !== info.phase || prev.weather !== info.weather || prev.wIcon !== info.wIcon) {
        st.patchHud({ env: { ...prev, ...info } })
      }
      // perf chip — 1Hz, patched only when a value actually changed (HUD re-render cost matters)
      const es = this.engine.stats
      const prevPerf = st.hud.perf
      const perf = {
        fps: Math.round(this.lastFps),
        frameMs: Math.round(es.frameMs * 10) / 10,
        drawCalls: es.drawCalls,
        trisK: Math.round(es.triangles / 1000),
        kbps: Math.round((this.net.bytesPerSec / 1024) * 10) / 10,
        crowd: this.crowd?.visibleCount ?? 0,
        rigs: this.perfRigs,
        res: Math.round(this.engine.effectivePixelRatio * 100) / 100,
        gl: prevPerf.gl, // preserve the engine hooks' GL health flag across 1Hz patches
        glMsg: prevPerf.glMsg,
      }
      if (perf.fps !== prevPerf.fps || perf.kbps !== prevPerf.kbps || perf.crowd !== prevPerf.crowd ||
        perf.rigs !== prevPerf.rigs || perf.res !== prevPerf.res ||
        perf.drawCalls !== prevPerf.drawCalls || perf.trisK !== prevPerf.trisK ||
        Math.abs(perf.frameMs - prevPerf.frameMs) >= 0.5) {
        st.patchHud({ perf })
      }
      // ---- draw-call collapse watchdog (1Hz): while actively playing, a healthy scene
      // submits hundreds of draw calls. A persistent near-zero count means the world is
      // silently not rendering on this device (exotic driver fault) — the exact "blue
      // world, no buildings or roads" report. Surface it, then auto-recover via reload.
      if (st.uiMode === 'playing' && !this.engine.contextLost) {
        if (es.drawCalls > 0 && es.drawCalls < 8) {
          this.lowDcStreak++
          if (this.lowDcStreak === 1) {
            console.warn('[VoteChor] draw-call collapse detected — attempting recovery')
            st.notify('Rendering problem detected — attempting recovery…', 'warning')
            const w = window as unknown as { __vcDiag?: Array<Record<string, unknown>> }
            ;(w.__vcDiag ??= []).push({ kind: 'drawCallCollapse', t: Date.now(), dc: es.drawCalls, at: { x: focus.x, z: focus.z } })
          }
          if (this.lowDcStreak >= 3) this.guardedReload('draw-call collapse')
        } else {
          this.lowDcStreak = 0
        }
        // a frame-phase exception firing continuously (GL draw faults) → same recovery path
        const err = this.engine.lastError
        if (err && Date.now() - err.at < 1500) {
          this.errStreak++
          if (this.errStreak >= 3) this.guardedReload(`persistent ${err.phase} fault: ${err.message.slice(0, 60)}`)
        } else {
          this.errStreak = 0
        }
        // ---- empty-world watchdog (1Hz): the built city holds thousands of meshes.
        // If the group somehow carries almost nothing while playing (failed build,
        // mass disposal, exotic fault), the screen shows ONLY sky — the exact "blue
        // world, no buildings or roads" report. Recover like every other collapse.
        const worldChildren = this.worldRenderer?.group.children.length ?? 0
        if (worldChildren < 100) {
          this.emptyWorldStreak++
          if (this.emptyWorldStreak === 1) {
            console.warn(`[VoteChor] world group nearly empty (${worldChildren} meshes) — attempting recovery`)
            st.notify('World failed to load — attempting recovery…', 'warning')
            const w = window as unknown as { __vcDiag?: Array<Record<string, unknown>> }
            ;(w.__vcDiag ??= []).push({ kind: 'emptyWorld', t: Date.now(), children: worldChildren, at: { x: focus.x, z: focus.z } })
          }
          if (this.emptyWorldStreak >= 3) this.guardedReload('world group nearly empty')
        } else {
          this.emptyWorldStreak = 0
        }
      } else {
        this.lowDcStreak = 0
        this.errStreak = 0
        this.emptyWorldStreak = 0
      }
    }

    // world animation
    this.worldRenderer.update(dt, this.worldTime, this.offline ? this.localSearchlightAngles : this.serverNpcRys)
    // static-geometry distance cull (internally sweeps at 2Hz) — measured dominant draw-call cost
    this.culler.update(dt, focus.x, focus.z)

    // ---- world-render watchdog: the world group must NEVER stay hidden while playing
    // (a stale toggle / exotic fault would leave only sky+fog on screen — the "blue
    // world" report). Forcing it back is a one-instruction no-op when healthy.
    if (playing && !this.worldRenderer.group.visible) {
      this.worldRenderer.group.visible = true
      const w = window as unknown as { __vcDiag?: Array<Record<string, unknown>> }
      ;(w.__vcDiag ??= []).push({ kind: 'worldGroupForcedVisible', t: Date.now(), at: { x: focus.x, z: focus.z } })
      console.warn('[VoteChor] world group was hidden mid-match — restored')
    }

    // zone ambience + music switching
    const zone = this.world.zones.find(z => focus.z <= z.zStart && focus.z > z.zEnd)
    if (zone) {
      const idx = this.world.zones.indexOf(zone)
      if (this.lastZoneIdx !== idx) {
        this.lastZoneIdx = idx
        store.patchHud({ zoneName: zone.name, zoneHint: zone.hint })
        this.lastTokenPos = { x: focus.x, z: focus.z }
        if (idx === 2) AudioManager.play('whistleFar')
      }
    }
    // adaptive music: chase when chased — also drives the WANTED alert.
    // Round 25 fix: only chase states that target THIS player count. A Season officer
    // chasing a bot across town must not flash WANTED on unrelated screens, and a
    // police-role player is never the quarry at all (officer immunity).
    const meId = this.offline ? 'me' : this.net.playerId
    const chased = this.role !== 'police' && this.npcs.nearestChaserDistance(focus.x, focus.z, meId) < 18
    if (chased !== this.lastHunted) {
      this.lastHunted = chased
      if (!this.player.isDetained) useGameStore.getState().patchHud({ hunted: chased })
    }
    if (this.bossActiveLocal) AudioManager.setTheme('boss')
    else if (chased) AudioManager.setTheme('chase')
    else if (this.running) AudioManager.setTheme('ambient')
    AudioManager.setCrowdLevel(chased ? 0.9 : Math.max(0.3, 1 - Math.abs(focus.z) / 560))
  }
  private lastZoneIdx = -1
  private envTick = 0 // 1s cadence for the HUD environment chip
  private lowDcStreak = 0 // consecutive 1Hz samples with a collapsed draw-call count
  private errStreak = 0 // consecutive 1Hz samples while a frame-phase fault keeps firing
  private emptyWorldStreak = 0 // consecutive 1Hz samples with a near-empty world group

  /** One auto-reload per 30s window — a lost GL context / collapsed draw pipeline
   *  recovers far more reliably through a fresh page than in-place. */
  private guardedReload(reason: string) {
    try {
      const key = 'vc_gl_reload_at'
      const last = Number(sessionStorage.getItem(key) ?? 0)
      if (Date.now() - last < 30_000) return
      sessionStorage.setItem(key, String(Date.now()))
      console.warn(`[VoteChor] Auto-reload (${reason})`)
      location.reload()
    } catch { /* sessionStorage unavailable — reload anyway */ location.reload() }
  }

  /**
   * Crowd impostor feed — one entry per remote protester; full-rig entries are flagged
   * so CrowdLod keeps their slots empty. Interpolated rig positions are not reused here
   * (data-only remotes carry no rig): their fresh network targets are used instead.
   * Detained protesters stand idle — cheap, and never reads as a broken pose.
   */
  private syncCrowd(nowMs: number) {
    if (!this.crowd || !this.player) return
    this.crowd.setFocus(this.player.pos.x, this.player.pos.z)
    const entries: CrowdEntry[] = []
    let rigs = 0
    for (const [id, r] of this.remotePlayers) {
      const hasRig = r.rig != null
      if (hasRig) rigs++
      entries.push({
        id,
        x: r.target.x, y: r.target.y, z: r.target.z, ry: r.target.ry,
        anim: r.detained ? 'idle' : r.anim,
        archetype: r.archetype,
        hasRig,
      })
    }
    this.crowd.sync(entries, nowMs)
    this.perfRigs = rigs
  }

  /** 4s cinematic orbit when the boss activates; freezes input. */
  private updateBossCinematic(dt: number) {
    const started = (this.offline && this.localBoss?.started) || (!this.offline && this.bossClient.visible)
    if (started && !this.bossCinematic.fired) {
      this.bossCinematic = { active: true, t: 0, fired: true }
      this.player?.teleport(this.player.pos.x, this.player.pos.z) // stop momentum
      if (this.player) this.player.state = 'frozen'
      useGameStore.getState().patchHud({ cinematic: true })
      AudioManager.setTheme('boss')
      AudioManager.play('gate')
    }
    if (!this.bossCinematic.active) return
    this.bossCinematic.t += dt
    const t = this.bossCinematic.t
    const DUR = 4.2
    const b = this.world.bossArena
    const bossZ = b.z - 14
    // orbit from the gate side toward the side view, slightly rising
    const ang = Math.PI * 0.5 + Math.sin((t / DUR) * Math.PI * 0.5) * 0.9
    const r = 16 - (t / DUR) * 3
    const cx = Math.sin(ang) * r
    const cz = bossZ + Math.cos(ang) * r
    const cy = 4.5 + (t / DUR) * 2.5
    this.engine.camera.position.set(cx, cy, cz)
    this.engine.camera.lookAt(b.x, 6.5, bossZ)
    if (t >= DUR || useGameStore.getState().uiMode !== 'playing') {
      this.bossCinematic.active = false
      if (this.player && this.player.state === 'frozen') this.player.state = 'normal'
      useGameStore.getState().patchHud({ cinematic: false })
    }
  }

  // ================= HUD / minimap =================
  private syncHud() {
    if (!this.player) return
    const p = this.player
    const zone = this.world.zones.find(z => p.pos.z <= z.zStart && p.pos.z > z.zEnd)
    const store = useGameStore.getState()
    let objective: string
    if (this.role === 'police') {
      objective = this.offline
        ? `Duty: E to cuff, F to baton — detain suspects (${this.stats.arrests} cuffed)`
        : `Duty: detain rowdy protesters — E to cuff, F to baton (${this.stats.arrests} cuffed)`
    } else {
      objective = 'Recover the stolen vote tokens!'
      if (this.tokens >= this.tokensNeeded) objective = 'Enter the Government District — defeat the Vote Collector!'
      else if (this.activatedCheckpoints.size >= 4) objective = `Collect vote tokens (${this.tokens}/${this.tokensNeeded}) to open the boss gate`
    }
    const squad = [...this.remotePlayers.entries()]
      .map(([id, r]) => ({
        id, name: r.name, health: r.health, detained: r.detained, dazed: r.anim === 'dazed', archetype: '', distance: Math.hypot(r.target.x - p.pos.x, r.target.z - p.pos.z),
        bot: id.startsWith('bot_'),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 12) // 12 nearest protesters — seasons hold 100 and the HUD stays readable
    // compass markers (relative to camera yaw so up = where you look)
    const yawDeg = ((this.camRig.yaw * 180) / Math.PI + 360) % 360
    const rel = (x: number, z: number) => {
      let a = Math.atan2(x - p.pos.x, -(z - p.pos.z)) * (180 / Math.PI) - yawDeg
      a = ((a + 540) % 360) - 180
      return { deg: a, dist: Math.round(Math.hypot(x - p.pos.x, z - p.pos.z)) }
    }
    const markers: import('@/lib/game-store').CompassMarker[] = []
    // nearest untaken token within 90m
    let bestTok: { d: number; x: number; z: number } | null = null
    for (const it of this.items.items) {
      if (it.taken || it.def.type !== 'token') continue
      const d = Math.hypot(it.def.x - p.pos.x, it.def.z - p.pos.z)
      if (d < 90 && (!bestTok || d < bestTok.d)) bestTok = { d, x: it.def.x, z: it.def.z }
    }
    if (bestTok) markers.push({ kind: 'token', ...rel(bestTok.x, bestTok.z) })
    // hurt? point to the nearest first-aid kit — or food (chai now heals too)
    if (p.health < 45) {
      let bestFa: { d: number; x: number; z: number } | null = null
      for (const it of this.items.items) {
        if (it.taken || it.def.type !== 'firstaid') continue
        const d = Math.hypot(it.def.x - p.pos.x, it.def.z - p.pos.z)
        if (d < 130 && (!bestFa || d < bestFa.d)) bestFa = { d, x: it.def.x, z: it.def.z }
      }
      if (bestFa) markers.push({ kind: 'firstaid', ...rel(bestFa.x, bestFa.z) })
      else if (!this.inventory.some(i => i.type === 'chai' || i.type === 'joke' || i.type === 'snack' || i.type === 'firstaid')) {
        // no medkit nearby and pockets are empty of food — fall back to chai stalls
        let bestFood: { d: number; x: number; z: number } | null = null
        for (const it of this.items.items) {
          if (it.taken || it.def.type !== 'chai') continue
          const d = Math.hypot(it.def.x - p.pos.x, it.def.z - p.pos.z)
          if (d < 130 && (!bestFood || d < bestFood.d)) bestFood = { d, x: it.def.x, z: it.def.z }
        }
        if (bestFood) markers.push({ kind: 'chai', ...rel(bestFood.x, bestFood.z) })
      }
    }
    // running on fumes? point to the nearest chai stall (unless carrying chai)
    if (p.stamina < 30 && !this.inventory.some(i => i.type === 'chai')) {
      let bestChai: { d: number; x: number; z: number } | null = null
      for (const it of this.items.items) {
        if (it.taken || it.def.type !== 'chai') continue
        const d = Math.hypot(it.def.x - p.pos.x, it.def.z - p.pos.z)
        if (d < 120 && (!bestChai || d < bestChai.d)) bestChai = { d, x: it.def.x, z: it.def.z }
      }
      if (bestChai) markers.push({ kind: 'chai', ...rel(bestChai.x, bestChai.z) })
    }
    // next unactivated checkpoint
    const nextCp = this.world.checkpoints.find(cp => !this.activatedCheckpoints.has(cp.id))
    if (nextCp) markers.push({ kind: 'checkpoint', ...rel(nextCp.x, nextCp.z) })
    // boss arena once gate open
    if (this.gateOpen) markers.push({ kind: 'boss', ...rel(this.world.bossArena.x, this.world.bossArena.z) })
    // squad
    for (const s of squad) {
      const r = [...this.remotePlayers.entries()].find(([id]) => id === s.id)?.[1]
      if (r) markers.push({ kind: 'squad', ...rel(r.target.x, r.target.z) })
    }
    store.patchHud({
      health: Math.round(p.health), maxHealth: p.maxHealth, stamina: Math.round(p.stamina),
      zoneName: zone?.name ?? 'Unknown', zoneHint: zone?.hint ?? '',
      objective, checkpoint: this.activatedCheckpoints.size, totalCheckpoints: this.world.checkpoints.length,
      tokens: this.tokens, tokensNeeded: this.tokensNeeded,
      inventory: this.inventory.map(i => ({ uid: i.uid, type: i.type })), inventoryMax: INVENTORY_MAX,
      detained: p.isDetained, detainRemain: p.isDetained ? Math.max(0, (this.detainUntil - Date.now()) / 1000) : 0,
      dazed: p.isDazed,
      squad, matchTime: this.matchTime, distance: Math.round(p.distance),
      speedBoostUntil: p.speedBoostUntil, carryingBallot: this.carryingBallot,
      score: Math.max(0, this.stats.tokens - this.stats.confiscated) * 45 + this.stats.checkpoints * 60 + this.stats.arrests * PLAYER_ROLE.scorePerArrest,
      role: this.role,
      arrests: this.stats.arrests,
      compass: { yawDeg, markers },
      spectating: p.isDetained ? this.spectateName : null,
      mapX: Math.round(p.pos.x * 2) / 2,
      mapZ: Math.round(p.pos.z * 2) / 2,
    })
  }

  setMinimapCanvas(c: HTMLCanvasElement | null) { this.minimapCanvas = c }
  setHudMinimapCanvas(c: HTMLCanvasElement | null) { this.hudMinimapCanvas = c }

  /** Full-city underlay for the big map — ground, zone tints, roads, cross streets and
   *  building ink, prerendered ONCE (the world is static) and blitted at 8Hz. */
  private mapUnderlay: HTMLCanvasElement | null = null

  private buildMapUnderlay(W: number, H: number): HTMLCanvasElement {
    const cv = document.createElement('canvas')
    cv.width = W; cv.height = H
    const c = cv.getContext('2d')
    if (!c) return cv
    const b = this.world.bounds
    const toX = (x: number) => ((x - b.minX) / (b.maxX - b.minX)) * W
    const toY = (z: number) => ((10 - z) / 582) * H
    // out-of-world ink + ground
    c.fillStyle = '#171512'
    c.fillRect(0, 0, W, H)
    c.fillStyle = '#2a2318'
    c.fillRect(toX(b.minX), 0, toX(b.maxX) - toX(b.minX), H)
    // zone tints
    const zoneColors = ['rgba(201,111,74,0.32)', 'rgba(184,92,62,0.32)', 'rgba(127,154,140,0.32)', 'rgba(201,168,106,0.32)', 'rgba(154,123,95,0.38)']
    this.world.zones.forEach((z, i) => {
      c.fillStyle = zoneColors[i % zoneColors.length]
      c.fillRect(toX(b.minX), toY(z.zStart), toX(b.maxX) - toX(b.minX), toY(z.zEnd) - toY(z.zStart))
    })
    // roads: main spine + avenue widening + east-west cross streets
    c.fillStyle = 'rgba(70,66,58,0.75)'
    c.fillRect(toX(-8), 0, toX(8) - toX(-8), H)
    c.fillRect(toX(-16), toY(-280), toX(16) - toX(-16), toY(-420) - toY(-280))
    for (const cr of this.world.crossRoads) {
      c.fillRect(toX(-114), toY(cr.z + cr.halfW), toX(114) - toX(-114), toY(cr.z - cr.halfW) - toY(cr.z + cr.halfW))
    }
    // building footprints — soft ink blocks (skip thin props by footprint area)
    c.fillStyle = 'rgba(16,13,10,0.85)'
    c.strokeStyle = 'rgba(245,239,220,0.05)'
    c.lineWidth = 1
    for (const col of this.world.colliders) {
      const h = col.maxY - col.minY
      if (h <= 2) continue
      const w = col.maxX - col.minX
      const d = col.maxZ - col.minZ
      if (w * d < 8 || w < 1.2 || d < 1.2) continue
      const x = toX(col.minX), y = toY(col.maxZ)
      c.fillRect(x, y, Math.max(1, w / 240 * W), Math.max(1, d / 582 * H))
      c.strokeRect(x + 0.5, y + 0.5, Math.max(1, w / 240 * W) - 1, Math.max(1, d / 582 * H) - 1)
    }
    // boss arena ring
    c.strokeStyle = 'rgba(140,31,40,0.7)'
    c.lineWidth = 2
    c.setLineDash([5, 4])
    c.beginPath()
    c.arc(toX(this.world.bossArena.x), toY(this.world.bossArena.z), (this.world.bossArena.radius / 240) * W, 0, 7)
    c.stroke()
    c.setLineDash([])
    return cv
  }

  private drawMinimap() {
    const canvas = this.minimapCanvas
    if (!canvas || !this.player) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    // world: z from 10 to -572, x -120..120 → full-city strip (bounds-driven)
    const b = this.world.bounds
    const toX = (x: number) => ((x - b.minX) / (b.maxX - b.minX)) * W
    const toY = (z: number) => ((10 - z) / 582) * H
    // static underlay (rebuilt only if the buffer size changes)
    if (!this.mapUnderlay || this.mapUnderlay.width !== W || this.mapUnderlay.height !== H) {
      this.mapUnderlay = this.buildMapUnderlay(W, H)
    }
    ctx.drawImage(this.mapUnderlay, 0, 0)
    // checkpoints
    for (const cp of this.world.checkpoints) {
      ctx.fillStyle = this.activatedCheckpoints.has(cp.id) ? '#4e9b6e' : '#c9482e'
      ctx.beginPath(); ctx.arc(toX(cp.x), toY(cp.z), 3.4, 0, 7); ctx.fill()
    }
    // boss
    ctx.fillStyle = this.gateOpen ? '#8c1f28' : 'rgba(140,31,40,0.4)'
    ctx.beginPath(); ctx.arc(toX(this.world.bossArena.x), toY(this.world.bossArena.z), 5, 0, 7); ctx.fill()
    // tokens
    for (const t of this.items.tokenData()) {
      if (t.taken) continue
      ctx.fillStyle = '#f2c14e'
      ctx.fillRect(toX(t.x) - 1.5, toY(t.z) - 1.5, 3, 3)
    }
    // npcs (journalist sees far, others 40m)
    const seeDist = this.archetype === 'journalist' ? 70 : 42
    for (const n of this.npcs.minimapData()) {
      if (Math.hypot(n.x - this.player.pos.x, n.z - this.player.pos.z) > seeDist) continue
      ctx.fillStyle = n.chasing ? '#ff3b30' : '#3a6ea5'
      ctx.beginPath(); ctx.arc(toX(n.x), toY(n.z), 2.2, 0, 7); ctx.fill()
    }
    // squad
    for (const [, r] of this.remotePlayers) {
      ctx.fillStyle = '#4ecdc4'
      ctx.beginPath(); ctx.arc(toX(r.target.x), toY(r.target.z), 2.6, 0, 7); ctx.fill()
    }
    // player arrow
    const px = toX(this.player.pos.x), py = toY(this.player.pos.z)
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(-this.player.ry + Math.PI)
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#1c1a17'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(0, -5); ctx.lineTo(3.6, 4); ctx.lineTo(0, 2); ctx.lineTo(-3.6, 4)
    ctx.closePath(); ctx.fill(); ctx.stroke()
    ctx.restore()
  }

  /**
   * Corner minimap — GTA-style circular radar (rotation, routes, waypoint pin).
   * Rendering + caching live in minimap.ts (drawCircularMinimap + A* computeRoute);
   * this is a thin data adapter that feeds the same sources the old strip renderer
   * used (zones/colliders from world-def, checkpoints, boss arena, tokens, chasing
   * patrols, squadmates + nearby protesters). The full-city buffer above stays the
   * big map's data source. Kept on the 60Hz renderUpdate cadence — the static world
   * layer is prerendered in minimap.ts, so a frame is one blit + a few dozen dots.
   */
  private drawHudMinimap() {
    const canvas = this.hudMinimapCanvas
    if (!canvas || !this.player) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const st = this.store
    const hud = st.hud
    const p = this.player
    // auto-route objective: boss gate once the votes are in, else the next checkpoint
    const nextCp = this.world.checkpoints.find(cp => !this.activatedCheckpoints.has(cp.id))
    const objective = (this.gateOpen || this.tokens >= this.tokensNeeded)
      ? { x: this.world.bossArena.x, z: this.world.bossArena.z, label: 'BOSS' }
      : nextCp
        ? { x: nextCp.x, z: nextCp.z, label: 'CHECKPOINT' }
        : null
    // detained → route to the release point. Release coords are not stored in the
    // hud store, but the client computes the exact same deterministic detention
    // point the offline countdown releases at (world-def checkpoint.detention);
    // the server releases at the same shared-world coords.
    let releaseTarget: { x: number; z: number } | null = null
    if (p.isDetained) {
      const cp = this.activatedCheckpoints.size > 0
        ? this.world.checkpoints[Math.min(this.activatedCheckpoints.size, this.world.checkpoints.length) - 1]
        : this.world.checkpoints[0]
      if (cp) releaseTarget = { x: cp.detention.x, z: cp.detention.z }
    }
    // squadmates bright, nearby protesters/bots dim (capped — seasons hold 100)
    const squadIds = this.squad.memberIds
    const remotes: MinimapRemote[] = []
    for (const [id, r] of this.remotePlayers) {
      const dx = r.target.x - p.pos.x
      const dz = r.target.z - p.pos.z
      if (dx * dx + dz * dz > 70 * 70) continue
      remotes.push({ x: r.target.x, z: r.target.z, squad: squadIds.has(id) })
      if (remotes.length >= 48) break
    }
    drawCircularMinimap(ctx, {
      px: p.pos.x,
      pz: p.pos.z,
      ry: p.ry,
      zoomM: st.settings.minimapZoom,
      rotate: st.settings.minimapRotate,
      waypoint: hud.waypoint,
      objective,
      detained: hud.detained,
      releaseTarget,
      checkpoints: this.world.checkpoints,
      activatedIds: this.activatedCheckpoints,
      boss: this.world.bossArena,
      gateOpen: this.gateOpen,
      tokens: this.items.tokenData(),
      npcs: this.npcs.minimapData(),
      remotes,
      seeDist: this.archetype === 'journalist' ? 70 : 42,
      colliders: this.world.colliders,
      zones: this.world.zones,
    })
  }

  // ================= match end =================
  private doVictory() {
    if (this.matchEnded) return
    this.matchEnded = true
    AudioManager.setTheme('victory')
    AudioManager.play('victory')
    this.player?.playAnim('celebrate', 5)
    this.store.notify('DEMOCRACY RESTORED! The committee has been dissolved!', 'boss')
    if (!this.offline) {
      // server will emit game:matchend; also request immediate end
    }
    setTimeout(() => this.finalizeMatch(true), this.offline ? 2500 : 4000)
  }

  private doTimeUp() {
    if (this.matchEnded) return
    this.matchEnded = true
    AudioManager.setTheme('victory')
    AudioManager.play('defeat')
    this.store.notify("Time's up! The committee has scheduled another meeting.", 'warning')
    this.finalizeMatch(false)
  }

  private handleMatchEnd(payload: import('./shared/types').MatchEndPayload) {
    if (this.endHandled) return
    this.endHandled = true
    this.matchEnded = true
    this.finalizeMatch(payload.victory, payload)
  }

  private async finalizeMatch(victory: boolean, serverPayload?: import('./shared/types').MatchEndPayload) {
    const p = this.player
    if (!p) return
    const store = useGameStore.getState()
    this.exitPhotoMode(false)
    this.input.setEnabled(false)
    this.running = false
    const detentions = this.stats.detentions
    const stats = {
      victory, position: serverPayload?.position ?? 1,
      // online: the server's end-of-match global count already reflects confiscations;
      // offline: subtract the votes police seized from the personal tally
      tokens: serverPayload?.tokens ?? Math.max(0, this.stats.tokens - this.stats.confiscated),
      distance: serverPayload?.distance ?? Math.round(p.distance),
      checkpoints: serverPayload?.checkpoints ?? this.stats.checkpoints,
      rescues: serverPayload?.rescues ?? this.stats.rescues,
      revives: serverPayload?.revives ?? this.stats.revives,
      itemsCollected: serverPayload?.itemsCollected ?? this.stats.itemsCollected,
      bossContribution: serverPayload?.bossContribution ?? this.stats.bossHits,
      detentions,
      arrests: this.stats.arrests,
      confiscated: this.stats.confiscated,
      confiscatedItems: this.stats.confiscatedItems,
      gifts: this.stats.gifts,
    }
    // XP calculation (client display) — v43: solo district stakes multiply the
    // estimate; the server recomputes authoritatively with the same mapForLevel rule
    const xpMul = this.mode === 'solo' ? (this.world.xpMul ?? 1) : 1
    const xp = Math.round(
      (XP_TABLE.participation + stats.distance * XP_TABLE.perMeter +
      stats.checkpoints * XP_TABLE.perCheckpoint + stats.tokens * XP_TABLE.perToken +
      stats.rescues * XP_TABLE.perRescue + stats.revives * XP_TABLE.perRevive +
      stats.itemsCollected * XP_TABLE.perItem + stats.gifts * XP_TABLE.perGift +
      stats.bossContribution * XP_TABLE.bossHit + stats.arrests * XP_TABLE.perArrest +
      (victory ? XP_TABLE.victoryBonus : 0)) * xpMul,
    )
    const { VICTORY_TITLES } = await import('./shared/constants')
    const title = VICTORY_TITLES({ detentions, rescues: stats.rescues, revives: stats.revives, items: stats.itemsCollected, distance: stats.distance, victory, gifts: stats.gifts })
    // persist
    let newAchievements: { id: string; name: string }[] = []
    let leveledUp = false
    let newLevel = store.profile?.level ?? 1
    let xpEarned = xp
    // v43 EndScreen unlock teaser — the district tier before this match
    const prevLevel = store.profile?.level ?? 1
    let dailyBonus = 0
    let dailyDesc: string | undefined
    let dailyJustCompleted = false
    let weeklyBonus = 0
    let weeklyJustCompleted = false
    let streak: number | undefined
    let streakUp = false
    let solidarityBonus = 0
    let squadSize = 1
    const profileRaw = typeof window !== 'undefined' ? localStorage.getItem('votechor_profile') : null
    const token = profileRaw ? (JSON.parse(profileRaw) as { token: string }).token : null
    if (token) {
      try {
        const res = await fetch('/api/matches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-vc-token': token },
          body: JSON.stringify({
            matchId: serverPayload?.matchId ?? `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            victory, distance: stats.distance, checkpoints: stats.checkpoints,
            rescues: stats.rescues, revives: stats.revives, itemsCollected: stats.itemsCollected,
            bossContribution: stats.bossContribution, detentions, tokens: stats.tokens,
            arrests: stats.arrests,
            gifts: stats.gifts,
            position: stats.position, multiplayer: !this.offline,
            // v44 — which district this match actually played; the server validates
            // it against the profile level before honoring the XP stakes
            mapId: this.mode === 'solo' ? this.worldId : undefined,
            squadSize: this.offline ? 1 : Math.min(4, Math.max(1, this.squad.memberIds.size || 1)),
          }),
        })
        if (res.ok) {
          const data = await res.json() as {
            xpEarned: number; level: number; leveledUp: boolean
            newAchievements: { id: string; name: string }[]
            profile: { xp: number; level: number }
            dailyBonus?: number
            daily?: { kind: string; desc: string; target: number; reward: number; progress: number; claimed: boolean; justCompleted: boolean } | null
            weeklyBonus?: number
            weekly?: { kind: string; desc: string; target: number; reward: number; progress: number; claimed: boolean; justCompleted: boolean } | null
            streak?: number
            streakUp?: boolean
            solidarityBonus?: number
            squadSize?: number
          }
          xpEarned = data.xpEarned
          newAchievements = data.newAchievements ?? []
          leveledUp = data.leveledUp
          newLevel = data.level
          streak = data.streak
          streakUp = !!data.streakUp
          solidarityBonus = data.solidarityBonus ?? 0
          squadSize = data.squadSize ?? 1
          if (data.daily) {
            dailyBonus = data.dailyBonus ?? 0
            dailyDesc = data.daily.desc
            dailyJustCompleted = !!data.daily.justCompleted
            useGameStore.getState().setDaily({ kind: data.daily.kind, desc: data.daily.desc, target: data.daily.target, reward: data.daily.reward, progress: data.daily.progress, claimed: data.daily.claimed })
          }
          if (data.weekly) {
            weeklyBonus = data.weeklyBonus ?? 0
            weeklyJustCompleted = !!data.weekly.justCompleted
            useGameStore.getState().setWeekly({ kind: data.weekly.kind, desc: data.weekly.desc, target: data.weekly.target, reward: data.weekly.reward, progress: data.weekly.progress, claimed: data.weekly.claimed })
          }
          if (data.profile && store.profile) {
            const updated = { ...store.profile, xp: data.profile.xp, level: data.profile.level, ...(streak !== undefined ? { dailyStreak: streak } : {}) }
            store.setProfile(updated)
            // keep localStorage in sync so the menu shows fresh progress after reload
            try {
              const raw = localStorage.getItem('votechor_profile')
              if (raw) {
                const parsed = JSON.parse(raw) as { token: string; profile: unknown }
                localStorage.setItem('votechor_profile', JSON.stringify({ token: parsed.token, profile: updated }))
              }
            } catch { /* non-fatal */ }
          }
          for (const a of newAchievements) store.notify(`Achievement: ${a.name}!`, 'achievement')
          if (dailyJustCompleted) store.notify(`DAILY CHALLENGE COMPLETE! +${dailyBonus} bonus XP!`, 'achievement')
          if (weeklyJustCompleted) store.notify(`WEEKLY CHALLENGE COMPLETE! +${weeklyBonus} bonus XP!`, 'achievement')
          if (streakUp && streak && streak > 1) store.notify(`🔥 ${streak}-DAY STREAK — don't break the chain!`, 'achievement')
          if (solidarityBonus > 0) store.notify(`SOLIDARITY BONUS! +${solidarityBonus} XP for marching with ${squadSize - 1} cellmate${squadSize === 2 ? '' : 's'}`, 'squad')
          if (leveledUp) { store.notify(`LEVEL UP — Level ${newLevel}!`, 'achievement'); AudioManager.play('victory') }
        }
      } catch { /* offline persistence failure is fine */ }
    }
    // v43 EndScreen unlock teaser — solo district earned by the level jump
    const unlockedMap = (() => {
      if (this.mode !== 'solo') return undefined
      const before = mapForLevel(prevLevel)
      const after = mapForLevel(newLevel)
      return after.id !== before.id ? { name: after.name, tagline: after.tagline, minLevel: after.minLevel } : undefined
    })()
    const summary: MatchSummary = { ...stats, xpEarned, funnyTitle: title, newAchievements, leveledUp, newLevel, matchId: serverPayload?.matchId ?? 'offline', duration: serverPayload?.duration ?? Math.round(this.matchTime), playersOnline: serverPayload?.playersOnline ?? 1, dailyBonus, dailyDesc, dailyJustCompleted, weeklyBonus, weeklyJustCompleted, streak, streakUp, solidarityBonus, squadSize, xpMul, unlockedMap }
    store.setMatchSummary(summary)
    store.setUIMode('ended')
    AudioManager.setTheme('none') // v48: end screen is quiet too — the victory/defeat stinger already played
    AudioManager.stopCrowd()
    AudioManager.stopRain() // v49: kill any lingering weather bed
  }

  // ================= photo mode =================
  private static PHOTO_FILTERS = [
    '', // protest natural
    'saturate(1.4) contrast(1.14)', // poster punch
    'sepia(0.5) contrast(1.06) saturate(1.25)', // vintage press photo
    'grayscale(1) contrast(1.28)', // noir committee
  ]

  private ensurePhotoKeyHandler() {
    if (this.photoKeyHandler) return
    this.photoKeyHandler = (e: KeyboardEvent) => {
      const store = useGameStore.getState()
      if (e.code === 'KeyP') {
        if (store.uiMode === 'playing') { e.preventDefault(); this.togglePhotoMode() }
        return
      }
      if (this.photoMode && store.uiMode === 'playing') {
        if (e.code === 'KeyO') { e.preventDefault(); this.cyclePhotoFilter() }
        else if (e.code === 'KeyK') { e.preventDefault(); this.takeSnapshot() }
      }
    }
    window.addEventListener('keydown', this.photoKeyHandler)
    // wheel zoom while in photo mode
    this.photoWheelHandler = (e: WheelEvent) => {
      if (!this.photoMode || useGameStore.getState().uiMode !== 'playing') return
      e.preventDefault()
      this.photoZoom(e.deltaY > 0 ? -1 : 1)
    }
    window.addEventListener('wheel', this.photoWheelHandler, { passive: false })
  }

  private removePhotoKeyHandler() {
    if (this.photoKeyHandler) window.removeEventListener('keydown', this.photoKeyHandler)
    this.photoKeyHandler = null
    if (this.photoWheelHandler) window.removeEventListener('wheel', this.photoWheelHandler)
    this.photoWheelHandler = null
  }

  togglePhotoMode() {
    const store = useGameStore.getState()
    if (this.photoMode) { this.exitPhotoMode(true); return }
    if (!this.player || this.matchEnded || this.player.isDetained || store.uiMode !== 'playing') return
    this.photoMode = true
    store.setPhotoMode(true)
    store.setPhotoFilter(0)
    this.applyPhotoFilter(0)
    if (this.player.state === 'normal') this.player.state = 'frozen'
    this.camRig.targetDistance = 7.2
    AudioManager.play('uiClick')
    store.notify('PHOTO MODE — mouse orbits · wheel/buttons zoom · O filter · K snapshot · P exit', 'info')
  }

  /** Zoom the photo-mode camera (buttons or wheel). */
  photoZoom(dir: number) {
    if (!this.photoMode) return
    this.camRig.targetDistance = Math.max(2.2, Math.min(11, this.camRig.targetDistance - dir * 1.2))
  }

  private exitPhotoMode(restorePlayer: boolean) {
    if (!this.photoMode) return
    this.photoMode = false
    const store = useGameStore.getState()
    store.setPhotoMode(false)
    this.applyPhotoFilter(0)
    if (this.canvasEl) this.canvasEl.style.filter = ''
    this.camRig.targetDistance = 5.4
    if (restorePlayer && this.player && this.player.state === 'frozen') this.player.state = 'normal'
  }

  private applyPhotoFilter(idx: number) {
    if (!this.canvasEl) return
    this.canvasEl.style.filter = Game.PHOTO_FILTERS[idx % Game.PHOTO_FILTERS.length]
  }

  private cyclePhotoFilter() {
    if (!this.photoMode) return
    const next = (useGameStore.getState().photoFilter + 1) % Game.PHOTO_FILTERS.length
    useGameStore.getState().setPhotoFilter(next)
    this.applyPhotoFilter(next)
    const names = ['Natural', 'Poster Punch', 'Vintage Press', 'Committee Noir']
    useGameStore.getState().notify(`Filter: ${names[next]}`, 'info')
    AudioManager.play('uiClick')
  }

  private takeSnapshot() {
    if (!this.photoMode || !this.engine) return
    try {
      // preserveDrawingBuffer is ON again (v25 parity) — the explicit re-render is now
      // belt-and-braces so the snapshot always shows the freshest composed frame
      this.engine.renderer.render(this.engine.scene, this.engine.camera)
      const url = this.engine.renderer.domElement.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = `votechor_photo_${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.png`
      a.click()
      useGameStore.getState().notify('📸 Snapshot saved — courtesy of the Protest Press Club!', 'achievement')
      AudioManager.play('token')
    } catch {
      useGameStore.getState().notify('Snapshot confiscated by the committee. Try again.', 'warning')
    }
  }

  dispose() {
    this.removePhotoKeyHandler()
    this.unsubStore?.()
    this.net.leave()
    this.crowd?.dispose()
    this.crowd = null
    if (this.animals) { this.animals.dispose(); this.engine?.scene.remove(this.animals.group) }
    this.input?.dispose()
    this.engine?.dispose()
    if (this.dmgFlashTimer) clearTimeout(this.dmgFlashTimer)
    this.dmgFlashTimer = null
    this.dmgFlashEl?.remove()
    this.dmgFlashEl = null
  }
}

function randomOf<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

// Touch bridge for mobile UI controls
export function touchBridge() {
  const g = getGame()
  return {
    look: (dx: number, dy: number) => {
      const input = g['input'] as InputManager | undefined
      if (!input) return
      input.addLook(dx, dy)
    },
    move: (x: number, y: number) => {
      const input = g['input'] as InputManager | undefined
      if (!input) return
      input.touchMove = { x, y }
      input.touchActive = true
      input.sync()
    },
    end: () => {
      const input = g['input'] as InputManager | undefined
      if (!input) return
      input.touchActive = false
      input.touchMove = { x: 0, y: 0 }
      input.sync()
    },
    btn: (name: 'sprint' | 'jump' | 'slide' | 'interact' | 'throw' | 'shout' | 'heal' | 'strike', down: boolean) => {
      const input = g['input'] as InputManager | undefined
      if (!input) return
      input.touchButtons[name] = down
      input.sync()
      if (down && name === 'jump') input.onOneShot?.('jump')
      if (down && name === 'throw') input.onOneShot?.('throw')
      if (down && name === 'slide') input.onOneShot?.('slide')
      if (down && name === 'shout') input.onOneShot?.('shout')
      if (down && name === 'heal') input.onOneShot?.('heal')
      if (down && name === 'strike') input.onOneShot?.('strike')
    },
    // v46 — one-shot system actions for the touch utility row. Routing through the
    // SAME handleOneShot path as the keyboard means pause keeps its map/chat-close
    // contract + debounce, and squad keeps the Options→Interface off-latch.
    oneShot: (name: 'pause' | 'squad' | 'emote') => {
      const input = g['input'] as InputManager | undefined
      input?.onOneShot?.(name)
    },
    setMinimap: (c: HTMLCanvasElement | null) => g.setMinimapCanvas(c),
  }
}

// singleton
let gameInstance: Game | null = null
export function getGame(): Game { if (!gameInstance) gameInstance = new Game(); return gameInstance }
