/**
 * v87 — SHARED WILD: server-authoritative street-animal simulation (pure logic,
 * no THREE). The dogs/cats/cows used to be client-local bots: every browser
 * rolled its own Math.random() wander loop, so a second player saw every
 * animal standing somewhere else (and a fed pet followed nobody). This module
 * is the single server-side source of truth (same pattern as npc-brain.ts):
 *   - the room ticks it at 10 Hz against NpcPlayerViews + a per-view speed map
 *     (the sprint-startle check needs real player speeds),
 *   - feeding is a validated server request (`game:animalFeed`) so the crumb,
 *     the eat timer and the 90 s follow are room-wide truth,
 *   - a compact `game:wild` snapshot (AnimalNetState[]) keeps every client
 *     pixel-identical, crumbs and all.
 * The client (src/game/animals.ts) keeps all visuals/animation/audio and runs
 * this exact state machine LOCALLY when the match is truly offline.
 */
import type { NpcPlayerView } from './npc-brain'
import { PET_FOLLOW_SEC } from './constants'

export type AnimalKind = 'dog' | 'cat' | 'cow'
export type AnimalStateName = 'idle' | 'wander' | 'goEat' | 'eat' | 'follow' | 'flee'

/** World spots (hand-placed on plazas/sidewalk margins, ≥4 m off every vehicle
 *  lane verified by tests/route-check.ts data). Index order is the NET ID
 *  contract: animal i renders from snapshot i. */
export const ANIMAL_SPOTS: Array<{ kind: AnimalKind; x: number; z: number; r: number }> = [
  { kind: 'dog', x: 8, z: -66, r: 7 },    // plaza side, north of Plaza Cross Rd
  { kind: 'dog', x: -7, z: -188, r: 7 },  // Market Exit margin
  { kind: 'dog', x: 10, z: -462, r: 6 },  // Colony Cross Rd east margin
  { kind: 'cat', x: -9, z: -270, r: 5 },  // Avenue Cross Rd north margin
  { kind: 'cat', x: 7, z: -512, r: 5 },   // Parliament Plaza approach
  // task 108 — the procedural street cows are GONE: the GLB cow/bull/donkey/
  // horse herds (WildlifeSystem, domestic habitat) now own the city margins
  // and the farm belt. Dogs + cats keep their street beats.
  { kind: 'dog', x: -180, z: -420, r: 7 }, // west jungle trail
  { kind: 'dog', x: 26, z: 26, r: 6 },     // north jungle east of the spine road
  { kind: 'cat', x: 148, z: -190, r: 6 },  // Committee Square back lane
]

export const ANIMAL_FEED_R = 3.4      // server mirror of the client's nearestFeedable radius
export const ANIMAL_EAT_SEC = 1.9     // goEat → eat → follow cadence
export const ANIMAL_STARTLE_R = 2.2   // sprint-startle radius (mirrors run threshold)
export const ANIMAL_STARTLE_SPD = 6.8

export interface AnimalSimState {
  id: number
  kind: AnimalKind
  label: string
  home: { x: number; z: number }
  wanderR: number
  x: number; z: number; ry: number
  state: AnimalStateName
  sit: boolean
  target: { x: number; z: number }
  stateT: number
  speed: number
  followSpeed: number
  followId: string | null
  followUntil: number
  wasPet: boolean
  crumb: { x: number; z: number } | null
  eatT: number
}

export type AnimalSimEvent =
  | { kind: 'fedStart'; playerId: string; animalId: number; label: string; animal: AnimalKind }
  | { kind: 'fed'; playerId: string; animalId: number; label: string; animal: AnimalKind; extended: boolean }
  | { kind: 'petOver'; playerId: string; animalId: number; label: string }

