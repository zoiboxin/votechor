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

export const QUICK_MESSAGES = [
  'Chai break, anyone?', 'Follow me!', 'POLICE! Scatter!', 'Nice one!', 'Help! Detained!',
  'To the flyover!', 'Uncle Ji approves.', 'Form a squad!', 'The gate needs votes!', 'Boss time!',
]

export const EMOTES = ['wave', 'salute', 'dance', 'facepalm', 'flex', 'cry']

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
  private net = new NetClient()
  private world = buildWorldDef()

  private mode: 'solo' | 'multiplayer' | null = null
  private offline = false
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

  async boot(canvas: HTMLCanvasElement, minimap: HTMLCanvasElement) {
    this.minimapCanvas = minimap
    this.engine = new Engine(canvas)
    this.physics.setColliders(this.world.colliders)
    this.worldRenderer = new WorldRenderer(this.world, 'high')
    this.engine.scene.add(this.worldRenderer.group)
    this.engine.scene.add(this.bossClient.group)

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
      onPlayerLeft: (playerId, name) => { this.removeRemote(playerId); this.store.notify(`${name} left the protest`, 'info') },
      onPlayerJoined: (_playerId, name) => this.store.notify(`${name} joined the protest!`, 'squad'),
      onHealth: (playerId, health, dazed) => this.onRemoteHealth(playerId, health, dazed),
      onDamage: (playerId, amount, kind) => { if (playerId === this.net.playerId) this.applyDamage(amount, kind) },
      onMatchEnd: (payload) => this.handleMatchEnd(payload),
      onTokens: (count) => { this.tokens = count; this.checkGate() },
      onGate: (open) => this.setGate(open),
      onPing: (ms) => this.store.patchHud({ ping: ms }),
      onDisconnect: () => {
        if (this.running && !this.offline) {
          this.store.notify('Connection lost — switching to offline mode', 'warning')
          this.offline = true
          this.store.patchHud({ connection: 'offline' })
        }
      },
      onConnect: () => { if (this.running) this.store.patchHud({ connection: 'connected' }) },
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
      sendQuickMessage: (id) => { this.net.quickMsg(id); this.store.notify(QUICK_MESSAGES[id] ?? '', 'squad') },
      respawnRequest: () => {},
    })

    this.engine.start()
    AudioManager.resume()
    AudioManager.startCrowd()
    AudioManager.setTheme('menu')
    useGameStore.getState().setUIMode('menu')
    // debug handle for QA tooling
    ;(window as unknown as { __vc: unknown }).__vc = this
  }

  // ================= match lifecycle =================
  private async startMatch(mode: 'solo' | 'multiplayer', roomCode: string | null) {
    const store = useGameStore.getState()
    store.setUIMode('loading')
    this.mode = mode
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

    const profile = store.profile
    this.archetype = profile?.archetype ?? 'student'
    const name = profile?.name ?? 'Protester'

    // reset world states
    this.worldRenderer.setBossGateOpen(false)
    this.bossClient.hideAll()
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
  }

  leaveMatch() {
    if (this.matchEnded) return
    this.net.leave()
    this.running = false
    this.input.setEnabled(false)
    AudioManager.setTheme('menu')
    AudioManager.setCrowdLevel(0.25)
    const st = useGameStore.getState()
    st.setUIMode('menu')
    st.setMenuScreen('main')
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
    const map: Record<string, AnimName> = { wave: 'celebrate', dance: 'celebrate', salute: 'idle', facepalm: 'dazed', flex: 'celebrate', cry: 'dazed' }
    r.anim = map[emote] ?? 'celebrate'
  }

  // ================= input & actions =================
  private handleOneShot(a: string) {
    const store = useGameStore.getState()
    switch (a) {
      case 'pause':
        if (store.uiMode === 'playing') { store.setUIMode('paused'); this.input.setEnabled(false) }
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
    this.player.playAnim(emote === 'cry' || emote === 'facepalm' ? 'dazed' : 'celebrate', 1.6)
    this.net.emote(emote)
    useGameStore.getState().toggleEmoteWheel(false)
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

    // input
    const [ldx, ldy] = this.input.consumeLook()
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
      this.npcs.update(dt, 1, this.worldTime)
      this.items.update(dt, this.worldTime, this.worldTime)
    }

    // camera
    const focus = this.player.pos
    const [ldx, ldy] = playing ? [0, 0] : [0, 0]
    this.camRig.update(dt, focus, ldx, ldy)
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
    // adaptive music: chase when chased
    const chased = this.npcs.nearestChaserDistance(focus.x, focus.z) < 18
    if (this.bossActiveLocal) AudioManager.setTheme('boss')
    else if (chased) AudioManager.setTheme('chase')
    else if (this.running) AudioManager.setTheme('ambient')
    AudioManager.setCrowdLevel(chased ? 0.9 : Math.max(0.3, 1 - Math.abs(focus.z) / 560))
  }
  private lastZoneIdx = -1

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
          }),
        })
        if (res.ok) {
          const data = await res.json() as { xpEarned: number; level: number; leveledUp: boolean; newAchievements: { id: string; name: string }[]; profile: { xp: number; level: number } }
          xpEarned = data.xpEarned
          newAchievements = data.newAchievements ?? []
          leveledUp = data.leveledUp
          newLevel = data.level
          if (data.profile && store.profile) {
            store.setProfile({ ...store.profile, xp: data.profile.xp, level: data.profile.level })
          }
          for (const a of newAchievements) store.notify(`Achievement: ${a.name}!`, 'achievement')
          if (leveledUp) { store.notify(`LEVEL UP — Level ${newLevel}!`, 'achievement'); AudioManager.play('victory') }
        }
      } catch { /* offline persistence failure is fine */ }
    }
    const summary: MatchSummary = { ...stats, xpEarned, funnyTitle: title, newAchievements, leveledUp, newLevel, matchId: serverPayload?.matchId ?? 'offline', duration: serverPayload?.duration ?? Math.round(this.matchTime), playersOnline: serverPayload?.playersOnline ?? 1 }
    store.setMatchSummary(summary)
    store.setUIMode('ended')
    AudioManager.setTheme('menu')
    AudioManager.setCrowdLevel(0.2)
  }

  dispose() {
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
