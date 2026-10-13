// VoteChor game orchestrator — owns the engine, entities, net, and match flow.
'use client'
import * as THREE from 'three'
import { Engine } from './engine'
import { PhysicsWorld } from './physics'
import { WorldRenderer } from './world'
import { InputManager } from './input'
import { ThirdPersonCamera } from './camera'
import { PlayerController } from './player'
import { CharacterRig } from './character'
import { NpcSystem, VehicleSystem } from './npcs'
import { ItemSystem } from './items'
import { BossClient } from './boss'
import { NetClient, type JoinAck } from './net'
import { AudioManager } from './audio'
import { FxSystem } from './fx'
import { SpeechBubbleSystem } from './bubbles'
import { buildWorldDef } from './shared/world-def'
import { createNpcStates, tickNpc, type NpcBrainState, type NpcPlayerView } from './shared/npc-brain'
import { createBossBrain, tickBoss, grabBallot, depositBallot, registerBossHit, type BossBrain } from './shared/boss-brain'
import {
  MOVE, TOKENS_NEEDED, DETENTION_SECONDS, MATCH_TIME_LIMIT, ITEM_CONFIG, INVENTORY_MAX,
  archetypeById, XP_TABLE, levelFromXp, CAPTURE_MESSAGES, RANDOM_NOTIFICATIONS, BOSS_NAME,
  BOSS_PHASE_NAMES,
} from './shared/constants'
import type { AnimName, BossNetState, ItemType } from './shared/types'
import { useGameStore, registerUIActions, type MatchSummary } from '@/lib/game-store'
import { emoteIsUnlocked, unlockedEmoteIds, EMOTE_CATALOG } from '@/lib/cosmetics'

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

interface MatchStats {
  tokens: number
  checkpoints: number
  rescues: number
  revives: number
  itemsCollected: number
  detentions: number
  bossHits: number
  distractions: number
}

export class Game {
  private engine!: Engine
  private physics = new PhysicsWorld()
  private worldRenderer!: WorldRenderer
  private input!: InputManager
  private camRig!: ThirdPersonCamera
  private player: PlayerController | null = null
  private npcs!: NpcSystem
  private vehicles!: VehicleSystem
  private items!: ItemSystem
  private bossClient = new BossClient()
  private fx = new FxSystem()
  private playerBubbles = new SpeechBubbleSystem()
  private lastHunted = false
  private photoWheelHandler: ((e: WheelEvent) => void) | null = null
  private net = new NetClient()
  private world = buildWorldDef()

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
  private stats: MatchStats = { tokens: 0, checkpoints: 0, rescues: 0, revives: 0, itemsCollected: 0, detentions: 0, bossHits: 0, distractions: 0 }
  private detainUntil = 0
  private carryingBallot = false
  private carryingBallotId: string | null = null
  private remotePlayers = new Map<string, { rig: import('./character').CharacterRig; target: { x: number; y: number; z: number; ry: number }; anim: AnimName; name: string; health: number; detained: boolean }>()
  private serverNpcRys: Record<string, number> = {}
  private lastTokenPos = { x: 0, z: 0 }
  private humorTimer = 30
  private minimapCanvas: HTMLCanvasElement | null = null
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
  private rallyReadyAt = 0
  private static RALLY_COOLDOWN_MS = 45000