export function createAnimalSimStates(): AnimalSimState[] {
  return ANIMAL_SPOTS.map((s, i) => ({
    id: i,
    kind: s.kind,
    label: s.kind === 'dog' ? 'The stray dog' : s.kind === 'cat' ? 'The street cat' : 'The cow',
    home: { x: s.x, z: s.z },
    wanderR: s.r,
    x: s.x, z: s.z, ry: Math.random() * 6,
    state: 'idle' as const,
    sit: false,
    target: { x: s.x, z: s.z },
    stateT: 1 + Math.random() * 3,
    speed: s.kind === 'cow' ? 1.1 : s.kind === 'dog' ? 1.9 : 1.6,
    followSpeed: s.kind === 'cow' ? 5.4 : s.kind === 'dog' ? 6.6 : 6.0,
    followId: null,
    followUntil: 0,
    wasPet: false,
    crumb: null,
    eatT: 0,
  }))
}

/**
 * Feeding request — the server-side mirror of the client's feed contract.
 * Validates range + animal availability, drops the crumb between the animal
 * and the player (biased toward the animal), and announces fedStart so the
 * FEEDER's client consumes its food exactly once. Returns the event pushed
 * (or null when rejected — no food is ever consumed on a rejection).
 */
export function feedAnimalById(
  animals: AnimalSimState[],
  animalId: number,
  playerId: string,
  px: number, pz: number,
  now: number,
  out: AnimalSimEvent[],
): AnimalSimEvent | null {
  const a = animals.find(x => x.id === animalId)
  if (!a) return null
  const d = Math.hypot(a.x - px, a.z - pz)
  if (d > ANIMAL_FEED_R + 0.6) return null // small lag tolerance over the client's 3.4
  if (a.crumb || a.state === 'eat' || a.state === 'goEat') return null // already dining
  a.wasPet = now < a.followUntil
  a.followId = playerId // the room-truth owner: after eating, THIS player is followed
  const fx = a.x + (px - a.x) * 0.3
  const fz = a.z + (pz - a.z) * 0.3
  a.crumb = { x: fx, z: fz }
  a.state = 'goEat'
  a.sit = false
  const ev: AnimalSimEvent = { kind: 'fedStart', playerId, animalId: a.id, label: a.label, animal: a.kind }
  out.push(ev)
  return ev
}

/**
 * Tick every animal by dt seconds. `speeds` carries each view's measured
 * m/s from the room's previous tick (the sprint-startle check). Mutates
 * states in place, appends events. Ported 1:1 from the client AnimalSystem.
 */
