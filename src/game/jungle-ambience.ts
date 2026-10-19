// VoteChor v68 — Vanodyan Deep ambience: the deeper the player walks into the
// wild south (or the jungle rings), the louder and creepier the forest gets.
//
// Two layers, both fully synthesized (see audio.ts):
//  1. a continuous cicada bed (AudioManager.setJungle) + a two-band wind/canopy
//     rustle bed (AudioManager.setJungleWind, v80) whose levels track the
//     player's "wildness" 0..1;
//  2. one-shot spatial voices — canopy birds and cicada bursts everywhere in
//     the jungle, owl hoots and distant big-cat GROWLS reserved for the deep —
//     played through the existing playAt pipeline at randomized offsets around
//     the listener so the player never sees the source.
//
// Client-local like the animals: no server coupling, no physics — just a
// per-frame update(dt, worldTime, playerPos, listenerYaw).
import { AudioManager } from './audio'
import { GRAVEYARD } from './shared/constants'

export type JungleVoice = 'birdJungle' | 'insect' | 'owlHoot' | 'growl' | 'crowCaw' | 'wolfHowl'

/** Wildness 0..1 at a position — 0 = city, 1 = the deepest wild south.
 *  South deep jungle ramps from the arena gate (−560) to full depth (−660);
 *  the side jungle rings ramp with |x| beyond 150; the north band stays mild. */
export function wildnessAt(x: number, z: number): number {
  let w = 0
  if (z < -560) w = Math.min(1, (-z - 560) / 100) // Vanodyan Deep: full 1 by z −660
  const ring = Math.max(0, (Math.abs(x) - 150) / 46) * (z < -60 ? 1 : 0)
  w = Math.max(w, Math.min(1, ring) * 0.8)
  if (z > 14) w = Math.max(w, 0.35) // north jungle band — birds, never growls
  return w
}

const VOICE_RANGE = 60

export class JungleAmbience {
  private voiceT = 6 // next one-shot voice countdown (s of worldTime)
  private dreadT = 26 // next deep-jungle dread growl countdown
  private lastLevel = -1

  /** Per-frame tick. Returns the current wildness (for QA probes). */
  update(dt: number, worldTime: number, px: number, pz: number, yaw: number): number {
    const w = wildnessAt(px, pz)

    // continuous cicada bed + wind/canopy bed — only push on meaningful changes
    // (audio targets smooth)
    const level = Math.round(w * 20) / 20
    if (level !== this.lastLevel) {
      AudioManager.setJungle(level)
      AudioManager.setJungleWind(level)
      this.lastLevel = level
    }
    if (w < 0.05) {
      this.voiceT = Math.max(this.voiceT, 4) // back in the city — reset the clock
      this.dreadT = 26
      return w
    }

    // one-shot jungle voices — cadence tightens with depth (7.5s at the fringe → 3.5s deep)
    this.voiceT -= dt
    if (this.voiceT <= 0) {
      this.voiceT = (3.5 + Math.random() * 4.5) / (0.45 + w * 0.75)
      // v69 — weight: crows haunt the Kabristan, birds + insects everywhere,
      // owls from half-depth, wolves at the deep fringe, growls ONLY deep
      const graveD = Math.hypot(px - GRAVEYARD.x, pz - GRAVEYARD.z)
      const roll = Math.random()
      let voice: JungleVoice
      if (graveD < GRAVEYARD.r + 45 && roll < 0.42) voice = 'crowCaw'
      else if (w > 0.55 && roll < 0.16 + (w - 0.55) * 0.5) voice = 'growl'
      else if (w > 0.45 && roll < 0.5) voice = 'owlHoot'
      else if (w > 0.45 && roll < 0.56) voice = 'wolfHowl'
      else if (roll < 0.72) voice = 'birdJungle'
      else voice = 'insect'
      const ang = Math.random() * Math.PI * 2
      const dist = 9 + Math.random() * 17
      const base = 0.5 + w * 0.5
      AudioManager.playAt(voice, px + Math.cos(ang) * dist, pz + Math.sin(ang) * dist, px, pz, yaw, VOICE_RANGE, base)
    }

    // dread growl — deep jungle only: something big, close-ish, unhurried
    if (w > 0.6) {
      this.dreadT -= dt
      if (this.dreadT <= 0) {
        this.dreadT = 24 + Math.random() * 22
        const ang = Math.random() * Math.PI * 2
        const dist = 14 + Math.random() * 16
        AudioManager.playAt('growl', px + Math.cos(ang) * dist, pz + Math.sin(ang) * dist, px, pz, yaw, VOICE_RANGE, 1.15)
      }
    } else {
      this.dreadT = Math.min(this.dreadT + dt, 26)
    }
    return w
  }

  /** Match teardown / quit-to-menu: retire the beds immediately. */
  reset() {
    this.voiceT = 6
    this.dreadT = 26
    this.lastLevel = -1
    AudioManager.setJungle(0)
    AudioManager.setJungleWind(0)
  }
}
