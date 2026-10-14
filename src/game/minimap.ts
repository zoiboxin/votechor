// VoteChor circular minimap — GTA-style rotating radar + A* route hints.
// All rendering + caching lives here so game.ts's drawHudMinimap is a thin data
// adapter and the 60Hz HUD draw stays well under its 2ms budget:
//   - the static world layer (zones, roads, building ink from world-def colliders)
//     is prerendered ONCE in WORLD space per zoom bucket, then blitted rotated +
//     translated into the circular clip each frame (one drawImage — rotation never
//     invalidates the cache);
//   - the nav grid for routes is built lazily on the first computeRoute() call
//     (10m cells, colliders inflated 0.8m — same pattern as the server's bot nav
//     graph from round 13) and an LRU cache keeps repeat solves free.
import { MINIMAP_MIN_ZOOM, MINIMAP_MAX_ZOOM } from '@/lib/game-store'
import { buildWorldDef, CROSS_ROADS } from './shared/world-def'
import type { AABB } from './shared/types'

// ---------- public types ----------
export interface MinimapNPC { x: number; z: number; chasing: boolean }
export interface MinimapRemote { x: number; z: number; squad: boolean }
export interface MinimapZone { name: string; zStart: number; zEnd: number }
export interface MinimapCheckpoint { id: number; x: number; z: number }
export interface RoutePoint { x: number; z: number }

export interface DrawMinimapOpts {
  px: number
  pz: number
  ry: number
  /** world-meters shown across the radar diameter (round-12 zoom mapping) */
  zoomM: number
  /** true = rotate with player heading (heading up), false = north-up */
  rotate: boolean
  waypoint: (RoutePoint & { label: string }) | null
  objective: (RoutePoint & { label: string }) | null
  detained: boolean
  /** where the player will be released (world-def detention coords) */
  releaseTarget: RoutePoint | null
  checkpoints: MinimapCheckpoint[]
  activatedIds: Set<number>
  boss: { x: number; z: number; radius: number; gateZ: number }
  gateOpen: boolean
  tokens: { x: number; z: number; taken: boolean }[]
  npcs: MinimapNPC[]
  remotes: MinimapRemote[]
  /** how far the local player can see patrols (journalist perk) */
  seeDist: number
  colliders: AABB[]
  zones: MinimapZone[]
}

// ---------- static world layer (prerendered in WORLD space) ----------
const PPM = 3 // px per world meter in the static layer
const WORLD_W = 240
const WORLD_H = 582
const SW = WORLD_W * PPM // 720
const SH = WORLD_H * PPM // 1746

const ZONE_TINTS = [
  'rgba(201,111,74,0.30)', // Protest Plaza
  'rgba(184,92,62,0.30)', // Chowk Market
  'rgba(127,154,140,0.30)', // Security Checkpoint
  'rgba(201,168,106,0.30)', // Grand Avenue
  'rgba(154,123,95,0.36)', // Government District
]

const uX = (x: number) => (x + WORLD_W / 2) * PPM
const vZ = (z: number) => (10 - z) * PPM

let staticCanvas: HTMLCanvasElement | null = null
let staticBucket = -1

/**
 * World-space ink map: out-of-world shade, ground, zone tints, roads and building
 * footprints (colliders taller than 2m — stalls/towers/monuments included, tree
 * trunks and thin props filtered by footprint area). LOD per zoom bucket:
 * far zooms drop small blocks so the full-city radar stays readable.
 */
