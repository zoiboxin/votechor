// VoteChor distance-based culling for static world geometry.
//
// Measured (offline season world, spawn): 2,975 individual meshes in the world
// renderer group; 61% sit beyond 220 m where the fog wall (~210 m) already makes
// them invisible — but they still cost a frustum test, a draw call, and vertex
// processing every frame. This is the dominant per-frame cost on weak GPUs.
//
// Strategy: a low-frequency sweep (2 Hz) toggles `visible` on static meshes
// farther than the cull radius (default fog far minus margin). Per-mesh world
// centers + bounding-sphere radii are cached once — the sweep itself is two
// float compares per mesh. Instanced meshes / Points / Sprites / lights are
// skipped (few of them, instance transforms are baked, and lamp-glow sprites
// SHOULD stay visible down a foggy night road).
//
// Safety: objects with huge bounding spheres (boundary walls, ground) keep
// their visibility because `dist - bsRadius > radius` stays false for them.
// Nothing but `visible` is touched — no scene-graph churn, no material edits.
import * as THREE from 'three'

interface CullEntry {
  obj: THREE.Mesh
  x: number
  z: number
  r: number // bounding-sphere radius in world units
}

export class WorldDistanceCuller {
  private entries: CullEntry[] = []
  private built = false
  /** Sweep cadence in Hz — 2 Hz is imperceptible for static geometry. */
  private acc = 0
  private anomalyStreak = 0
  enabled = true
  lastCulled = 0
  /** Fired AFTER the fail-safe restored the world and disabled this culler.
   *  A healthy sweep always leaves MANY meshes visible within the cull radius —
   *  the city is dense everywhere. If consecutive sweeps leave almost nothing
   *  visible near the focus, this culler IS the "blue world" on this device,
   *  and it must never win: everything is shown again and culling switches off
   *  (the pre-culler rendering path — the build the user confirmed works).
   *  Slightly lower FPS beats an invisible world, every time. */
  onAnomaly: ((visibleNear: number) => void) | null = null

  constructor(
    private root: THREE.Object3D,
    /** Cull meshes whose nearest point is beyond this (world units). Default keeps fog-range silhouettes. */
    public radius = 195,
  ) {}

  /** Build the entry cache once (call after the world group is fully populated). */
  private build() {
    const v = new THREE.Vector3()
    const stack: THREE.Object3D[] = [this.root]
    while (stack.length) {
      const c = stack.pop()
      if (!c) continue
      for (const ch of c.children) stack.push(ch)
      const mesh = c as THREE.Mesh
      if (!mesh.isMesh) continue
      // InstancedMesh IS a Mesh subclass — skip it (instance transforms are baked,
      // and there are only ~13 of them). Sprites/Points fail isMesh and are skipped.
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) continue
      const bs = mesh.geometry.boundingSphere ?? mesh.geometry.computeBoundingSphere()
      if (!bs || !isFinite(bs.radius)) continue
      mesh.updateWorldMatrix(true, false)
      v.setFromMatrixPosition(mesh.matrixWorld)
      if (!isFinite(v.x) || !isFinite(v.z)) continue
      this.entries.push({ obj: mesh, x: v.x, z: v.z, r: bs.radius })
      // any mesh that moves at runtime must not be frozen invisible by a stale cache
      if (mesh.matrixAutoUpdate) mesh.matrixAutoUpdate = true
    }
    this.built = true
  }

  /** Call every frame; actually sweeps at ~2Hz. Returns how many meshes are currently hidden. */
  update(dt: number, px: number, pz: number): number {
    if (!this.enabled) return 0
    // NaN shield — a non-finite focus makes every distance NaN and every `vis` false,
    // which would hide the ENTIRE world (player sees only sky). Hold the last state.
    if (!Number.isFinite(px) || !Number.isFinite(pz)) return this.lastCulled
    if (!this.built) this.build()
    this.acc += dt
    if (this.acc < 0.5) return this.lastCulled
    this.acc = 0
    let hidden = 0
    const limit = this.radius
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]
      const d = Math.hypot(e.x - px, e.z - pz) - e.r
      const vis = d <= limit
      if (e.obj.visible !== vis) e.obj.visible = vis
      if (!vis) hidden++
    }
    this.lastCulled = hidden

    // ---- fail-safe: an empty world around the player is NEVER acceptable ----
    // Healthy reading at spawn ≈ 800+ meshes visible within the radius; even the
    // far map corners keep hundreds (the city is dense everywhere). Two
    // consecutive sweeps below 15 means this culler is mass-hiding on this
    // device (whatever the exotic upstream cause) → show everything, disable
    // culling, tell the host. Falls back to the exact rendering behavior of the
    // build the user verified working (no culling), just with more FPS cost.
    const visibleNear = this.entries.length - hidden
    if (visibleNear < 15) {
      this.anomalyStreak++
      if (this.anomalyStreak >= 2) {
        this.anomalyStreak = 0
        this.showAll()
        this.enabled = false
        this.onAnomaly?.(visibleNear)
      }
    } else {
      this.anomalyStreak = 0
    }
    return hidden
  }

  /** Force everything visible (quit-to-menu teardown safety / photo mode). */
  showAll() {
    for (const e of this.entries) e.obj.visible = true
    this.lastCulled = 0
  }

  dispose() {
    this.entries = []
    this.built = false
    this.anomalyStreak = 0
  }
}
