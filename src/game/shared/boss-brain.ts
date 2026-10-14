// VoteChor boss brain — The Great Vote Collector. Pure deterministic FSM logic.
// Server ticks this at 10Hz and broadcasts state; clients render.
import type { StationState, Telegraph } from './types'

export interface BossBallot { id: string; x: number; z: number; taken: boolean; carrier?: string | null }
export interface PaperHazard { id: string; x: number; z: number; vx: number; vz: number; life: number }

export interface BossBrain {
  active: boolean
  started: boolean
  phase: number // 0 intro, 1..5, 6 defeated
  health: number
  maxHealth: number
  stateName: string
  timer: number
  x: number; z: number; ry: number
  speech: number       // phase1 meter 0..100
  interruptPoints: number
  documents: number    // phase2 progress
  stampIndex: number
  dizzyTimer: number
  hits: number
  teamworkProgress: number
  votes: number
  votesNeeded: number
  telegraphs: Telegraph[]
  stations: StationState[]
  paperwork: PaperHazard[]
  ballots: BossBallot[]
  spawnTimer: number
  stampTimer: number
  invulnHits: Record<string, number> // playerId -> last hit time
  victoryTimer: number
  shockCooldown: number
}

export interface BossPlayerView { id: string; x: number; z: number; detained: boolean; dazed: boolean }

export interface BossTickEvents {
  damage: { playerId: string; amount: number; kind: string }[]
  phaseDone: number
  defeated: boolean
  speechShock: boolean
  hitRegistered: boolean
  ballotsChanged: boolean
  votesChanged: boolean
}

const STATIONS: Record<number, { id: string; x: number; z: number }[]> = {
  1: [
    { id: 'mega1', x: -14, z: -508 },
    { id: 'mega2', x: 14, z: -508 },
    { id: 'mega3', x: 0, z: -534 },
  ],
  2: [
    { id: 'sort1', x: -16, z: -506 }, { id: 'sort2', x: 16, z: -506 },
    { id: 'sort3', x: -16, z: -532 }, { id: 'sort4', x: 16, z: -532 },
  ],
  4: [
    { id: 'team1', x: -13, z: -518 },
    { id: 'team2', x: 13, z: -518 },
  ],
}

export function createBossBrain(arena: { x: number; z: number; radius: number }): BossBrain {
  return {
    active: false, started: false, phase: 0, health: 100, maxHealth: 100,
    stateName: 'dormant', timer: 0, x: arena.x, z: arena.z - 14, ry: Math.PI,
    speech: 0, interruptPoints: 0, documents: 0, stampIndex: 0, dizzyTimer: 0,
    hits: 0, teamworkProgress: 0, votes: 0, votesNeeded: 10,
    telegraphs: [], stations: [], paperwork: [], ballots: [],
    spawnTimer: 3, stampTimer: 0, invulnHits: {}, victoryTimer: 0, shockCooldown: 0,
  }
}

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz)