function buildStaticLayer(bucket: number, colliders: AABB[], zones: MinimapZone[]): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = SW
  cv.height = SH
  const c = cv.getContext('2d')
  if (!c) return cv
  // out-of-world ink
  c.fillStyle = '#171512'
  c.fillRect(0, 0, SW, SH)
  // ground
  c.fillStyle = '#262119'
  c.fillRect(uX(-120), 0, WORLD_W * PPM, SH)
  // zone tints
  zones.forEach((z, i) => {
    c.fillStyle = ZONE_TINTS[i % ZONE_TINTS.length]
    c.fillRect(uX(-120), vZ(z.zStart), WORLD_W * PPM, Math.max(1, vZ(z.zEnd) - vZ(z.zStart)))
  })
  // roads: the central bazaar corridor + the wider Grand Avenue stretch + the
  // four east-west cross streets that stitch the side mohallas together
  c.fillStyle = 'rgba(96,88,72,0.50)'
  c.fillRect(uX(-8), 0, uX(8) - uX(-8), SH)
  c.fillRect(uX(-16), vZ(-280), uX(16) - uX(-16), vZ(-420) - vZ(-280))
  for (const cr of CROSS_ROADS) {
    c.fillRect(uX(-114), vZ(cr.z + cr.halfW), uX(114) - uX(-114), vZ(cr.z - cr.halfW) - vZ(cr.z + cr.halfW))
  }
  // world side walls
  c.strokeStyle = 'rgba(245,239,220,0.28)'
  c.lineWidth = 2
  c.beginPath()
  c.moveTo(uX(-120), 0); c.lineTo(uX(-120), SH)
  c.moveTo(uX(120), 0); c.lineTo(uX(120), SH)
  c.stroke()
  // building footprints → soft ink blocks (bucket LOD by footprint area)
  const minArea = bucket === 0 ? 45 : bucket === 1 ? 12 : 3
  c.fillStyle = 'rgba(20,17,14,0.88)'
  c.strokeStyle = 'rgba(245,239,220,0.07)'
  c.lineWidth = 1
  for (const b of colliders) {
    const h = b.maxY - b.minY
    if (h <= 2) continue
    const w = b.maxX - b.minX
    const d = b.maxZ - b.minZ
    if (w * d < minArea || w < 0.9 || d < 0.9) continue
    const x = uX(b.minX)
    const y = vZ(b.maxZ)
    const pw = w * PPM
    const ph = d * PPM
    c.fillRect(x, y, pw, ph)
    c.strokeRect(x + 0.5, y + 0.5, pw - 1, ph - 1)
  }
  // boss arena ring (static; the gate bar itself is dynamic)
  c.strokeStyle = 'rgba(140,31,40,0.55)'
  c.lineWidth = 2
  c.setLineDash([6, 5])
  c.beginPath()
  c.arc(uX(0), vZ(-520), 26 * PPM, 0, 7)
  c.stroke()
  c.setLineDash([])
  return cv
}

// ---------- A* nav grid (lazy, 10m cells, 0.8m collider inflation) ----------
const CELL = 10
const COLS = 24 // 240m / 10
const ROWS = 59 // 582m / 10
const NAV_INFLATE = 0.8
const LOS_INFLATE = 2.0 // extra clearance while smoothing so routes don't hug walls

let navWalk: Uint8Array | null = null

function pointWalkable(x: number, z: number, colliders: AABB[], inflate: number): boolean {
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i]
    if (x >= b.minX - inflate && x <= b.maxX + inflate && z >= b.minZ - inflate && z <= b.maxZ + inflate) return false
  }
  return true
}

function cellCenter(c: number, r: number): [number, number] {
  return [-120 + c * CELL + CELL / 2, 10 - r * CELL - CELL / 2]
}

function buildNavGrid(colliders: AABB[]): Uint8Array {
  const g = new Uint8Array(COLS * ROWS)
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const [cx, cz] = cellCenter(c, r)
      g[r * COLS + c] = pointWalkable(cx, cz, colliders, NAV_INFLATE) ? 1 : 0
    }
  }
  return g
}

function nearestWalkableCell(x: number, z: number): number {
  if (!navWalk) return -1
  const c0 = Math.max(0, Math.min(COLS - 1, Math.floor((x + 120) / CELL)))
  const r0 = Math.max(0, Math.min(ROWS - 1, Math.floor((10 - z) / CELL)))
  if (navWalk[r0 * COLS + c0]) return r0 * COLS + c0
  for (let rad = 1; rad <= 3; rad++) {
    let best = -1
    let bestD = Infinity
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        const r = r0 + dr, c = c0 + dc
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue
        if (!navWalk[r * COLS + c]) continue
        const [cx, cz] = cellCenter(c, r)
        const d = (cx - x) * (cx - x) + (cz - z) * (cz - z)
        if (d < bestD) { bestD = d; best = r * COLS + c }
      }
    }
    if (best >= 0) return best
  }
  return -1
}

