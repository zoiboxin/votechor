// VoteChor items system — world pickups, inventory sync, thrown projectiles.
import * as THREE from 'three'
import { ITEM_CONFIG } from './shared/constants'
import type { ItemType, ItemSpawn, ItemNetState } from './shared/types'
import type { PhysicsWorld } from './physics'

export interface ItemVisual {
  def: ItemSpawn
  group: THREE.Group
  taken: boolean
  takenBy?: string
  respawnAt: number // world time when it respawns (0 = never for tokens)
  bobPhase: number
}

export interface Projectile {
  id: string
  type: ItemType
  mesh: THREE.Group
  vel: THREE.Vector3
  life: number
  owner: string
  local: boolean // simulate locally
  onImpact?: (x: number, y: number, z: number) => void
}

function bottleMesh(): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 8), new THREE.MeshStandardMaterial({ color: '#8ecae6', transparent: true, opacity: 0.75, roughness: 0.2 }))
  body.position.y = 0.15
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 0.1, 8), new THREE.MeshStandardMaterial({ color: '#8ecae6', transparent: true, opacity: 0.75 }))
  neck.position.y = 0.35
  g.add(body, neck)
  return g
}
function chaiMesh(): THREE.Group {
  const g = new THREE.Group()
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.06, 0.14, 8), new THREE.MeshStandardMaterial({ color: '#e8e2d4' }))
  cup.position.y = 0.07
  const tea = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 8), new THREE.MeshStandardMaterial({ color: '#b54a32' }))
  tea.position.y = 0.14
  g.add(cup, tea)
  return g
}
function firstaidMesh(): THREE.Group {
  const g = new THREE.Group()
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.2), new THREE.MeshStandardMaterial({ color: '#f5f0e6' }))
  const cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.01), new THREE.MeshStandardMaterial({ color: '#c0392b' }))
  cross1.position.z = 0.105
  const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.01), new THREE.MeshStandardMaterial({ color: '#c0392b' }))
  cross2.position.z = 0.105
  g.add(box, cross1, cross2)
  return g
}
function snackMesh(): THREE.Group {
  const g = new THREE.Group()
  const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.12), new THREE.MeshStandardMaterial({ color: '#f2c14e' }))
  g.add(wrap)
  return g
}
function tokenMesh(): THREE.Group {
  const g = new THREE.Group()
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.2), new THREE.MeshStandardMaterial({ color: '#2e6e4e', emissive: '#1a5c38', emissiveIntensity: 0.6 }))
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.03), new THREE.MeshStandardMaterial({ color: '#1c1a17' }))
  slot.position.set(0, 0.1, 0.1)
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: '#7de3a8', transparent: true, opacity: 0.25 }))
  glow.position.y = 0.15
  g.add(box, slot, glow)
  return g
}
function signMesh(): THREE.Group {
  const g = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 5), new THREE.MeshStandardMaterial({ color: '#8a6b4a' }))
  pole.position.y = 0.3
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.02), new THREE.MeshStandardMaterial({ color: '#f5efdc' }))
  board.position.y = 0.6
  board.rotation.z = 0.08
  g.add(pole, board)
  return g
}
function foamMesh(): THREE.Group {
  const g = new THREE.Group()
  const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.4, 6), new THREE.MeshStandardMaterial({ color: '#f2c14e' }))
  finger.position.y = 0.2
  g.add(finger)
  return g
}
function jokeMesh(): THREE.Group {
  const g = new THREE.Group()
  const samosa = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 4), new THREE.MeshStandardMaterial({ color: '#d9a254', flatShading: true }))
  samosa.position.y = 0.11
  g.add(samosa)
  return g
}

const MESH_BUILDERS: Record<ItemType, () => THREE.Group> = {
  bottle: bottleMesh, chai: chaiMesh, firstaid: firstaidMesh, snack: snackMesh,
  token: tokenMesh, sign: signMesh, foam: foamMesh, joke: jokeMesh,
}

export class ItemSystem {
  group = new THREE.Group()
  items: ItemVisual[] = []
  projectiles: Projectile[] = []
  private byId = new Map<string, ItemVisual>()
  onLocalPickup: ((item: ItemVisual) => void) | null = null

