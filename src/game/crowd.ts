// VoteChor impostor crowd — cheap low-poly people for rig-less remote protesters.
// Seasons simulate ~100 bots but the rig budget only dresses the 24 nearest ones;
// CrowdLod renders everyone else as flat-shaded, archetype-tinted silhouettes
// (3 draw calls total) with per-instance walk bob, refreshed from game.ts at ~10Hz.
'use client'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { archetypeById } from './shared/constants'
import type { AnimName } from './shared/types'

/** One impostor person. Entries with hasRig=true are skipped — a real CharacterRig already renders them. */
export interface CrowdEntry {
  id: string
  x: number
  y: number
  z: number
  ry: number
  anim: AnimName
  archetype: string
  hasRig: boolean
}

const CULL_DIST_SQ = 450 * 450 // impostors hide beyond ~450m from the camera focus

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

/**
 * Vertical metrics mirror CharacterRig (scale 1) so impostors and full rigs read as
 * the same people standing on the same street: rig legs span 0.335..0.9, torso 0.98..1.5,
 * head center ~1.7 (total visual height ≈ 1.85).
 */
function buildLegs(): THREE.BufferGeometry {
  const parts = [
    boxAt(0.14, 0.5, 0.15, 0.1, 0.65, 0),
    boxAt(0.14, 0.5, 0.15, -0.1, 0.65, 0),
    boxAt(0.15, 0.09, 0.26, 0.1, 0.38, 0.04),
    boxAt(0.15, 0.09, 0.26, -0.1, 0.38, 0.04),
  ]
  return mergeGeometries(parts) ?? parts[0]
}

function buildTorso(): THREE.BufferGeometry {
  const parts = [
    boxAt(0.42, 0.6, 0.24, 0, 1.24, 0), // torso + hip band
    boxAt(0.11, 0.46, 0.11, 0.265, 1.24, 0), // arms
    boxAt(0.11, 0.46, 0.11, -0.265, 1.24, 0),
  ]
  return mergeGeometries(parts) ?? parts[0]
}

function buildHead(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.165, 8, 6)
  g.translate(0, 1.7, 0)
  return g
}

/** Cheap stable per-id phase seed so the crowd never bobs in lockstep. */
function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

export class CrowdLod {
  private group = new THREE.Group()
  // meshes[0] torso+arms (shirt tint) · [1] legs+feet (pants tint) · [2] head (skin tint)
  private meshes: THREE.InstancedMesh[] = []
  private material: THREE.MeshStandardMaterial
  private slotOf = new Map<string, number>()
  private freeSlots: number[] = []
  private slotSeed: Float32Array
  private dummy = new THREE.Object3D()
  private tmpColor = new THREE.Color()
  private focusX = 0
  private focusZ = 0
  private disposed = false