export function tickBoss(b: BossBrain, players: BossPlayerView[], dt: number, now: number): BossTickEvents {
  const ev: BossTickEvents = { damage: [], phaseDone: -1, defeated: false, speechShock: false, hitRegistered: false, ballotsChanged: false, votesChanged: false }
  if (!b.started) {
    // Start when any non-detained player enters arena
    const trigger = players.find(p => !p.detained && dist(p.x, p.z, b.x, b.z) < 30)
    if (trigger) { b.started = true; b.active = true; b.phase = 0; b.stateName = 'intro'; b.timer = 0 }
    return ev
  }
  b.timer += dt
  const alive = players.filter(p => !p.detained && !p.dazed)

  // Clean expired telegraphs — impact applies damage exactly once at t<=0, then removed
  b.telegraphs = b.telegraphs.filter(t => {
    t.t -= dt
    if (t.t <= 0) {
      for (const p of alive) {
        if (dist(p.x, p.z, t.x, t.z) < t.r) ev.damage.push({ playerId: p.id, amount: t.kind === 'stamp' ? 30 : 25, kind: t.kind })
      }
      return false
    }
    return true
  })

  // Paperwork hazards chase players
  for (const h of b.paperwork) {
    h.life -= dt
    let nearest: BossPlayerView | null = null
    let nd = 1e9
    for (const p of alive) { const d = dist(h.x, h.z, p.x, p.z); if (d < nd) { nd = d; nearest = p } }
    if (nearest && nd > 0.6) {
      const sp = 3.6
      h.vx = ((nearest.x - h.x) / nd) * sp
      h.vz = ((nearest.z - h.z) / nd) * sp
      h.x += h.vx * dt; h.z += h.vz * dt
    }
    if (nearest && nd < 1.1) {
      ev.damage.push({ playerId: nearest.id, amount: 10, kind: 'paperwork' })
      h.life = 0 // pops on hit
    }
  }
  b.paperwork = b.paperwork.filter(h => h.life > 0)
  b.paperwork = b.paperwork.filter(h => dist(h.x, h.z, b.x, b.z) < 45)

  switch (b.phase) {
    case 0: // intro
      if (b.timer > 5) setPhase(b, 1, ev)
      break
    case 1: { // The Speech
      b.stateName = 'speech'
      ensureStations(b, 1)
      b.speech = Math.min(100, b.speech + dt * 1.15)
      let draining = 0
      for (const s of b.stations) {
        s.active = false
        for (const p of alive) {
          if (dist(p.x, p.z, s.x, s.z) < 3.2) { s.active = true; draining++ }
        }
      }
      b.speech = Math.max(0, b.speech - dt * draining * 5)
      b.interruptPoints += dt * draining * 4
      if (b.speech >= 100) {
        b.speech = 65
        ev.speechShock = true
        for (const p of players) {
          if (dist(p.x, p.z, b.x, b.z) < 40) ev.damage.push({ playerId: p.id, amount: 22, kind: 'speech' })
        }
      }
      if (b.interruptPoints >= 120) { b.stations = []; setPhase(b, 2, ev) }
      break
    }
    case 2: { // Bureaucracy Attack
      b.stateName = 'paperwork'
      ensureStations(b, 2)
      for (const s of b.stations) {
        s.active = false
        for (const p of alive) {
          if (dist(p.x, p.z, s.x, s.z) < 3.2) { s.active = true; s.progress += dt * 4 }
        }
      }
      b.documents = Math.min(240, b.stations.reduce((acc, s) => acc + Math.min(s.progress, 70), 0))
      b.spawnTimer -= dt
      if (b.spawnTimer <= 0 && b.paperwork.length < 5) {
        b.spawnTimer = 4.5
        spawnPaper(b, alive)
      }
      if (b.documents >= 240) { b.stations = []; setPhase(b, 3, ev) }
      break
    }
    case 3: { // Giant Stamp
      b.stateName = b.dizzyTimer > 0 ? 'dizzy' : 'stamp'
      if (b.dizzyTimer > 0) {
        b.dizzyTimer -= dt
      } else {
        b.stampTimer -= dt
        if (b.stampTimer <= 0 && b.telegraphs.filter(t => t.kind === 'stamp' && t.t > 0).length === 0) {
          b.stampTimer = 2.6
          b.stampIndex++
          const target = alive[Math.floor(Math.random() * Math.max(1, alive.length))]
          const tx = target ? target.x : b.x + (Math.random() - 0.5) * 30
          const tz = target ? target.z : b.z + 10 + Math.random() * 14
          b.telegraphs.push({ id: `stamp${now}`, kind: 'stamp', x: tx, z: tz, r: 5.2, t: 2.1, dur: 0 })
          if (b.stampIndex % 3 === 0) {
            // after every 3rd stamp, boss gets dizzy — hit window
            b.dizzyTimer = 6.5
            b.telegraphs.push({ id: `ring${now}`, kind: 'ring', x: b.x, z: b.z, r: 7, t: 0.9, dur: 0 })
          }
          if (b.stampIndex % 2 === 0 && b.paperwork.length < 4) spawnPaper(b, alive)
        }
      }
      if (b.hits >= 6) { setPhase(b, 4, ev) }
      break
    }
    case 4: { // Teamwork Challenge
      b.stateName = 'teamwork'
      ensureStations(b, 4)
      const occ: boolean[] = b.stations.map(s => alive.some(p => dist(p.x, p.z, s.x, s.z) < 3.4))
      const solo = players.length <= 1
      if (solo ? occ.some(Boolean) : occ.every(Boolean)) b.teamworkProgress += dt
      else b.teamworkProgress = Math.max(0, b.teamworkProgress - dt * 0.7)
      b.spawnTimer -= dt
      if (b.spawnTimer <= 0 && b.paperwork.length < 7) { b.spawnTimer = 3.2; spawnPaper(b, alive) }
      if (b.teamworkProgress >= 12) { b.stations = []; setPhase(b, 5, ev); spawnBallots(b) }
      break
    }
    case 5: { // Final Vote
      b.stateName = 'finalvote'
      b.spawnTimer -= dt
      if (b.spawnTimer <= 0 && b.ballots.filter(x => !x.taken).length < 4) {
        b.spawnTimer = 3
        spawnBallot(b)
      }
      // deposit check
      for (const p of alive) {
        if (p.dazed || p.detained) continue
        if (dist(p.x, p.z, b.x, b.z + 2) < 3) {
          // carrying? deposit handled via grab/deposit events from client; here we auto-deposit any carried ballot
        }
      }
      if (b.votes >= b.votesNeeded) {
        b.stateName = 'defeated'
        b.phase = 6
        b.health = 0
        b.paperwork = []
        b.telegraphs = []
        ev.defeated = true
        ev.phaseDone = 6
      }
      break
    }
    case 6:
      b.victoryTimer += dt
      break
  }
  return ev
}