const DIAG = Math.SQRT2

/** Tiny binary heap over (f, cellIdx) — the grid is 590 cells, this stays trivial. */
class MinHeap {
  private f: number[] = []
  private v: number[] = []
  get size() { return this.f.length }
  push(f: number, v: number) {
    this.f.push(f); this.v.push(v)
    let i = this.f.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.f[p] <= this.f[i]) break
      this.swap(p, i); i = p
    }
  }
  pop(): number {
    const top = this.v[0]
    const lf = this.f.pop() as number
    const lv = this.v.pop() as number
    if (this.f.length > 0) {
      this.f[0] = lf; this.v[0] = lv
      let i = 0
      for (;;) {
        const l = i * 2 + 1, r = l + 1
        let m = i
        if (l < this.f.length && this.f[l] < this.f[m]) m = l
        if (r < this.f.length && this.f[r] < this.f[m]) m = r
        if (m === i) break
        this.swap(m, i); i = m
      }
    }
    return top
  }
  private swap(a: number, b: number) {
    const tf = this.f[a]; this.f[a] = this.f[b]; this.f[b] = tf
    const tv = this.v[a]; this.v[a] = this.v[b]; this.v[b] = tv
  }
}

function losClear(ax: number, az: number, bx: number, bz: number, colliders: AABB[]): boolean {
  const d = Math.hypot(bx - ax, bz - az)
  const steps = Math.max(1, Math.ceil(d / 2))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    if (!pointWalkable(ax + (bx - ax) * t, az + (bz - az) * t, colliders, LOS_INFLATE)) return false
  }
  return true
}

function smoothPath(pts: RoutePoint[], colliders: AABB[]): RoutePoint[] {
  if (pts.length <= 2) return pts
  const out: RoutePoint[] = []
  let i = 0
  while (i < pts.length - 1) {
    let j = pts.length - 1
    while (j > i + 1 && !losClear(pts[i].x, pts[i].z, pts[j].x, pts[j].z, colliders)) j--
    out.push(pts[j])
    i = j
  }
  return out
}

function solveRoute(fx: number, fz: number, tx: number, tz: number, colliders: AABB[]): RoutePoint[] | null {
  if (!navWalk) navWalk = buildNavGrid(colliders)
  const start = nearestWalkableCell(fx, fz)
  const goal = nearestWalkableCell(tx, tz)
  if (start < 0 || goal < 0) return null
  if (start === goal) return [{ x: tx, z: tz }]
  const n = COLS * ROWS
  const gScore = new Float32Array(n).fill(Infinity)
  const came = new Int16Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const gr = (goal / COLS) | 0, gc = goal % COLS
  const open = new MinHeap()
  gScore[start] = 0
  const sr = (start / COLS) | 0, sc = start % COLS
  const h0 = (() => {
    const dr = Math.abs(sr - gr), dc = Math.abs(sc - gc)
    return (dr > dc ? dr + (DIAG - 1) * dc : dc + (DIAG - 1) * dr)
  })()
  open.push(h0, start)
  const NR = [-1, -1, -1, 0, 0, 1, 1, 1]
  const NC = [-1, 0, 1, -1, 1, -1, 0, 1]
  let found = false
  while (open.size > 0) {
    const cur = open.pop()
    if (cur === goal) { found = true; break }
    if (closed[cur]) continue
    closed[cur] = 1
    const cr = (cur / COLS) | 0, cc = cur % COLS
    for (let k = 0; k < 8; k++) {
      const r = cr + NR[k], c = cc + NC[k]
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue
      const idx = r * COLS + c
      if (!navWalk[idx] || closed[idx]) continue
      const isDiag = NR[k] !== 0 && NC[k] !== 0
      if (isDiag) {
        // forbid corner cutting: both orthogonal neighbors must be free
        const sideA = cr * COLS + (cc + NC[k])
        const sideB = (cr + NR[k]) * COLS + cc
        if (!navWalk[sideA] || !navWalk[sideB]) continue
      }
      const step = isDiag ? DIAG : 1
      const g = gScore[cur] + step
      if (g < gScore[idx]) {
        gScore[idx] = g
        came[idx] = cur
        const dr = Math.abs(r - gr), dc = Math.abs(c - gc)
        const h = dr > dc ? dr + (DIAG - 1) * dc : dc + (DIAG - 1) * dr
        open.push(g + h, idx)
      }
    }
  }
  if (!found) return null
  // reconstruct cell centers
  const cells: number[] = []
  for (let cur = goal; cur !== -1 && cur !== start; cur = came[cur]) cells.push(cur)
  cells.reverse()
  const raw: RoutePoint[] = cells.map((idx) => {
    const [cx, cz] = cellCenter(idx % COLS, (idx / COLS) | 0)
    return { x: cx, z: cz }
  })
  raw.push({ x: tx, z: tz }) // pin-accurate final stub
  return smoothPath(raw, colliders)
}

