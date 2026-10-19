// VoteChor ZombieSystem (v64 rebuild of the lost v58/v68 deep + v69/v70 ring
// layers) — the Vanodyan wild is HUNTED: zombies wander the jungle ring, detect
// the player at 14 m, chase with moans + a scare stinger, and strike for 16.
// They NEVER enter the city (sanctuary clamp with boundary slide) and they ride
// the mountain heightfield like the player does. A zombie kill triggers the
// wildDeath flow (client emits, server validates + respawns elsewhere).
import * as THREE from 'three'
import { mountainHeightAt } from './mountain-field'
import type { SfxName } from './audio'

/** Hunt spots — all OUTSIDE the city rect, inside the playable ring (r ≤ 430). */
const ZOMBIE_SPOTS: Array<[number, number]> = [
  [-180, -140], [185, -150], [-220, -300], [230, -320],
  [-150, -450], [160, -470], [-260, -520], [255, -560],
  [-90, -610], [90, -640], [-320, -380], [320, -400],
  [150, -240], [-150, -265], [350, -250], [-350, -240],
  [200, -680], [-200, -700],
]

/** City sanctuary — zombies clamp out of here (matches the city walls + margin). */
function inCitySanctuary(x: number, z: number): boolean {
  return Math.abs(x) < 126 && z < 16 && z > -578
}

interface Zombie {
  grp: THREE.Group
  x: number; z: number
  hx: number; hz: number // home spot
  tx: number; tz: number // wander target
  chasing: boolean
  retarget: number
  moanT: number
  strikeT: number
  phase: number
}

export interface ZombieHooks {
  onStrike?: (dmg: number) => void
  onDetect?: () => void
  sfx?: (name: SfxName, sx: number, sz: number) => void
  listener?: () => { x: number; z: number; yaw: number }
}

export class ZombieSystem {
  group = new THREE.Group()
  list: Zombie[] = []
  private hooks: ZombieHooks
  private howlT = 8

  constructor(hooks: ZombieHooks = {}) {
    this.hooks = hooks
    const skin = new THREE.MeshStandardMaterial({ color: '#5a7048', roughness: 0.9, flatShading: true })
    const dark = new THREE.MeshStandardMaterial({ color: '#3a4430', roughness: 0.95, flatShading: true })
    const eye = new THREE.MeshBasicMaterial({ color: '#ffd24a' })
    for (const [sx, sz] of ZOMBIE_SPOTS) {
      for (let k = 0; k < 2; k++) {
        const g = new THREE.Group()
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.72, 3, 8), k ? dark : skin)
        body.position.y = 0.92
        body.castShadow = true
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 8, 7), k ? dark : skin)
        head.position.y = 1.6
        head.castShadow = true
        const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), eye)
        e1.position.set(-0.09, 1.64, 0.19)
        const e2 = e1.clone(); e2.position.x = 0.09
        const armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.62, 0.13), skin)
        armL.position.set(-0.36, 1.18, 0.22); armL.rotation.x = -1.25
        const armR = armL.clone(); armR.position.x = 0.36
        g.add(body, head, e1, e2, armL, armR)
        const x = sx + (k ? 5 : -5) + Math.random() * 6 - 3
        const z = sz + Math.random() * 6 - 3
        g.position.set(x, mountainHeightAt(x, z), z)
        this.group.add(g)
        this.list.push({
          grp: g, x, z, hx: sx, hz: sz, tx: x, tz: z,
          chasing: false, retarget: 1 + Math.random() * 4,
          moanT: 2 + Math.random() * 8, strikeT: 0, phase: Math.random() * 6.28,
        })
      }
    }
  }

  /**
   * Tick the hunt. `player` is the local protester (or null in menus).
   * dt is clamped by the caller like every other system.
   */
  update(dt: number, player: { x: number; y: number; z: number } | null) {
    const lis = this.hooks.listener?.()
    for (const z of this.list) {
      z.phase += dt
      let vx = 0, vz = 0
      const dx = player ? player.x - z.x : 999
      const dz = player ? player.z - z.z : 999
      const d = Math.hypot(dx, dz)
      const wasChasing = z.chasing
      z.chasing = !!player && d < 14 && d > 0.4 && !inCitySanctuary(player.x, player.z)
      if (z.chasing && !wasChasing) {
        this.hooks.onDetect?.()
        if (lis && Math.hypot(z.x - lis.x, z.z - lis.z) < 60) this.hooks.sfx?.('sting', z.x, z.z)
      }
      if (z.chasing && player) {
        vx = dx / d; vz = dz / d
        const sp = 3.55
        this.step(z, vx * sp * dt, vz * sp * dt)
        // strike
        z.strikeT -= dt
        if (d < 1.75 && z.strikeT <= 0) {
          z.strikeT = 1.1
          this.hooks.onStrike?.(16)
          if (lis) this.hooks.sfx?.('growl', z.x, z.z)
        }
      } else {
        // wander near home
        z.retarget -= dt
        if (z.retarget <= 0) {
          z.retarget = 3 + Math.random() * 5
          z.tx = z.hx + Math.random() * 16 - 8
          z.tz = z.hz + Math.random() * 16 - 8
        }
        const wx = z.tx - z.x, wz = z.tz - z.z
        const wd = Math.hypot(wx, wz)
        if (wd > 0.6) {
          vx = wx / wd; vz = wz / wd
          this.step(z, vx * 1.15 * dt, vz * 1.15 * dt)
        }
      }
      // ride the terrain + face movement
      z.grp.position.set(z.x, mountainHeightAt(z.x, z.z), z.z)
      if (vx || vz) {
        const targetRy = Math.atan2(vx, vz)
        let dr = targetRy - z.grp.rotation.y
        while (dr > Math.PI) dr -= Math.PI * 2
        while (dr < -Math.PI) dr += Math.PI * 2
        z.grp.rotation.y += dr * Math.min(1, dt * 6)
        // shambling bob
        z.grp.position.y += Math.abs(Math.sin(z.phase * 6)) * 0.06
      }
      // moans — spatial, heard through the jungle
      z.moanT -= dt
      if (z.moanT <= 0) {
        z.moanT = 4 + Math.random() * 9
        if (lis) {
          const md = Math.hypot(z.x - lis.x, z.z - lis.z)
          if (md < 38) this.hooks.sfx?.('growl', z.x, z.z)
        }
      }
    }
    // distant howls keep the deep wild scary (v69 ambience)
    this.howlT -= dt
    if (this.howlT <= 0) {
      this.howlT = 11 + Math.random() * 15
      if (lis && !inCitySanctuary(lis.x, lis.z)) {
        const spot = ZOMBIE_SPOTS[Math.floor(Math.random() * ZOMBIE_SPOTS.length)]
        this.hooks.sfx?.('howl', spot[0], spot[1])
      }
    }
  }

  /** Move with the city sanctuary clamp + boundary slide. */
  private step(z: Zombie, mx: number, mz: number) {
    const nx = z.x + mx, nz = z.z + mz
    if (!inCitySanctuary(nx, z.z)) z.x = nx
    if (!inCitySanctuary(z.x, nz)) z.z = nz
  }

  /** Count of zombies currently chasing (QA + HUD tension readout). */
  get chasingCount() { return this.list.reduce((n, z) => n + (z.chasing ? 1 : 0), 0) }

  /** Nearest chasing zombie distance (QA). */
  minDist(x: number, zQ: number): number {
    let m = Infinity
    for (const z of this.list) m = Math.min(m, Math.hypot(z.x - x, z.z - zQ))
    return m
  }

  dispose() {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
    })
    this.group.removeFromParent()
    this.list = []
  }
}
