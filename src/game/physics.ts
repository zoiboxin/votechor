// VoteChor physics — AABB collision world with step-up, ground detection.
// Simple, robust axis-separated resolution. No physics engine needed.
import type { AABB } from './shared/types'

export class PhysicsWorld {
  colliders: AABB[] = []
  private grid = new Map<string, AABB[]>()
  private cell = 12
  /** Moving colliders (vehicles) — NOT in the static grid; linear-scanned each move. */
  private dynamic: AABB[] = []
  /** v77 analytic terrain heightfield (mountains) — see mountain-field.ts. */
  private terrain: ((x: number, z: number) => number) | null = null

  /** Wire the mountain heightfield so groundHeight includes solid terrain. */
  setTerrain(fn: (x: number, z: number) => number) {
    this.terrain = fn
  }

  /** True surface height for spawn/teleport placement (mountain-aware). */
  spawnHeight(x: number, z: number): number {
    return this.terrain ? this.terrain(x, z) : 0
  }

  private terrainAt(x: number, z: number): number {
    return this.terrain ? this.terrain(x, z) : 0
  }

  setColliders(list: AABB[]) {
    this.colliders = list
    this.grid.clear()
    for (const c of list) {
      const x0 = Math.floor(c.minX / this.cell), x1 = Math.floor(c.maxX / this.cell)
      const z0 = Math.floor(c.minZ / this.cell), z1 = Math.floor(c.maxZ / this.cell)
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const key = `${x},${z}`
        const arr = this.grid.get(key)
        if (arr) arr.push(c)
        else this.grid.set(key, [c])
      }
    }
  }

  /** Replace the dynamic (moving) collider set — called at ~10Hz with vehicle AABBs. */
  setDynamic(list: AABB[]) {
    this.dynamic = list
  }

  nearby(x: number, z: number, pad = 1.5): AABB[] {
    const out: AABB[] = []
    const seen = new Set<AABB>()
    const x0 = Math.floor((x - pad) / this.cell), x1 = Math.floor((x + pad) / this.cell)
    const z0 = Math.floor((z - pad) / this.cell), z1 = Math.floor((z + pad) / this.cell)
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const arr = this.grid.get(`${cx},${cz}`)
      if (arr) for (const c of arr) if (!seen.has(c)) { seen.add(c); out.push(c) }
    }
    return out
  }

  /** Highest solid top under (x,z) at or below maxY. Returns 0 (street) if none.
   *  v88 — edge-support halo shrunk 0.42 → 0.14 m: the old halo (playerRadius)
   *  kept the player "standing" on air up to 0.42 m PAST a box edge (the
   *  floating-beside-the-box look) and could snap them up onto a low box top
   *  from beside it. 0.14 m keeps natural edge-standing (feet still half on the
   *  surface) without the invisible air-bridge. */
  private static readonly EDGE_SUPPORT = 0.14

  groundHeight(x: number, z: number, maxY: number): number {
    let h = 0
    // v77 terrain (mountains) — capped by maxY so nothing is teleported ONTO a
    // peak that looms above the query point
    if (this.terrain) {
      const t = this.terrain(x, z)
      if (t > h && t <= maxY + 0.02) h = t
    }
    const edge = PhysicsWorld.EDGE_SUPPORT
    for (const c of this.nearby(x, z, 0.45)) {
      if (x < c.minX - edge || x > c.maxX + edge || z < c.minZ - edge || z > c.maxZ + edge) continue
      if (c.maxY <= maxY + 0.02 && c.maxY > h) h = c.maxY
    }
    // dynamic colliders (vehicles) are standable too — small linear scan
    for (const c of this.dynamic) {
      if (x < c.minX - edge || x > c.maxX + edge || z < c.minZ - edge || z > c.maxZ + edge) continue
      if (c.maxY <= maxY + 0.02 && c.maxY > h) h = c.maxY
    }
    return h
  }

  /** Horizontal capsule (AABB approx) overlap test */
  private hits(x: number, y: number, z: number, r: number, h: number, c: AABB): boolean {
    return x + r > c.minX && x - r < c.maxX &&
      y + h > c.minY && y < c.maxY &&
      z + r > c.minZ && z - r < c.maxZ
  }

  /**
   * Move actor with axis-separated collision + step-up + sprint vault.
   * Returns collision flags. `vaulted` is set when a sprinting, grounded actor
   * mantled onto a low obstacle (top between stepHeight and 1.18m above the feet).
   *
   * v47 — the horizontal phases are SUBSTEPPED (≤0.25m per sub-step). Each
   * sub-step tests only its ENDPOINT, so a single fast step (sprint 9.2 m/s at the
   * 0.1s dt clamp = 0.92 m) used to skip straight over any collider thinner than
   * ~0.9 m — hitch frames literally walked the player through barriers, scooters
   * and stall edges. Substepping bounds every sweep to 0.25 m + 2r ≈ 0.95 m of
   * guaranteed detection while costing extra queries only on hitch frames.
   */
  moveActor(
    pos: { x: number; y: number; z: number },
    vel: { x: number; y: number; z: number },
    dt: number,
    r: number,
    h: number,
  ): { grounded: boolean; hitWall: boolean; groundY: number; landed: boolean; vaulted: boolean } {
    let hitWall = false
    let vaulted = false
    // v77 terrain rise gate — the heightfield is a WALL when the climb is too
    // steep for the movement mode: grounded frames may climb ≤0.9 m per step
    // (≈74° world slope), airborne frames ≤0.6 m. Jump arcs still mount ledges.
    const startGrounded = this.groundHeight(pos.x, pos.z, pos.y + 0.35) >= pos.y - 0.05
    const riseCap = startGrounded ? 0.9 : 0.6
    // --- horizontal X (substepped) ---
    const totalX = vel.x * dt
    const stepsX = Math.max(1, Math.ceil(Math.abs(totalX) / 0.25))
    const segX = totalX / stepsX
    for (let i = 0; i < stepsX; i++) {
      if (hitWall || vaulted) break
      const nx = pos.x + segX
      for (const c of this.nearby(nx, pos.z).concat(this.dynamic)) {
        if (c.walkable) continue // walkable platforms are ground, not walls
        if (this.hits(nx, pos.y, pos.z, r, h, c)) {
          // step-up?
          // v88 — the step target is AT LEAST this collider's top: with the shrunk
          // EDGE_SUPPORT halo the center can sit outside the footprint at first
          // contact, where groundHeight() no longer sees the box — max() keeps the
          // step-up honest (and stacked-tops still win via groundHeight).
          if (c.maxY - pos.y <= 0.62 && c.maxY - pos.y > -0.01) {
            const g = Math.max(this.groundHeight(nx, pos.z, c.maxY + 0.5), c.maxY)
            if (g <= c.maxY + 0.01) { pos.y = g; continue }
          }
          // sprint vault/mantle — extends the 0.62 step-up to 1.18m (walk speed untouched)
          if (this.tryVault(pos, vel, r, h, c, 'x')) { vaulted = true; break }
          hitWall = true
          pos.x = segX > 0 ? Math.min(pos.x, c.minX - r - 0.001) : Math.max(pos.x, c.maxX + r + 0.001)
          break
        }
      }
      if (!hitWall && !vaulted) {
        const gNew = this.terrainAt(nx, pos.z)
        if (gNew - pos.y > riseCap) { hitWall = true } // cliff band — blocked, never penetrated
        else pos.x = nx
      }
    }

    // --- horizontal Z (substepped) ---
    let hitWallZ = false
    const totalZ = vel.z * dt
    const stepsZ = Math.max(1, Math.ceil(Math.abs(totalZ) / 0.25))
    const segZ = totalZ / stepsZ
    for (let i = 0; i < stepsZ; i++) {
      if (hitWallZ || vaulted) break
      const nz = pos.z + segZ
      for (const c of this.nearby(pos.x, nz).concat(this.dynamic)) {
        if (c.walkable) continue
        if (this.hits(pos.x, pos.y, nz, r, h, c)) {
          if (c.maxY - pos.y <= 0.62 && c.maxY - pos.y > -0.01) {
            // v88 — see X-phase note: step target at least this collider's top
            const g = Math.max(this.groundHeight(pos.x, nz, c.maxY + 0.5), c.maxY)
            if (g <= c.maxY + 0.01) { pos.y = g; continue }
          }
          if (this.tryVault(pos, vel, r, h, c, 'z')) { vaulted = true; break }
          hitWallZ = true
          pos.z = segZ > 0 ? Math.min(pos.z, c.minZ - r - 0.001) : Math.max(pos.z, c.maxZ + r + 0.001)
          break
        }
      }
      if (!hitWallZ && !vaulted) {
        const gNew = this.terrainAt(pos.x, nz)
        if (gNew - pos.y > riseCap) { hitWallZ = true }
        else pos.z = nz
      }
    }
    if (hitWallZ) hitWall = true

    // --- vertical ---
    pos.y += vel.y * dt
    const groundY = this.groundHeight(pos.x, pos.z, pos.y + 0.7)
    let landed = false
    let grounded = false
    if (pos.y <= groundY + 0.001 && vel.y <= 0) {
      if (vel.y < -9) landed = true // hard landing
      pos.y = groundY
      vel.y = 0
      grounded = true
    } else {
      grounded = pos.y - groundY < 0.06
      // v77 downhill ground-snap — walking down MOUNTAIN slopes stays grounded
      // (≤0.85 m per frame); real cliffs still fall. Gated on terrain: the plain
      // AABB world keeps its exact pre-v77 behavior.
      if (this.terrain && startGrounded && vel.y <= 0 && pos.y - groundY <= 0.85) {
        pos.y = groundY
        vel.y = 0
        grounded = true
      }
    }
    return { grounded, hitWall, groundY, landed, vaulted }
  }

  /**
   * Sprint vault/mantle: the actor was grounded, is moving into a blocked collider
   * whose top sits 0.62–1.18m above the feet, and is sprinting (hSpeed > 6).
   * Places the actor on the top surface (respecting ground beyond) and keeps
   * forward momentum. Refuses when the landing spot has no headroom or a taller
   * box sits behind the wall.
   */
  private tryVault(
    pos: { x: number; y: number; z: number },
    vel: { x: number; y: number; z: number },
    r: number,
    h: number,
    c: AABB,
    axis: 'x' | 'z',
  ): boolean {
    const rise = c.maxY - pos.y
    if (!(rise > 0.62 && rise <= 1.18)) return false
    if (Math.hypot(vel.x, vel.z) <= 6) return false // walk speed keeps the plain step-up only
    // must be grounded (feet resting on a surface) — no air-mantles
    if (this.groundHeight(pos.x, pos.z, pos.y + 0.35) < pos.y - 0.05) return false
    const forward = axis === 'x' ? vel.x > 0 : vel.z > 0
    // landing spot just past the collider face
    const landX = axis === 'x' ? (forward ? c.maxX + r + 0.02 : c.minX - r - 0.02) : pos.x
    const landZ = axis === 'z' ? (forward ? c.maxZ + r + 0.02 : c.minZ - r - 0.02) : pos.z
    // headroom probe: no solid box may intersect the body standing on the top
    for (const o of this.nearby(landX, landZ, r + 0.4).concat(this.dynamic)) {
      if (o === c || o.walkable) continue
      if (this.hits(landX, c.maxY + 0.02, landZ, r, h, o)) return false
    }
    // the top must be standable — refuse walls with a taller box directly behind
    const top = this.groundHeight(landX, landZ, c.maxY + 0.5)
    if (top > c.maxY + 0.02) return false
    // mantle: place feet on the top surface, keep small forward velocity
    if (axis === 'x') pos.x = landX
    else pos.z = landZ
    pos.y = top
    vel.y = Math.max(vel.y, 0)
    return true
  }

  /** Line of sight between two points (for camera clip + detection preview) */
  raycastBlocked(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): boolean {
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1
    for (const c of this.colliders) {
      let tmin = 0, tmax = 1
      let hit = true
      const mins = [c.minX, c.minY, c.minZ]
      const maxs = [c.maxX, c.maxY, c.maxZ]
      const o = [x1, y1, z1]
      const d = [dx, dy, dz]
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < 1e-9) {
          if (o[i] < mins[i] || o[i] > maxs[i]) { hit = false; break }
        } else {
          let t1 = (mins[i] - o[i]) / d[i], t2 = (maxs[i] - o[i]) / d[i]
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t }
          tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2)
          if (tmin > tmax) { hit = false; break }
        }
      }
      if (hit) return true
    }
    return false
  }
}
