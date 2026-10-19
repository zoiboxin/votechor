/**
 * v87 — SHARED WILD: server-authoritative zombie simulation (pure logic, no THREE).
 *
 * The Vanodyan undead used to be a client-local sim: every browser ran its own
 * Math.random() wander loop and chased only its own player, so two players in the
 * same room saw two different hordes in two different places. This module is the
 * single server-side source of truth (same pattern as npc-brain.ts):
 *   - the room ticks it at 10 Hz against NpcPlayerViews (every player AND bot),
 *   - strikes flow through the room's server-owned damagePlayer pipeline,
 *   - a compact `game:wild` snapshot (ZombieNetState[]) keeps every client's
 *     renderers pixel-identical.
 * The client (src/game/zombies.ts) keeps all visuals/animation/audio and runs this
 * exact same state machine LOCALLY when the match is truly offline.
 */
import type { NpcPlayerView } from './npc-brain'

/** Deep-jungle spawn pockets — all in open clearings (world-def keeps trees,
 *  the river band, the trail and the mountain bases clear of these points).
 *  Index order is the NET ID contract: zombie i renders from snapshot i. */
export const ZOMBIE_SPOTS: Array<[number, number]> = [
  [-60, -620], [30, -615], [-140, -650], [100, -645],
  [-30, -700], [-110, -715], [20, -735], [150, -690],
  [-170, -720], [86, -742], [-56, -742], [186, -740],
  // v68b — wider coverage so the deep south always feels hunted
  [120, -620], [165, -655], [40, -655], [-105, -730], [-150, -735], [90, -730],
  // v69 — the ROUND wild: ambushes at every city exit, the wings, and the
  // Kabristan pack guarding the graves
  [190, -150], [190, -379], [188, -540], [-190, -150], [-190, -379], [-188, -540],
  [60, 55], [-90, 50], [160, 35],
  [260, -379], [-260, -500], [300, -620],
  [-250, -310], [-280, -345], [-240, -350], [-295, -320],
]

/** v70 — CITY SANCTUARY: the undead never cross the wildness-0 line
 *  (|x| < 150 and -560 < z < 14 — exactly the zone wildnessAt() scores zero). */
export const citySafe = (x: number, z: number) => Math.abs(x) < 150 && z < 14 && z > -560

export const ZOMBIE_DETECT_R = 14 // jungle is dense — you hear it before you see it
export const ZOMBIE_LOSE_R = 30   // sprint and the canopy swallows you
export const ZOMBIE_STRIKE_R = 1.7
export const ZOMBIE_STRIKE_DMG = 16
/** v81 — pack gate: only ONE spot-scare per window, no matter how many
 *  zombies in a pocket aggro together (server-side now, room-wide). */
export const ZOMBIE_SPOT_GATE_SEC = 5

export interface ZombieSimState {
  id: number
  home: { x: number; z: number }
  x: number; z: number; ry: number
  state: 'lurch' | 'chase'
  targetId: string | null
  target: { x: number; z: number }
  speed: number
  stateT: number
  strikeT: number
  loseT: number
  lunge: number
}

export type ZombieSimEvent =
  | { kind: 'strike'; playerId: string; zombieId: number; amount: number }
  | { kind: 'spot'; playerId: string; zombieId: number; x: number; z: number }

export function createZombieSimStates(): ZombieSimState[] {
  return ZOMBIE_SPOTS.map(([x, z], i) => ({
    id: i,
    home: { x, z },
    x, z, ry: Math.random() * 6.28,
    state: 'lurch' as const,
    targetId: null,
    target: { x, z },
    speed: 4.9 + Math.random() * 0.7,
    stateT: Math.random() * 4,
    strikeT: 0,
    loseT: 0,
    lunge: 0,
  }))
}

/** A view is prey when it is out in the open: not detained, not dazed, and not
 *  inside the v49/v86 release/escape grace (hidden). Bots ARE prey — the wild
 *  hunts every protester, which keeps the horde lively in season rooms. */
function prey(views: NpcPlayerView[]): NpcPlayerView[] {
  return views.filter(v => !v.detained && !v.dazed && !v.hidden)
}

/**
 * Tick the whole horde by dt seconds. Mutates states in place, appends events.
 * Ported 1:1 from the client ZombieSystem.update state machine (v68–v81 feel:
 * lurch wander, DETECT_R acquisition, sanctuary sliding, LOSE_R give-up,
 * strike cadence 1.15 s), generalized to multi-player targeting.
 */