// ---------- public route API (with small LRU cache) ----------
const routeCache = new Map<string, RoutePoint[] | null>()
const ROUTE_CACHE_MAX = 16

/**
 * A* walking route between two world points over the lazily-built 10m nav grid
 * (colliders inflated 0.8m, 8-neighborhood, no corner cutting, LOS-smoothed).
 * Results are cached on a 2m lattice (LRU, 16 entries) so per-frame callers and
 * the big map preview rarely re-solve. Returns null when no walkable path exists.
 */
export function computeRoute(fromX: number, fromZ: number, toX: number, toZ: number): RoutePoint[] | null {
  const fx = Math.max(-47.5, Math.min(47.5, fromX))
  const fz = Math.max(-571.5, Math.min(9.5, fromZ))
  const tx = Math.max(-47.5, Math.min(47.5, toX))
  const tz = Math.max(-571.5, Math.min(9.5, toZ))
  const key = `${Math.round(fx / 2)}|${Math.round(fz / 2)}|${Math.round(tx / 2)}|${Math.round(tz / 2)}`
  const hit = routeCache.get(key)
  if (routeCache.has(key)) {
    // LRU refresh
    routeCache.delete(key)
    routeCache.set(key, hit as RoutePoint[] | null)
    return hit as RoutePoint[] | null
  }
  // The nav grid is built once from the deterministic world-def colliders;
  // LOS smoothing always uses the same live list.
  let result: RoutePoint[] | null
  if (Math.hypot(tx - fx, tz - fz) < 2) {
    result = [{ x: tx, z: tz }]
  } else {
    result = solveRoute(fx, fz, tx, tz, getColliders())
  }
  if (routeCache.size >= ROUTE_CACHE_MAX) {
    const oldest = routeCache.keys().next().value
    if (oldest !== undefined) routeCache.delete(oldest)
  }
  routeCache.set(key, result)
  return result
}

// Route data source: the SAME deterministic world-def colliders the game and the
// server build (pure seeded data), materialized lazily on the first route solve.
let worldColliders: AABB[] | null = null
function getColliders(): AABB[] {
  if (!worldColliders) worldColliders = buildWorldDef().colliders
  return worldColliders
}

/** Total walking length of a route (meters), from the player through each point. */
export function routeLength(pts: RoutePoint[], fromX: number, fromZ: number): number {
  let d = 0
  let lx = fromX
  let lz = fromZ
  for (const p of pts) {
    d += Math.hypot(p.x - lx, p.z - lz)
    lx = p.x
    lz = p.z
  }
  return d
}

// ---------- radar renderer ----------
let curRot = 0
let lastT = 0

function drawChip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  ctx.font = 'bold 9px ui-sans-serif, system-ui, sans-serif'
  const w = ctx.measureText(text).width + 8
  const h = 13
  ctx.fillStyle = 'rgba(28,26,23,0.85)'
  ctx.strokeStyle = '#f2c14e'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 4)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#f2c14e'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y + 0.5)
  ctx.textBaseline = 'alphabetic'
}

/**
 * The circular radar. Everything is drawn world→radar with one shared rotation
 * (smooth-lerped shortest arc) so the static layer and dynamic dots never drift.
 */