function setPhase(b: BossBrain, phase: number, ev: BossTickEvents) {
  b.phase = phase
  b.timer = 0
  b.stampTimer = 2
  b.stampIndex = 0
  b.speech = 0
  b.spawnTimer = 2
  if (phase < 6) b.health = Math.max(0, 100 - (phase - 1) * 20)
  ev.phaseDone = phase
}

function ensureStations(b: BossBrain, phase: number) {
  if (b.stations.length === 0 && STATIONS[phase]) {
    b.stations = STATIONS[phase].map(s => ({ ...s, progress: 0, need: 1, active: false }))
  }
}

function spawnPaper(b: BossBrain, players: BossPlayerView[]) {
  const a = Math.random() * Math.PI * 2
  b.paperwork.push({
    id: `pw_${Date.now().toString(36)}_${Math.floor(Math.random() * 999)}`,
    x: b.x + Math.cos(a) * 22, z: b.z + Math.sin(a) * 22 + 10,
    vx: 0, vz: 0, life: 22,
  })
}

function spawnBallot(b: BossBrain) {
  const a = Math.random() * Math.PI * 2
  const r = 10 + Math.random() * 12
  b.ballots.push({
    id: `bl_${Date.now().toString(36)}_${Math.floor(Math.random() * 999)}`,
    x: b.x + Math.cos(a) * r, z: b.z + Math.sin(a) * r,
    taken: false,
  })
}

function spawnBallots(b: BossBrain) {
  b.ballots = []
  for (let i = 0; i < 4; i++) spawnBallot(b)
}

/** Client claims a ballot (server validates proximity). Returns true if valid. */
export function grabBallot(b: BossBrain, playerId: string, x: number, z: number): boolean {
  if (b.phase !== 5) return false
  const bl = b.ballots.find(x2 => !x2.taken && dist(x2.x, x2.z, x, z) < 3.5)
  if (!bl) return false
  bl.taken = true
  bl.carrier = playerId
  return true
}

/** A carried ballot returns to the arena floor (carrier detained/disconnected). */
export function dropBallotsOf(b: BossBrain, playerId: string): boolean {
  let dropped = false
  for (const bl of b.ballots) {
    if (bl.taken && bl.carrier === playerId) {
      bl.taken = false
      bl.carrier = null
      dropped = true
    }
  }
  return dropped
}

/** Deposit carried ballot at ballot box (server validates player position). */
export function depositBallot(b: BossBrain, x: number, z: number): boolean {
  if (b.phase !== 5) return false
  if (dist(x, z, b.x, b.z + 2) > 3.2) return false
  const anyTaken = b.ballots.some(bl => bl.taken)
  if (!anyTaken) return false
  // remove one taken ballot
  const idx = b.ballots.findIndex(bl => bl.taken)
  b.ballots.splice(idx, 1)
  b.votes++
  return true
}

/** Boss hit from thrown item during dizzy window (rate-limited per player). */
export function registerBossHit(b: BossBrain, playerId: string, now: number): boolean {
  if (b.phase !== 3 || b.dizzyTimer <= 0) return false
  const last = b.invulnHits[playerId] ?? 0
  if (now - last < 1400) return false
  b.invulnHits[playerId] = now
  b.hits++
  return true
}