export function tickAnimals(
  animals: AnimalSimState[],
  views: NpcPlayerView[],
  speeds: Map<string, number>,
  dt: number,
  now: number,
  out: AnimalSimEvent[],
): void {
  const byId = new Map(views.map(v => [v.id, v]))
  for (const a of animals) {
    const feeder = a.followId ? byId.get(a.followId) : undefined

    // ---- pet timer ----
    if (a.state === 'follow' && now >= a.followUntil) {
      const pid = a.followId
      a.followId = null
      a.state = 'wander'
      a.target = { ...a.home }
      if (pid) out.push({ kind: 'petOver', playerId: pid, animalId: a.id, label: a.label })
    }
    // feeder vanished (left the room) — end the follow gracefully
    if (a.state === 'follow' && !feeder) {
      const pid = a.followId
      a.followId = null
      a.state = 'wander'
      a.target = { ...a.home }
      if (pid) out.push({ kind: 'petOver', playerId: pid, animalId: a.id, label: a.label })
    }

    // ---- startle: sprint right into a stray and it hops aside (cows do not care) ----
    const pd = feeder ? Math.hypot(feeder.x - a.x, feeder.z - a.z) : Infinity
    if ((a.kind === 'dog' || a.kind === 'cat') && a.state !== 'follow' && a.state !== 'flee' &&
        a.state !== 'eat' && a.state !== 'goEat') {
      for (const v of views) {
        const sp = speeds.get(v.id) ?? 0
        const d0 = Math.hypot(v.x - a.x, v.z - a.z)
        if (d0 < ANIMAL_STARTLE_R && sp > ANIMAL_STARTLE_SPD) {
          const dx = a.x - v.x, dz = a.z - v.z
          const l = Math.max(0.2, Math.hypot(dx, dz))
          a.target = { x: a.x + (dx / l) * 5, z: a.z + (dz / l) * 5 }
          a.state = 'flee'
          a.stateT = 1.4
          a.sit = false
          break
        }
      }
    }

    let speed = 0
    switch (a.state) {
      case 'wander': {
        speed = a.speed
        if (Math.hypot(a.target.x - a.x, a.target.z - a.z) < 0.5) {
          a.state = 'idle'
          a.stateT = 2.5 + Math.random() * 4.5
          a.sit = a.kind === 'cow' ? false : Math.random() < (a.kind === 'cat' ? 0.45 : 0.25)
        }
        break
      }
      case 'idle': {
        a.stateT -= dt
        if (a.stateT <= 0) {
          const ang = Math.random() * Math.PI * 2
          const rr = a.wanderR * (0.35 + Math.random() * 0.65)
          a.target = { x: a.home.x + Math.cos(ang) * rr, z: a.home.z + Math.sin(ang) * rr }
          a.state = 'wander'
          a.sit = false
        }
        break
      }
      case 'goEat': {
        if (!a.crumb) { a.state = 'wander'; break }
        speed = a.speed * 1.5
        const d = Math.hypot(a.crumb.x - a.x, a.crumb.z - a.z)
        if (d < 0.55) {
          a.state = 'eat'
          a.stateT = ANIMAL_EAT_SEC
          a.eatT = 0
        }
        break
      }
      case 'eat': {
        a.stateT -= dt
        if (a.stateT <= 0) {
          const pid = a.followId
          a.crumb = null
          a.followUntil = now + PET_FOLLOW_SEC * 1000
          a.state = 'follow'
          if (pid) {
            out.push({ kind: 'fed', playerId: pid, animalId: a.id, label: a.label, animal: a.kind, extended: a.wasPet })
          } else {
            // crumb existed without an owner (shouldn't happen) — just graze on
            a.state = 'wander'
            a.target = { ...a.home }
          }
        }
        break
      }
      case 'follow': {
        if (!feeder) break // handled above
        const d = Math.hypot(feeder.x - a.x, feeder.z - a.z)
        if (d > 50) {
          // leash fail-safe — never lose the pet to a teleport/rally
          a.x = feeder.x + 1.5
          a.z = feeder.z + 1.5
          break
        }
        if (d > 2.4) { speed = a.followSpeed * Math.min(1, (d - 2) / 4 + 0.55) }
        break
      }
      case 'flee': {
        a.stateT -= dt
        speed = a.speed * 2.4
        if (a.stateT <= 0 || Math.hypot(a.target.x - a.x, a.target.z - a.z) < 0.4) {
          a.state = 'wander'
          a.target = { x: a.home.x + (Math.random() - 0.5) * a.wanderR, z: a.home.z + (Math.random() - 0.5) * a.wanderR }
        }
        break
      }
    }
    void pd

    // ---- move + face ----
    let moving = false
    if (speed > 0 && a.state !== 'eat') {
      const tx = a.state === 'follow' && feeder ? feeder.x : a.target.x
      const tz = a.state === 'follow' && feeder ? feeder.z : a.target.z
      const dx = tx - a.x, dz = tz - a.z
      const d = Math.hypot(dx, dz)
      if (d > 0.15) {
        const step = Math.min(d, speed * dt)
        a.x += (dx / d) * step
        a.z += (dz / d) * step
        moving = true
        const targetRy = Math.atan2(dx, dz)
        let dr = targetRy - a.ry
        while (dr > Math.PI) dr -= Math.PI * 2
        while (dr < -Math.PI) dr += Math.PI * 2
        a.ry += dr * Math.min(1, dt * 6)
      }
    }
    ;(a as AnimalSimState & { moving?: boolean }).moving = moving
  }
}
