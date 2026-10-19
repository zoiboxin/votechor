// VoteChor mountain heightfield — the COLLISION surface for every peak.
// Analytic inverse of world.ts getMountainGeo (v77 rebuild): same
// shared/terrain-noise functions (strictly monotonic profileR, VERTICAL-only
// cragVertical, summit-damped jagTerm), same unit-space convention (geo at
// radius 1 / height 1), same per-peak scales the renderer applies
// (sx = s·1.85? · sz = s·(0.72+mHash·0.42), sy = h·0.8? for ridge masses),
// and the SAME total rotation — the deco group AND the mesh each rotate by
// d.ry, so the field unrotates by 2·ry (measured from the renderer source).
// DO NOT FORK the math — render/collision mismatch is the "player walks
// inside the mountain" bug class.
import type { Deco } from './shared/types'
import { profileR, cragVertical, jagTerm } from './shared/terrain-noise'

/** The renderer's mountain seed: floor(|sin(x·12.9898 + z·78.233)·43758.5453|) % 8. */
function peakSeed(x: number, z: number): number {
  return Math.floor(Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453)) % 8
}

/** The renderer's mHash (sin-fractal) — drives the per-peak z-scale jitter. */
function mHash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

interface Peak {
  x: number; z: number
  sx: number; sz: number; sy: number
  variant: number
  seed: number
  cos: number; sin: number // rotation cache for the TOTAL 2·ry
  rMax: number
}

interface Cell { peaks: Peak[] }

const grid = new Map<string, Cell>()
const CELL = 64

function keyOf(cx: number, cz: number): string { return `${cx}:${cz}` }

/** Build the field from the world's mountain decorations (call once per world build). */
export function initMountainField(decos: Deco[]) {
  grid.clear()
  for (const d of decos) {
    if (d.kind !== 'mountain') continue
    const s = d.s ?? 20
    const h = d.h ?? 34
    const variant = d.variant ?? 0
    const seed = peakSeed(d.x, d.z)
    const sx = s * (variant === 3 ? 1.85 : 1)
    const sz = s * (0.72 + mHash(seed * 7 + variant * 3) * 0.42)
    const sy = h * (variant === 3 ? 0.8 : 1)
    const totalRy = (d.ry ?? 0) * 2 // group rotation + mesh rotation
    const rMax = Math.max(sx, sz) * 1.05 + 2
    const p: Peak = {
      x: d.x, z: d.z, sx, sz, sy, variant, seed,
      cos: Math.cos(totalRy), sin: Math.sin(totalRy), rMax,
    }
    const cx0 = Math.floor((d.x - rMax) / CELL), cx1 = Math.floor((d.x + rMax) / CELL)
    const cz0 = Math.floor((d.z - rMax) / CELL), cz1 = Math.floor((d.z + rMax) / CELL)
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const k = keyOf(cx, cz)
      let c = grid.get(k)
      if (!c) { c = { peaks: [] }; grid.set(k, c) }
      c.peaks.push(p)
    }
  }
}

/**
 * Terrain surface height at (x,z) — 0 outside every massif. Exactly the y the
 * renderer draws (max over overlapping peaks), so standing on it reads as
 * standing ON the mountain, never inside it.
 */
export function mountainHeightAt(x: number, z: number): number {
  const c = grid.get(keyOf(Math.floor(x / CELL), Math.floor(z / CELL)))
  if (!c) return 0
  let best = 0
  for (const p of c.peaks) {
    const dx = x - p.x, dz = z - p.z
    if (dx * dx + dz * dz > p.rMax * p.rMax) continue
    // world → local, unrotate the TOTAL 2·ry
    const lx = dx * p.cos - dz * p.sin
    const lz = dx * p.sin + dz * p.cos
    const ux = lx / p.sx
    const uz = lz / p.sz
    const rd = Math.hypot(ux, uz)
    if (rd >= 1) continue // outside the unit profile foot
    const angle = Math.atan2(uz, ux)
    const ny = solveNy(rd, p)
    if (ny <= 0) continue
    const jag = p.variant === 2 ? jagTerm(angle, ny, p.seed) : 0
    const y = p.sy * Math.max(0, ny * (1 + jag) + cragVertical(angle, ny, p.seed))
    if (y > best) best = y
  }
  return best
}

/** Exact bisection inversion of the strictly-monotonic unit profile. */
function solveNy(rd: number, p: Peak): number {
  if (rd <= 0) return 1
  let lo = 0, hi = 1
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (profileR(mid, p.variant) >= rd) lo = mid
    else hi = mid
  }
  return lo
}

/** Ground height for spawn/teleport placement — never invents height. */
export function mountainSpawnHeight(x: number, z: number): number {
  return mountainHeightAt(x, z)
}