  constructor(scene: THREE.Scene, capacity = 112) {
    this.slotSeed = new Float32Array(capacity)
    // one shared flat-shaded material — per-instance color comes from instanceColor
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.02, flatShading: true })
    for (const geo of [buildTorso(), buildLegs(), buildHead()]) {
      const mesh = new THREE.InstancedMesh(geo, this.material, capacity)
      mesh.frustumCulled = false // instances wander; per-frame bounds recompute is not worth it
      mesh.castShadow = false // near rigs already cast shadows
      mesh.receiveShadow = false
      // allocate the instance-color buffer up front so every mesh shares one shader program
      for (let i = 0; i < capacity; i++) mesh.setColorAt(i, this.tmpColor.set(0xffffff))
      this.meshes.push(mesh)
      this.group.add(mesh)
    }
    // every slot starts hidden (degenerate zero-scale matrix offscreen)
    this.dummy.position.set(0, -100, 0)
    this.dummy.scale.setScalar(0)
    this.dummy.updateMatrix()
    for (let i = 0; i < capacity; i++) {
      for (const m of this.meshes) m.setMatrixAt(i, this.dummy.matrix)
      this.freeSlots.push(capacity - 1 - i)
    }
    scene.add(this.group)
  }

  /** Point of reference for the ~450m impostor cull (call with the player/camera focus). */
  setFocus(x: number, z: number) {
    this.focusX = x
    this.focusZ = z
  }

  /**
   * Reconcile slots with the given remote-protester snapshot. Called at ~10Hz —
   * walk bob/sway are baked into the matrices here, not per frame.
   * Detained/dazed entries simply stand still (no bob) — cheap and never broken-looking.
   */
  sync(entries: CrowdEntry[], nowMs: number) {
    if (this.disposed) return
    const seen = new Set<string>()
    let dirty = false
    for (const e of entries) {
      if (e.hasRig || seen.has(e.id)) continue // full rigs render themselves
      seen.add(e.id)
      const dx = e.x - this.focusX
      const dz = e.z - this.focusZ
      if (dx * dx + dz * dz > CULL_DIST_SQ) continue // beyond impostor range
      let slot = this.slotOf.get(e.id)
      if (slot === undefined) {
        slot = this.freeSlots.pop()
        if (slot === undefined) continue // impostor budget full — stay invisible
        this.slotOf.set(e.id, slot)
        this.slotSeed[slot] = (hashId(e.id) % 6283) / 1000
        this.applyColors(slot, e.archetype)
      }
      this.writeSlot(slot, e, nowMs)
      dirty = true
    }
    // free slots whose protester left, got a rig, or walked out of range
    for (const [id, slot] of this.slotOf) {
      if (!seen.has(id)) {
        this.hideSlot(slot)
        this.slotOf.delete(id)
        this.freeSlots.push(slot)
        dirty = true
      }
    }
    if (dirty) for (const m of this.meshes) m.instanceMatrix.needsUpdate = true
  }

  setVisible(v: boolean) {
    if (!this.disposed) this.group.visible = v
  }

  /** How many impostors are currently standing in the world (for the perf HUD). */
  get visibleCount() {
    return this.disposed ? 0 : this.slotOf.size
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.slotOf.clear()
    this.freeSlots.length = 0
    for (const m of this.meshes) {
      m.dispose()
      m.geometry.dispose()
    }
    this.meshes.length = 0
    this.material.dispose()
    this.group.removeFromParent()
  }

  private applyColors(slot: number, archetype: string) {
    const c = archetypeById(archetype).colors
    this.meshes[0].setColorAt(slot, this.tmpColor.set(c.shirt))
    this.meshes[1].setColorAt(slot, this.tmpColor.set(c.pants))
    this.meshes[2].setColorAt(slot, this.tmpColor.set(c.skin))
    for (const m of this.meshes) if (m.instanceColor) m.instanceColor.needsUpdate = true
  }

  private writeSlot(slot: number, e: CrowdEntry, nowMs: number) {
    const seed = this.slotSeed[slot]
    let bob = 0
    let sway = 0
    if (e.anim === 'run' || e.anim === 'walk') {
      // matches CharacterRig cadence: phase speed 11 (run) / 7.2 (walk), bob 0.06 / 0.03
      const phase = seed + (nowMs / 1000) * (e.anim === 'run' ? 11 : 7.2)
      bob = Math.abs(Math.sin(phase)) * (e.anim === 'run' ? 0.06 : 0.03)
      sway = Math.sin(phase * 0.5) * 0.035 // slight lateral drift along the local right vector
    } else {
      bob = Math.sin(seed + (nowMs / 1000) * 1.6) * 0.012 // idle breathing, matches rig idle bob
    }
    const rx = Math.cos(e.ry)
    const rz = -Math.sin(e.ry)
    this.dummy.position.set(e.x + rx * sway, e.y + bob, e.z + rz * sway)
    this.dummy.rotation.set(0, e.ry, 0)
    this.dummy.scale.setScalar(archetypeById(e.archetype).stats.scale)
    this.dummy.updateMatrix()
    for (const m of this.meshes) m.setMatrixAt(slot, this.dummy.matrix)
  }

  private hideSlot(slot: number) {
    this.dummy.position.set(0, -100, 0)
    this.dummy.rotation.set(0, 0, 0)
    this.dummy.scale.setScalar(0)
    this.dummy.updateMatrix()
    for (const m of this.meshes) m.setMatrixAt(slot, this.dummy.matrix)
  }
}
