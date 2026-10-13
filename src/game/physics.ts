// VoteChor physics — AABB collision world with step-up, ground detection.
// Simple, robust axis-separated resolution. No physics engine needed.
import type { AABB } from './shared/types'

export class PhysicsWorld {
  colliders: AABB[] = []
  private grid = new Map<string, AABB[]>()
  private cell = 12

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

  /** Highest solid top under (x,z) at or below maxY. Returns 0 (street) if none. */
  groundHeight(x: number, z: number, maxY: number): number {
    let h = 0
    for (const c of this.nearby(x, z, 0.45)) {
      if (x < c.minX - 0.42 || x > c.maxX + 0.42 || z < c.minZ - 0.42 || z > c.maxZ + 0.42) continue
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
   * Move actor with axis-separated collision + step-up.
   * Returns collision flags.
   */
  moveActor(
    pos: { x: number; y: number; z: number },
    vel: { x: number; y: number; z: number },
    dt: number,
    r: number,
    h: number,
  ): { grounded: boolean; hitWall: boolean; groundY: number; landed: boolean } {
    let hitWall = false
    // --- horizontal X ---
    const nx = pos.x + vel.x * dt
    for (const c of this.nearby(nx, pos.z)) {
      if (c.walkable) continue // walkable platforms are ground, not walls
      if (this.hits(nx, pos.y, pos.z, r, h, c)) {
        // step-up?
        if (c.maxY - pos.y <= 0.62 && c.maxY - pos.y > -0.01) {
          const g = this.groundHeight(nx, pos.z, c.maxY + 0.5)
          if (g <= c.maxY + 0.01) { pos.y = g; continue }
        }
        hitWall = true
        pos.x = vel.x > 0 ? Math.min(pos.x, c.minX - r - 0.001) : Math.max(pos.x, c.maxX + r + 0.001)
        break
      }
    }
    if (!hitWall || Math.abs(pos.x - nx) > 1e-6) { if (!hitWall) pos.x = nx }

    // --- horizontal Z ---
    let hitWallZ = false
    const nz = pos.z + vel.z * dt
    for (const c of this.nearby(pos.x, nz)) {
      if (c.walkable) continue
      if (this.hits(pos.x, pos.y, nz, r, h, c)) {
        if (c.maxY - pos.y <= 0.62 && c.maxY - pos.y > -0.01) {
          const g = this.groundHeight(pos.x, nz, c.maxY + 0.5)
          if (g <= c.maxY + 0.01) { pos.y = g; continue }
        }
        hitWallZ = true
        pos.z = vel.z > 0 ? Math.min(pos.z, c.minZ - r - 0.001) : Math.max(pos.z, c.maxZ + r + 0.001)
        break
      }
    }
    if (!hitWallZ) pos.z = nz
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
    }
    return { grounded, hitWall, groundY, landed }
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