  constructor(spawns: ItemSpawn[], private physics: PhysicsWorld) {
    for (const def of spawns) {
      const g = MESH_BUILDERS[def.type]()
      g.position.set(def.x, def.y, def.z)
      g.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = false })
      this.group.add(g)
      const iv: ItemVisual = { def, group: g, taken: false, respawnAt: 0, bobPhase: Math.random() * 7 }
      this.items.push(iv)
      this.byId.set(def.id, iv)
    }
  }

  nearestAvailable(px: number, pz: number, py: number, maxDist = 1.9): ItemVisual | null {
    let best: ItemVisual | null = null
    let bd = maxDist
    for (const it of this.items) {
      if (it.taken) continue
      const d = Math.hypot(it.def.x - px, it.def.z - pz)
      if (d < bd && Math.abs(it.def.y - py) < 2.5) { bd = d; best = it }
    }
    return best
  }

  localPickup(id: string, worldTime: number): ItemVisual | null {
    const it = this.byId.get(id)
    if (!it || it.taken) return null
    it.taken = true
    it.group.visible = false
    // respawn === 0 means never respawn (confiscated loot piles); tokens likewise
    it.respawnAt = it.def.type === 'token' || it.def.respawn === 0 ? 0 : worldTime + (it.def.respawn ?? 30)
    this.onLocalPickup?.(it)
    return it
  }

  applyServerState(states: ItemNetState[], worldTime: number) {
    for (const s of states) {
      const it = this.byId.get(s.id)
      if (!it) continue
      const was = it.taken
      it.taken = s.taken
      it.takenBy = s.takenBy
      it.group.visible = !s.taken
      if (s.taken && !was) it.respawnAt = s.respawnAt ?? (it.def.type === 'token' ? 0 : worldTime + 30)
      if (!s.taken && was) it.respawnAt = 0
    }
  }

  update(dt: number, t: number, worldTime: number) {
    for (const it of this.items) {
      if (it.taken) {
        if (it.respawnAt > 0 && worldTime >= it.respawnAt) {
          it.taken = false
          it.group.visible = true
          it.respawnAt = 0
        }
        continue
      }
      it.group.position.y = it.def.y + Math.sin(t * 2.2 + it.bobPhase) * 0.09
      it.group.rotation.y = t * (it.def.type === 'token' ? 2.4 : 0.8) + it.bobPhase
    }
    // projectiles
    for (const p of this.projectiles) {
      p.life -= dt
      p.vel.y -= 14 * dt
      p.mesh.position.addScaledVector(p.vel, dt)
      p.mesh.rotation.x += dt * 9
      p.mesh.rotation.z += dt * 7
      const ground = this.physics.groundHeight(p.mesh.position.x, p.mesh.position.z, p.mesh.position.y)
      if (p.mesh.position.y <= ground + 0.1) {
        p.life = 0
        p.onImpact?.(p.mesh.position.x, ground, p.mesh.position.z)
      }
    }
    // remove dead
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i].life <= 0) {
        this.group.remove(this.projectiles[i].mesh)
        this.projectiles.splice(i, 1)
      }
    }
  }

  throwItem(type: ItemType, from: THREE.Vector3, dir: { x: number; z: number }, power: number, owner: string, local: boolean, onImpact: (x: number, y: number, z: number) => void): Projectile {
    const mesh = MESH_BUILDERS[type]()
    mesh.position.copy(from)
    mesh.position.y += 1.4
    this.group.add(mesh)
    const p: Projectile = {
      id: `pr_${Date.now().toString(36)}_${Math.floor(Math.random() * 9999)}`,
      type, mesh, owner, local,
      vel: new THREE.Vector3(dir.x * power, 5.2, dir.z * power),
      life: 4,
      onImpact,
    }
    this.projectiles.push(p)
    return p
  }

  spawnRemoteProjectile(id: string, type: string, x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    const t = (type as ItemType) in MESH_BUILDERS ? (type as ItemType) : 'bottle'
    const mesh = MESH_BUILDERS[t]()
    mesh.position.set(x, y, z)
    this.group.add(mesh)
    this.projectiles.push({ id, type: t, mesh, vel: new THREE.Vector3(vx, vy, vz), life: 4, owner: 'remote', local: false, onImpact: () => {} })
  }

  /** Spawn a dropped/extra item at runtime (e.g. player drops inventory) */
  spawnDropped(def: ItemSpawn): ItemVisual {
    const g = MESH_BUILDERS[def.type]()
    g.position.set(def.x, def.y, def.z)
    this.group.add(g)
    const iv: ItemVisual = { def, group: g, taken: false, respawnAt: 0, bobPhase: Math.random() * 7 }
    this.items.push(iv)
    this.byId.set(def.id, iv)
    return iv
  }

  /** Despawn a runtime-dropped item (picked up by anyone, expired, or match reset). */
  removeDropped(id: string): boolean {
    const it = this.byId.get(id)
    if (!it) return false
    this.group.remove(it.group)
    this.items = this.items.filter(i => i !== it)
    this.byId.delete(id)
    return true
  }

  /** Item info for minimap (tokens only). v50 — reuses a persistent row buffer:
   *  drawHudMinimap consumes this every frame, so per-frame array+object literals
   *  were constant GC churn. Callers consume synchronously — safe to reuse. */
  private tokenCache: { id: string; x: number; z: number; taken: boolean }[] = []
  tokenData() {
    const arr = this.tokenCache
    let n = 0
    for (const i of this.items) {
      if (i.def.type !== 'token') continue
      let o = arr[n]
      if (!o) { o = { id: '', x: 0, z: 0, taken: false }; arr[n] = o }
      o.id = i.def.id
      o.x = i.def.x
      o.z = i.def.z
      o.taken = i.taken
      n++
    }
    arr.length = n
    return arr
  }
}