export function tickZombies(
  zombies: ZombieSimState[],
  views: NpcPlayerView[],
  dt: number,
  now: number,
  out: ZombieSimEvent[],
  packGate: { spotT: number },
): void {
  const preyViews = prey(views)
  packGate.spotT -= dt
  for (const zb of zombies) {
    // nearest eligible prey
    let tgt: NpcPlayerView | null = null
    let dist = Infinity
    for (const v of preyViews) {
      const d = Math.hypot(v.x - zb.x, v.z - zb.z)
      if (d < dist) { dist = d; tgt = v }
    }

    // ---- state machine ----
    if (zb.state === 'lurch') {
      if (tgt && dist < ZOMBIE_DETECT_R) {
        zb.state = 'chase'
        zb.targetId = tgt.id
        zb.loseT = 0
        zb.strikeT = 0.4 // first swipe comes fast — the scare is the point
        if (packGate.spotT <= 0) {
          packGate.spotT = ZOMBIE_SPOT_GATE_SEC
          out.push({ kind: 'spot', playerId: tgt.id, zombieId: zb.id, x: zb.x, z: zb.z })
        }
      }
    } else if (!tgt || tgt.id !== zb.targetId) {
      // target went detained/dazed/graced → drop the hunt, walk home
      zb.state = 'lurch'
      zb.targetId = null
      zb.target = { ...zb.home }
      zb.loseT = 0
      zb.strikeT = 0
    } else if (dist > ZOMBIE_LOSE_R) {
      zb.loseT += dt
      if (zb.loseT > 4) {
        zb.state = 'lurch'
        zb.targetId = null
        zb.target = { ...zb.home }
      }
    } else {
      zb.loseT = 0
    }

    // ---- movement ----
    let moving = false
    if (zb.state === 'chase' && tgt) {
      const dx = tgt.x - zb.x, dz = tgt.z - zb.z
      const d = Math.max(dist, 0.001)
      const sp = dist < ZOMBIE_STRIKE_R + 0.4 ? zb.speed * 0.25 : zb.speed
      // v70 — sanctuary block: step toward the player, slide along the city
      // line when the straight step would cross it, freeze if fully blocked.
      let mx = (dx / d) * sp * dt, mz = (dz / d) * sp * dt
      if (citySafe(zb.x + mx, zb.z + mz)) {
        if (!citySafe(zb.x + mx, zb.z)) { mz = 0 }
        else if (!citySafe(zb.x, zb.z + mz)) { mx = 0 }
        else { mx = 0; mz = 0 }
      }
      if (mx !== 0 || mz !== 0) {
        zb.x += mx
        zb.z += mz
        zb.ry = Math.atan2(dx, dz)
        moving = true
      }
      // the player reached safety — the hunt is over, walk home
      if (citySafe(tgt.x, tgt.z)) {
        zb.state = 'lurch'
        zb.targetId = null
        zb.target = { ...zb.home }
        zb.loseT = 0
        zb.strikeT = 0
      }
    } else if (zb.state === 'lurch') {
      zb.stateT -= dt
      const tdx = zb.target.x - zb.x, tdz = zb.target.z - zb.z
      const tdist = Math.hypot(tdx, tdz)
      if (zb.stateT <= 0) {
        zb.stateT = 2.5 + Math.random() * 4
        if (tdist < 0.8) {
          // pick a new wander target around home (v70 — never across the city line)
          const ang = Math.random() * 6.28, r = 2 + Math.random() * 6
          const tx = zb.home.x + Math.cos(ang) * r, tz = zb.home.z + Math.sin(ang) * r
          zb.target = citySafe(tx, tz) ? { ...zb.home } : { x: tx, z: tz }
        }
      }
      if (tdist > 0.6) {
        const sp = 0.75
        const inv = 1 / tdist
        let mx = tdx * inv * sp * dt, mz = tdz * inv * sp * dt
        if (citySafe(zb.x + mx, zb.z + mz)) {
          if (!citySafe(zb.x + mx, zb.z)) { mz = 0 }
          else if (!citySafe(zb.x, zb.z + mz)) { mx = 0 }
          else { mx = 0; mz = 0 }
        }
        if (mx !== 0 || mz !== 0) {
          zb.x += mx
          zb.z += mz
          const want = Math.atan2(tdx, tdz)
          let d2 = want - zb.ry
          while (d2 > Math.PI) d2 -= 6.2832
          while (d2 < -Math.PI) d2 += 6.2832
          zb.ry += d2 * Math.min(1, dt * 2.2)
          moving = true
        }
      }
    }

    // ---- strike (chase, in reach, cooldown elapsed) ----
    zb.strikeT -= dt
    if (zb.state === 'chase' && tgt && dist < ZOMBIE_STRIKE_R && zb.strikeT <= 0) {
      zb.strikeT = 1.15
      zb.lunge = 1
      out.push({ kind: 'strike', playerId: tgt.id, zombieId: zb.id, amount: ZOMBIE_STRIKE_DMG })
    }
    if (zb.lunge > 0) zb.lunge = Math.max(0, zb.lunge - dt * 2.6)
    // carry moving for the renderer's leg animation (one tick of truth)
    ;(zb as ZombieSimState & { moving?: boolean }).moving = moving
    void now
  }
}