  async boot(canvas: HTMLCanvasElement, minimap: HTMLCanvasElement) {
    this.minimapCanvas = minimap
    this.canvasEl = canvas
    this.engine = new Engine(canvas)
    this.physics.setColliders(this.world.colliders)
    this.worldRenderer = new WorldRenderer(this.world, 'high')
    this.engine.scene.add(this.worldRenderer.group)
    this.engine.scene.add(this.bossClient.group)
    this.engine.scene.add(this.fx.group)
    this.engine.scene.add(this.playerBubbles.group)

    this.input = new InputManager(canvas)
    this.input.onOneShot = (a) => this.handleOneShot(a)
    this.camRig = new ThirdPersonCamera(this.engine.camera, this.physics)

    this.npcs = new NpcSystem(this.world, this.physics, 'high')
    this.engine.scene.add(this.npcs.group)
    this.vehicles = new VehicleSystem(this.world)
    this.engine.scene.add(this.vehicles.group)
    this.vehicles.onPlayerHit = (kind, x, z, dmg) => this.handleVehicleHit(kind, x, z, dmg)

    this.items = new ItemSystem(this.world.items, this.physics)
    this.engine.scene.add(this.items.group)

    this.localNpcBrains = createNpcStates(this.world.npcs.map(n => ({ id: n.id, type: n.type, x: n.x, z: n.z, patrol: n.patrol.map(p => ({ ...p })) })))
    for (const sl of this.world.searchlights) this.localSearchlightAngles[sl.id] = sl.ry

    // net events
    this.net.ev = {
      onJoinAck: (ack) => this.onJoinAck(ack),
      onPlayers: (players) => this.onServerPlayers(players),
      onNpcs: (npcs) => { this.npcs.applyServerState(npcs); for (const n of npcs) this.serverNpcRys[n.id] = n.ry },
      onItems: (items) => this.items.applyServerState(items, this.worldTime),
      onBoss: (boss, ballots) => this.onServerBoss(boss, ballots),
      onCapture: (playerId, until, message) => this.onCapture(playerId, until, message),
      onRelease: (playerId, x, z) => this.onRelease(playerId, x, z),
      onCheckpoint: (cp, byName, total) => this.onCheckpoint(cp, byName, total),
      onProjectile: (p) => this.items.spawnRemoteProjectile(p.id, p.type, p.x, p.y, p.z, p.vx, p.vy, p.vz),
      onEmote: (playerId, emote) => this.playRemoteEmote(playerId, emote),
      onQuickMsg: (playerId, msgId) => this.onRemoteQuickMsg(playerId, msgId),
      onPlayerLeft: (playerId, name) => { this.removeRemote(playerId); this.store.notify(`${name} left the protest`, 'info') },
      onPlayerJoined: (_playerId, name) => this.store.notify(`${name} joined the protest!`, 'squad'),
      onHealth: (playerId, health, dazed) => this.onRemoteHealth(playerId, health, dazed),
      onDamage: (playerId, amount, kind) => { if (playerId === this.net.playerId) this.applyDamage(amount, kind) },
      onMatchEnd: (payload) => this.handleMatchEnd(payload),
      onTokens: (count) => { this.tokens = count; this.checkGate() },
      onGate: (open) => this.setGate(open),
      onSquad: (s) => this.onSquadUpdate(s),
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

    // store subscription for settings
    this.unsubStore = useGameStore.subscribe((s) => {
      this.store = s
      AudioManager.setVolumes({ master: s.settings.masterVolume, music: s.settings.musicVolume, sfx: s.settings.sfxVolume })
      this.input.keybinds = s.settings.keybinds
      this.input.sensitivity = s.settings.mouseSensitivity
      this.input.invertY = s.settings.invertY
    })

    this.engine.onFixedUpdate = (dt) => this.fixedUpdate(dt)
    this.engine.onRender = (dt) => this.renderUpdate(dt)
    this.engine.onFps = (fps) => useGameStore.getState().setFps(fps)
    this.engine.setQuality(this.store.settings.quality)
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
      rallyToCell: () => this.rallyToCell(),
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
    AudioManager.startCrowd()
    AudioManager.setTheme('menu')
    useGameStore.getState().setUIMode('menu')
    // debug handle for QA tooling
    ;(window as unknown as { __vc: unknown }).__vc = this
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
    this.tokens = 0
    this.gateOpen = false
    this.activatedCheckpoints.clear()
    this.inventory = []
    this.stats = { tokens: 0, checkpoints: 0, rescues: 0, revives: 0, itemsCollected: 0, detentions: 0, bossHits: 0, distractions: 0 }
    this.carryingBallot = false
    this.carryingBallotId = null
    this.matchTime = 0
    this.humorTimer = 24
    this.squad = { code: null, memberIds: new Set() }
    this.lastSquadCode = null
    this.squadAutoRejoin = false
    this.rallyReadyAt = 0
    useGameStore.getState().setSquad(null)

    const profile = store.profile
    this.archetype = profile?.archetype ?? 'student'
    const name = profile?.name ?? 'Protester'
    this.refreshUnlockedEmotes()

    // reset world states
    this.worldRenderer.setBossGateOpen(false)
    this.bossClient.hideAll()
    this.fx.clear()
    this.playerBubbles.clear()
    for (const it of this.items.items) { it.taken = false; it.group.visible = true; it.respawnAt = 0 }
    for (const [id] of this.remotePlayers) this.removeRemote(id)
    this.localBoss = createBossBrain(this.world.bossArena)
    this.bossActiveLocal = false

    // fresh player
    if (this.player) { this.engine.scene.remove(this.player.rig.group) }
    const cosmetics = profile?.cosmetics
    this.player = new PlayerController(this.archetype, name, this.world.spawn, this.physics, {
      hat: cosmetics?.hat as string | undefined,
      glasses: cosmetics?.glasses,
      signText: cosmetics?.signText,
      cosmetics,
    })
    this.player.onFootstep = (running) => AudioManager.play(running ? 'footstepRun' : 'footstep')
    this.player.onLand = (hard) => AudioManager.play(hard ? 'land' : 'footstep')
    this.player.onJump = () => AudioManager.play('jump')
    this.player.onSlide = () => AudioManager.play('slide')
    this.player.onDazed = () => { AudioManager.play('hit'); this.store.notify(randomOf(RANDOM_NOTIFICATIONS), 'warning') }
    this.engine.scene.add(this.player.rig.group)
    this.camRig.yaw = 0 // camera behind player, looking down the road (-z)

    // reset local npc brains
    this.localNpcBrains = createNpcStates(this.world.npcs.map(n => ({ id: n.id, type: n.type, x: n.x, z: n.z, patrol: n.patrol.map(p => ({ ...p })) })))

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

    AudioManager.setTheme('ambient')
    AudioManager.setCrowdLevel(0.7)
    store.setUIMode('playing')
    this.input.setEnabled(true)
    this.running = true
    store.notify('The votes are missing. The protest is on. Everybody run!', 'info')
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
        [23500, 'Tip: 12 tokens unlock the boss gate in the Government District. Good luck!', 'boss'],
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

  leaveMatch() {
    if (this.matchEnded) return
    this.exitPhotoMode(false)
    this.net.leave()
    this.running = false
    this.input.setEnabled(false)
    this.clearOnboarding()
    this.npcs.bubbles.clear()
    this.playerBubbles.clear()
    this.lastHunted = false
    this.squad = { code: null, memberIds: new Set() }
    this.lastSquadCode = null
    this.squadAutoRejoin = false
    this.rallyReadyAt = 0
    useGameStore.getState().patchHud({ hunted: false, rallyReadyAt: 0 })
    useGameStore.getState().setSquad(null)
    AudioManager.setTheme('menu')
    AudioManager.setCrowdLevel(0.25)
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
    this.tokens = ack.tokensCollected
    this.tokensNeeded = ack.tokensNeeded
    for (const p of ack.players) {
      if (p.id !== ack.playerId) this.addRemote(p)
    }
    // sync world state
    if (ack.checkpoints) ack.checkpoints.forEach(cp => this.activatedCheckpoints.add(cp))
    if (ack.boss && ack.boss.active) this.bossActiveLocal = true
    useGameStore.getState().notify(`Joined room ${ack.roomCode}`, 'squad')
  }

  private onServerPlayers(players: import('./shared/types').PlayerNetState[]) {
    if (!this.player) return
    const seen = new Set<string>()
    let online = 0
    for (const p of players) {
      online++
      seen.add(p.id)
      if (p.id === this.net.playerId) continue
      let r = this.remotePlayers.get(p.id)
      if (!r) { r = this.addRemote(p) }
      r.target = { x: p.x, y: p.y, z: p.z, ry: p.ry }
      r.anim = p.anim
      r.health = p.health
      r.detained = p.detained
      r.rig.group.visible = true
    }
    for (const [id, r] of this.remotePlayers) {
      if (!seen.has(id)) { this.removeRemote(id) }
    }
    useGameStore.getState().patchHud({ playersOnline: online })
  }

  private addRemote(p: import('./shared/types').PlayerNetState) {
    const rig = new CharacterRig({ archetype: p.archetype, name: p.name })
    rig.group.position.set(p.x, p.y, p.z)
    this.engine.scene.add(rig.group)
    const r = { rig, target: { x: p.x, y: p.y, z: p.z, ry: p.ry }, anim: p.anim as AnimName, name: p.name, health: p.health, detained: p.detained }
    this.remotePlayers.set(p.id, r)
    return r
  }

  private removeRemote(id: string) {
    const r = this.remotePlayers.get(id)
    if (r) { this.engine.scene.remove(r.rig.group); this.remotePlayers.delete(id) }
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

  private onCapture(playerId: string, until: number, message: string) {
    if (!this.player) return
    if (playerId === this.net.playerId || this.offline) {
      this.exitPhotoMode(false)
      this.player.detain()
      this.stats.detentions++
      this.detainUntil = until
      this.store.notify(message || randomOf(CAPTURE_MESSAGES), 'capture')
      AudioManager.play('capture')
      this.camRig.addShake(0.7)
    } else {
      const r = this.remotePlayers.get(playerId)
      if (r) r.detained = true
      this.store.notify(`Teammate detained: ${r?.name ?? 'someone'}`, 'squad')
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
      const p = r.rig.group.position
      const d = this.player.pos.distanceTo(p)
      if (!best || d < best.d) best = { id, name: r.name, x: p.x, y: p.y, z: p.z, d }
    }
    if (!best) { store.notify('No free cellmate to rally to — everyone is detained!', 'warning'); return }
    this.player.teleport(best.x, best.z)
    this.player.pos.y = best.y
    this.camRig.yaw = 0
    this.rallyReadyAt = Date.now() + Game.RALLY_COOLDOWN_MS
    useGameStore.getState().patchHud({ rallyReadyAt: this.rallyReadyAt })
    this.fx.popup('SOLIDARITY RALLY!', '#2e6e4e', best.x, 2.4, best.z)
    this.store.notify(`Rallied to ${best.name} (${Math.round(best.d)}m closer to the cause)`, 'squad')
    AudioManager.play('checkpoint')
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
      r.rig.setNameColor(r.name, this.squad.memberIds.has(id) ? '#7ee08a' : '#ffffff')
    }
  }

  // ================= input & actions =================
  private handleOneShot(a: string) {
    const store = useGameStore.getState()
    switch (a) {
      case 'pause':
        if (store.uiMode === 'playing') { this.exitPhotoMode(false); store.setUIMode('paused'); this.input.setEnabled(false) }
        else if (store.uiMode === 'paused') { store.setUIMode('playing'); this.input.setEnabled(true) }
        break
      case 'jump': this.pendingOneShot = 'jump'; break
      case 'slide': this.pendingOneShot = 'slide'; break
      case 'throw': this.doThrow(); break
      case 'emote': store.toggleEmoteWheel(); break
      case 'map': store.toggleMap(); break
      case 'squad': store.toggleSquad(); break
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
    const idx = this.inventory.findIndex(i => i.uid === uid)
    if (idx === -1) return
    const item = this.inventory[idx]
    const p = this.player
    switch (item.type) {
      case 'chai':
        p.stamina = p.maxStamina
        p.speedBoostUntil = this.worldTime + 6
        AudioManager.play('heal')
        this.store.notify('Chai break! Stamina restored. Zindagi ek baar milta hai.', 'info')
        break
      case 'firstaid':
        p.heal(50)
        AudioManager.play('heal')
        this.fx.popup('+50 HP', '#ff8fa3', p.pos.x, 1.9, p.pos.z)
        this.store.notify('Patched up with one (1) band-aid.', 'info')
        break
      case 'snack':
        p.speedBoostUntil = this.worldTime + 8
        AudioManager.play('pickup')
        this.store.notify('Sugar rush! Speed boost for 8s.', 'info')
        break
      case 'joke': {
        const jokes = ['Delicious. Illegal. Worth it.', 'The samosa was filled with classified documents.', 'You feel oddly empowered.', '+10 confidence. -2 health code compliance.']
        p.heal(10)
        AudioManager.play('cash')
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

  private dropInventoryItem(uid: string) {
    const idx = this.inventory.findIndex(i => i.uid === uid)
    if (idx === -1 || !this.player) return
    const item = this.inventory[idx]
    this.inventory.splice(idx, 1)
    // respawn as world item near player
    const spawnDef = this.world.items.find(d => d.type === item.type)
    if (spawnDef) {
      const def = { ...spawnDef, id: `drop_${Date.now().toString(36)}`, x: this.player.pos.x + (Math.random() - 0.5) * 2, y: this.physics.groundHeight(this.player.pos.x, this.player.pos.z, 2) + 0.2, z: this.player.pos.z + (Math.random() - 0.5) * 2, respawn: 25 }
      this.items.spawnDropped(def)
    }
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
      return r ? r.rig.group.position.clone() : null
    }
    this.playerBubbles.say(key, text, getPos, key === 'me' ? 3.2 : 4)
  }

  private onRemoteQuickMsg(playerId: string, msgId: number) {
    if (playerId === this.net.playerId) return // server relays to the whole room, incl. sender
    const msg = QUICK_MESSAGES[msgId]
    if (!msg) return
    const r = this.remotePlayers.get(playerId)
    if (r) this.sayBubble(playerId, msg)
    this.store.notify(`${r?.name ?? 'Protester'}: ${msg}`, 'squad')
  }

  private handleVehicleHit(kind: string, x: number, z: number, dmg: number) {
    if (!this.player) return
    if (this.player.damage(dmg, kind)) {
      this.store.notify(kind === 'cow' ? 'Headbutted by a cow. It regrets nothing.' : 'Traffic remains undefeated.', 'warning')
    }
    this.player.knockback(x, z, kind === 'cow' ? 4 : 9)
    AudioManager.play(kind === 'cow' ? 'moo' : 'horn')
    this.camRig.addShake(kind === 'cow' ? 0.3 : 0.8)
    this.applyDamage(0, kind) // trigger HUD update
  }

  private applyDamage(amount: number, kind: string) {
    if (!this.player) return
    if (amount > 0) {
      this.player.damage(amount, kind)
      AudioManager.play('hit')
      this.camRig.addShake(Math.min(0.8, amount / 40))
    }
    this.syncHud()
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
      }
      this.npcs.simulateLocal(dt, pv, this.world.colliders, Date.now())
      // searchlight rotation local
      for (const sl of this.world.searchlights) {
        this.localSearchlightAngles[sl.id] += sl.speed * dt
      }
    }

    // vehicles (clock synced to server when online so damage matches visuals)
    const vehicleTime = this.offline || !this.serverMatchStart ? this.matchTime : (Date.now() - this.serverMatchStart) / 1000
    this.vehicles.update(vehicleTime, dt, this.player.pos, true)

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
        if (ev.speechShock) { AudioManager.play('shockwave'); this.camRig.addShake(0.6) }
        if (ev.phaseDone >= 1) {
          AudioManager.play('checkpoint')
          if (ev.defeated) { this.doVictory() }
          else if (ev.phaseDone === 5) AudioManager.play('gate')
        }
        // ballot proximity (grab)
        if (this.localBoss.phase === 5 && !this.carryingBallot) {
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

    // item pickup (proximity + E / auto for tokens)
    const near = this.items.nearestAvailable(this.player.pos.x, this.player.pos.z, this.player.pos.y)
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
      // revive / heal teammates / deposit ballots
      let prompt: string | null = null
      if (this.carryingBallot && this.bossActiveLocal) prompt = 'E — Deposit ballot'
      if (this.input.state.interact && this.carryingBallot) {
        if (this.offline && this.localBoss) {
          if (Math.hypot(this.player.pos.x - this.localBoss.x, this.player.pos.z - (this.localBoss.z + 2)) < 3.4 && this.carryingBallot) {
            this.carryingBallot = false; this.localBoss.votes++; AudioManager.play('cash')
          }
        } else this.net.bossDeposit(this.player.pos.x, this.player.pos.z)
      }
      if (this.store.hud.interactPrompt !== prompt) this.store.patchHud({ interactPrompt: prompt })
    }

    // network send 12Hz
    this.stateSendAccum += dt
    if (this.stateSendAccum >= 1 / 12) {
      this.stateSendAccum = 0
      if (!this.offline && this.net.connected && !this.matchEnded) {
        const anim = this.player.rig.anim
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
    // fx update (floating popups) + player speech bubbles (emotes, quick messages)
    this.fx.update(dt)
    this.playerBubbles.update(dt)

    // boss intro cinematic — orbit the boss once on activation
    this.updateBossCinematic(dt)
    // remote player interpolation
    for (const [, r] of this.remotePlayers) {
      r.rig.group.position.lerp(new THREE.Vector3(r.target.x, r.target.y, r.target.z), Math.min(1, dt * 10))
      let d = r.target.ry - r.rig.group.rotation.y
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      r.rig.group.rotation.y += d * Math.min(1, dt * 8)
      const hSpeed = r.anim === 'run' ? 9 : r.anim === 'walk' ? 5 : 0
      r.rig.update(dt, r.detained ? 'detained' : r.anim, hSpeed)
    }

    const playing = store.uiMode === 'playing'
    if (playing) {
      this.player.render(dt)
      this.npcs.update(dt, 1, this.worldTime, this.player.pos.x, this.player.pos.z)
      this.items.update(dt, this.worldTime, this.worldTime)
    } else {
      this.npcs.update(dt, 1, this.worldTime)
    }

    // camera — spectate a live teammate while detained; photo mode orbits the player
    let focus: THREE.Vector3 = this.player.pos
    this.spectateName = null
    if (this.player.isDetained) {
      let bestDist = Infinity
      for (const [, r] of this.remotePlayers) {
        if (r.detained) continue
        const d = Math.hypot(r.target.x - this.player.pos.x, r.target.z - this.player.pos.z)
        if (d < bestDist) { bestDist = d; focus = r.rig.group.position; this.spectateName = r.name }
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
    const fog = this.engine.scene.fog as THREE.Fog
    fog.near = 60
    fog.far = this.engine.quality === 'low' ? 150 : 210

    // world animation
    this.worldRenderer.update(dt, this.worldTime, this.offline ? this.localSearchlightAngles : this.serverNpcRys)

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
    // adaptive music: chase when chased — also drives the WANTED alert
    const chased = this.npcs.nearestChaserDistance(focus.x, focus.z) < 18
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
    let objective = 'Recover the stolen vote tokens!'
    if (this.tokens >= this.tokensNeeded) objective = 'Enter the Government District — defeat the Vote Collector!'
    else if (this.activatedCheckpoints.size >= 4) objective = `Collect vote tokens (${this.tokens}/${this.tokensNeeded}) to open the boss gate`
    const squad = [...this.remotePlayers.entries()].map(([id, r]) => ({
      id, name: r.name, health: r.health, detained: r.detained, dazed: r.anim === 'dazed', archetype: '', distance: Math.hypot(r.target.x - p.pos.x, r.target.z - p.pos.z),
    }))
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
    // hurt? point to the nearest first-aid kit
    if (p.health < 45) {
      let bestFa: { d: number; x: number; z: number } | null = null
      for (const it of this.items.items) {
        if (it.taken || it.def.type !== 'firstaid') continue
        const d = Math.hypot(it.def.x - p.pos.x, it.def.z - p.pos.z)
        if (d < 130 && (!bestFa || d < bestFa.d)) bestFa = { d, x: it.def.x, z: it.def.z }
      }
      if (bestFa) markers.push({ kind: 'firstaid', ...rel(bestFa.x, bestFa.z) })
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
      score: this.stats.tokens * 45 + this.stats.checkpoints * 60,
      compass: { yawDeg, markers },
      spectating: p.isDetained ? this.spectateName : null,
    })
  }

  setMinimapCanvas(c: HTMLCanvasElement | null) { this.minimapCanvas = c }

  private drawMinimap() {
    const canvas = this.minimapCanvas
    if (!canvas || !this.player) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    // world: z from 10 to -572, x -48..48 → vertical strip
    const toX = (x: number) => ((x + 48) / 96) * W
    const toY = (z: number) => ((10 - z) / 582) * H
    // zones
    const zoneColors = ['rgba(201,111,74,0.25)', 'rgba(184,92,62,0.25)', 'rgba(127,154,140,0.25)', 'rgba(201,168,106,0.25)', 'rgba(154,123,95,0.3)']
    this.world.zones.forEach((z, i) => {
      ctx.fillStyle = zoneColors[i]
      ctx.fillRect(0, toY(z.zStart), W, toY(z.zEnd) - toY(z.zStart))
    })
    // road
    ctx.fillStyle = 'rgba(80,80,80,0.5)'
    ctx.fillRect(toX(-8), 0, toX(8) - toX(-8), H)
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
      tokens: serverPayload?.tokens ?? this.stats.tokens,
      distance: serverPayload?.distance ?? Math.round(p.distance),
      checkpoints: serverPayload?.checkpoints ?? this.stats.checkpoints,
      rescues: serverPayload?.rescues ?? this.stats.rescues,
      revives: serverPayload?.revives ?? this.stats.revives,
      itemsCollected: serverPayload?.itemsCollected ?? this.stats.itemsCollected,
      bossContribution: serverPayload?.bossContribution ?? this.stats.bossHits,
      detentions,
    }
    // XP calculation (client display)
    const xp = Math.round(
      XP_TABLE.participation + stats.distance * XP_TABLE.perMeter +
      stats.checkpoints * XP_TABLE.perCheckpoint + stats.tokens * XP_TABLE.perToken +
      stats.rescues * XP_TABLE.perRescue + stats.revives * XP_TABLE.perRevive +
      stats.itemsCollected * XP_TABLE.perItem + stats.bossContribution * XP_TABLE.bossHit +
      (victory ? XP_TABLE.victoryBonus : 0),
    )
    const { VICTORY_TITLES } = await import('./shared/constants')
    const title = VICTORY_TITLES({ detentions, rescues: stats.rescues, revives: stats.revives, items: stats.itemsCollected, distance: stats.distance, victory })
    // persist
    let newAchievements: { id: string; name: string }[] = []
    let leveledUp = false
    let newLevel = store.profile?.level ?? 1
    let xpEarned = xp
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
            position: stats.position, multiplayer: !this.offline,
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
    const summary: MatchSummary = { ...stats, xpEarned, funnyTitle: title, newAchievements, leveledUp, newLevel, matchId: serverPayload?.matchId ?? 'offline', duration: serverPayload?.duration ?? Math.round(this.matchTime), playersOnline: serverPayload?.playersOnline ?? 1, dailyBonus, dailyDesc, dailyJustCompleted, weeklyBonus, weeklyJustCompleted, streak, streakUp, solidarityBonus, squadSize }
    store.setMatchSummary(summary)
    store.setUIMode('ended')
    AudioManager.setTheme('menu')
    AudioManager.setCrowdLevel(0.2)
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
    this.input?.dispose()
    this.engine?.dispose()
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
    btn: (name: 'sprint' | 'jump' | 'slide' | 'interact' | 'throw', down: boolean) => {
      const input = g['input'] as InputManager | undefined
      if (!input) return
      input.touchButtons[name] = down
      input.sync()
      if (down && name === 'jump') input.onOneShot?.('jump')
      if (down && name === 'throw') input.onOneShot?.('throw')
      if (down && name === 'slide') input.onOneShot?.('slide')
    },
    setMinimap: (c: HTMLCanvasElement | null) => g.setMinimapCanvas(c),
  }
}

// singleton
let gameInstance: Game | null = null
export function getGame(): Game { if (!gameInstance) gameInstance = new Game(); return gameInstance }