export function drawCircularMinimap(ctx: CanvasRenderingContext2D, o: DrawMinimapOpts) {
  const now = performance.now()
  const dt = Math.min(0.1, Math.max(0.001, (now - lastT) / 1000))
  lastT = now
  const W = ctx.canvas.width
  const H = ctx.canvas.height
  const cx = W / 2
  const cy = H / 2
  const R = Math.min(W, H) / 2 - 1
  const zoom = Math.max(MINIMAP_MIN_ZOOM, Math.min(MINIMAP_MAX_ZOOM, o.zoomM || 150))
  const s = (R * 2) / zoom // px per world meter

  // smooth rotation: rotate mode targets heading-up; north-up targets 0
  const targetRot = o.rotate ? (o.ry - Math.PI) : 0
  let d = targetRot - curRot
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  curRot += d * Math.min(1, dt * 7)
  const rot = curRot
  const cosR = Math.cos(rot)
  const sinR = Math.sin(rot)

  // static world layer — rebuilt only when the zoom bucket changes
  const bucket = zoom >= 320 ? 0 : zoom >= 140 ? 1 : 2
  if (!staticCanvas || bucket !== staticBucket) {
    staticCanvas = buildStaticLayer(bucket, o.colliders, o.zones)
    staticBucket = bucket
  }

  ctx.clearRect(0, 0, W, H)
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, 7)
  ctx.clip()

  // out-of-world shade
  ctx.fillStyle = '#171512'
  ctx.fillRect(0, 0, W, H)

  // static layer blit: world-space prerender rotated/translated into the clip
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(rot)
  ctx.scale(s / PPM, s / PPM)
  ctx.drawImage(staticCanvas, -(o.px + 120) * PPM, -(10 - o.pz) * PPM)
  ctx.restore()

  const toRadar = (wx: number, wz: number): [number, number] => {
    const dx = (wx - o.px) * s
    const dy = -(wz - o.pz) * s
    return [cx + dx * cosR - dy * sinR, cy + dx * sinR + dy * cosR]
  }

  // ---- boss arena + gate ----
  {
    const [bx, by] = toRadar(o.boss.x, o.boss.z)
    const br = o.boss.radius * s
    if (bx > -br && bx < W + br && by > -br && by < H + br) {
      ctx.fillStyle = o.gateOpen ? 'rgba(140,31,40,0.26)' : 'rgba(140,31,40,0.12)'
      ctx.beginPath(); ctx.arc(bx, by, br, 0, 7); ctx.fill()
      // gate bar
      const [g1x, g1y] = toRadar(-10, o.boss.gateZ)
      const [g2x, g2y] = toRadar(10, o.boss.gateZ)
      ctx.strokeStyle = o.gateOpen ? 'rgba(78,155,110,0.85)' : '#8c1f28'
      ctx.lineWidth = o.gateOpen ? 2 : 3
      if (o.gateOpen) ctx.setLineDash([4, 4])
      ctx.beginPath(); ctx.moveTo(g1x, g1y); ctx.lineTo(g2x, g2y); ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // ---- checkpoints ----
  for (const cp of o.checkpoints) {
    const [x, y] = toRadar(cp.x, cp.z)
    if (x < -8 || x > W + 8 || y < -8 || y > H + 8) continue
    ctx.fillStyle = o.activatedIds.has(cp.id) ? '#4e9b6e' : '#c9482e'
    ctx.beginPath(); ctx.arc(x, y, 4.2, 0, 7); ctx.fill()
    ctx.strokeStyle = 'rgba(28,26,23,0.8)'
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  // ---- tokens (stolen votes) ----
  ctx.strokeStyle = 'rgba(28,26,23,0.7)'
  ctx.lineWidth = 1
  for (const t of o.tokens) {
    if (t.taken) continue
    const [x, y] = toRadar(t.x, t.z)
    if (x < -5 || x > W + 5 || y < -5 || y > H + 5) continue
    ctx.fillStyle = '#f2c14e'
    ctx.fillRect(x - 2.2, y - 2.2, 4.4, 4.4)
    ctx.strokeRect(x - 2.2, y - 2.2, 4.4, 4.4)
  }

  // ---- police: ONLY when actively chasing (patrol chase state — no wall-hacks) ----
  const pulse = 0.5 + 0.5 * Math.sin(now / 170)
  for (const n of o.npcs) {
    if (!n.chasing) continue
    const dxm = n.x - o.px
    const dzm = n.z - o.pz
    if (dxm * dxm + dzm * dzm > o.seeDist * o.seeDist) continue
    const [x, y] = toRadar(n.x, n.z)
    if (x < -8 || x > W + 8 || y < -8 || y > H + 8) continue
    ctx.fillStyle = '#ff3b30'
    ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill()
    ctx.strokeStyle = `rgba(255,59,48,${0.25 + 0.4 * pulse})`
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 7); ctx.stroke()
  }

  // ---- squadmates (bright) + nearby protesters/bots (dim) ----
  for (const r of o.remotes) {
    const [x, y] = toRadar(r.x, r.z)
    if (x < -6 || x > W + 6 || y < -6 || y > H + 6) continue
    if (r.squad) {
      ctx.fillStyle = '#4ecdc4'
      ctx.beginPath(); ctx.arc(x, y, 3.4, 0, 7); ctx.fill()
      ctx.strokeStyle = 'rgba(28,26,23,0.7)'
      ctx.lineWidth = 1
      ctx.stroke()
    } else {
      ctx.fillStyle = 'rgba(245,239,220,0.5)'
      ctx.beginPath(); ctx.arc(x, y, 2.1, 0, 7); ctx.fill()
    }
  }

  // ---- route: waypoint > release point (when detained) > current objective ----
  const target: (RoutePoint & { label: string }) | null =
    o.waypoint ?? (o.detained && o.releaseTarget ? { ...o.releaseTarget, label: 'RELEASE' } : null) ?? o.objective
  if (target) {
    const route = computeRoute(o.px, o.pz, target.x, target.z)
    const pts: RoutePoint[] = [{ x: o.px, z: o.pz }, ...(route ?? [{ x: target.x, z: target.z }])]
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    // dark under-stroke for readability over the ink map
    ctx.beginPath()
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = toRadar(pts[i].x, pts[i].z)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = 'rgba(28,26,23,0.6)'
    ctx.lineWidth = 4.5
    ctx.stroke()
    // gold marching dashes
    ctx.strokeStyle = '#f2c14e'
    ctx.lineWidth = 2.2
    ctx.setLineDash([6, 5])
    ctx.lineDashOffset = -(now / 40) % 11
    ctx.stroke()
    ctx.setLineDash([])
    // arrowhead at the end
    const [ex, ey] = toRadar(pts[pts.length - 1].x, pts[pts.length - 1].z)
    const [px2, py2] = toRadar(pts[pts.length - 2].x, pts[pts.length - 2].z)
    const ang = Math.atan2(ey - py2, ex - px2)
    ctx.fillStyle = '#f2c14e'
    ctx.strokeStyle = 'rgba(28,26,23,0.8)'
    ctx.lineWidth = 1
    ctx.save()
    ctx.translate(ex, ey)
    ctx.rotate(ang)
    ctx.beginPath()
    ctx.moveTo(3.5, 0); ctx.lineTo(-2.5, 2.6); ctx.lineTo(-2.5, -2.6)
    ctx.closePath(); ctx.fill(); ctx.stroke()
    ctx.restore()
    // released-from-detention marker (small cream cross)
    if (o.detained && o.releaseTarget && !o.waypoint) {
      const [rx, ry2] = toRadar(o.releaseTarget.x, o.releaseTarget.z)
      ctx.strokeStyle = 'rgba(245,239,220,0.9)'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(rx - 3.5, ry2 - 3.5); ctx.lineTo(rx + 3.5, ry2 + 3.5)
      ctx.moveTo(rx + 3.5, ry2 - 3.5); ctx.lineTo(rx - 3.5, ry2 + 3.5)
      ctx.stroke()
    }
    // distance chip (route length; clamped inside the ring)
    const dist = route ? routeLength(route, o.px, o.pz) : Math.hypot(target.x - o.px, target.z - o.pz)
    let [chx, chy] = toRadar(target.x, target.z)
    const vx = chx - cx
    const vy = chy - cy
    const vd = Math.hypot(vx, vy)
    const maxD = R - 15
    if (vd > maxD) { chx = cx + (vx / vd) * maxD; chy = cy + (vy / vd) * maxD }
    drawChip(ctx, chx, chy, `${Math.round(dist)}m`)
  }

  // ---- waypoint pin (gold) — edge chevron when outside the radar ----
  if (o.waypoint) {
    const [wx, wy] = toRadar(o.waypoint.x, o.waypoint.z)
    const vx = wx - cx
    const vy = wy - cy
    const vd = Math.hypot(vx, vy)
    if (vd > R - 9) {
      // directional chevron on the ring edge
      const ux = vx / vd
      const uy = vy / vd
      const ex = cx + ux * (R - 8)
      const ey = cy + uy * (R - 8)
      ctx.fillStyle = '#f2c14e'
      ctx.strokeStyle = 'rgba(28,26,23,0.85)'
      ctx.lineWidth = 1
      ctx.save()
      ctx.translate(ex, ey)
      ctx.rotate(Math.atan2(uy, ux))
      ctx.beginPath()
      ctx.moveTo(5, 0); ctx.lineTo(-3, 3.4); ctx.lineTo(-3, -3.4)
      ctx.closePath(); ctx.fill(); ctx.stroke()
      ctx.restore()
    } else {
      // lollipop pin
      ctx.strokeStyle = 'rgba(28,26,23,0.85)'
      ctx.lineWidth = 1.6
      ctx.beginPath(); ctx.moveTo(wx, wy + 4); ctx.lineTo(wx, wy + 9); ctx.stroke()
      ctx.fillStyle = '#f2c14e'
      ctx.beginPath(); ctx.arc(wx, wy, 4.2, 0, 7); ctx.fill()
      ctx.strokeStyle = 'rgba(28,26,23,0.9)'
      ctx.lineWidth = 1.4
      ctx.stroke()
    }
  } else if (target) {
    // hollow objective ring when no user waypoint is set
    const [ox2, oy2] = toRadar(target.x, target.z)
    const vx = ox2 - cx, vy = oy2 - cy
    const vd = Math.hypot(vx, vy)
    if (vd <= R - 6) {
      ctx.strokeStyle = 'rgba(242,193,78,0.9)'
      ctx.lineWidth = 1.4
      ctx.setLineDash([3, 3])
      ctx.beginPath(); ctx.arc(ox2, oy2, 5, 0, 7); ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // ---- player: soft pulse ring + true-heading arrow ----
  {
    const pr = 7.5 + Math.sin(now / 280) * 1.4
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'
    ctx.lineWidth = 1.6
    ctx.beginPath(); ctx.arc(cx, cy, pr, 0, 7); ctx.stroke()
    const arrowRot = o.rotate ? 0 : (-o.ry + Math.PI)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(arrowRot)
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#1c1a17'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(0, -7.5); ctx.lineTo(5.2, 5.8); ctx.lineTo(0, 3); ctx.lineTo(-5.2, 5.8)
    ctx.closePath(); ctx.fill(); ctx.stroke()
    ctx.restore()
  }

  ctx.restore() // circular clip

  // ---- ring + north tick + zoom readout (unclipped) ----
  ctx.strokeStyle = 'rgba(28,26,23,0.9)'
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(cx, cy, R - 1, 0, 7); ctx.stroke()

  // 'N' at the world-north edge (rotates with the map in rotate mode)
  {
    const nx = cx + (R - 12) * sinR
    const ny = cy - (R - 12) * cosR
    ctx.font = 'bold 9px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 2.5
    ctx.strokeStyle = 'rgba(28,26,23,0.85)'
    ctx.strokeText('N', nx, ny)
    ctx.fillStyle = 'rgba(245,239,220,0.92)'
    ctx.fillText('N', nx, ny)
    ctx.textBaseline = 'alphabetic'
  }

  // zoom readout — bottom-left diagonal (never collides with the N)
  {
    ctx.font = 'bold 8px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    const zx = cx - (R - 13) * 0.7071
    const zy = cy + (R - 13) * 0.7071
    ctx.lineWidth = 2.5
    ctx.strokeStyle = 'rgba(28,26,23,0.85)'
    const zt = zoom >= 580 ? 'FULL CITY' : `${Math.round(zoom)}m`
    ctx.strokeText(zt, zx, zy)
    ctx.fillStyle = 'rgba(245,239,220,0.6)'
    ctx.fillText(zt, zx, zy)
  }
}
