// VoteChor mountain heightfield (v64) — the COLLISION surface for every peak.
// Analytic inverse of world.ts buildMountainGeometry: same terrain-noise
// functions, same reference-size convention (geo at h=100/base=40, scaled per
// peak), same single rotation (deco group ry). DO NOT FORK the math — the
// "player walks inside the mountain" bug class is exactly a render/physics
// mismatch, so both sides MUST share shared/terrain-noise.ts.
import type { Deco } from './shared/types'
import { profileR, cragVertical, jagTerm } from './shared/terrain-noise'

const REF_H = 100   // must match world.ts MOUNTAIN_REF_H
const REF_BASE = 40 // must match world.ts MOUNTAIN_REF_BASE

interface Peak {
  x: number; z: number
  h: number        // world height (m)
  s: number        // plan scale = base / REF_BASE
  ys: number       // vertical scale = h / REF_H
  ez: number       // plan elongation (variant 2 ridge-mass)
  variant: number
  seed: number
  ry: number
  cos: number; sin: number // rotation cache
  rMax: number     // world-space footprint radius (conservative)
}

interface Cell { peaks: Peak[] }

const field: Peak[] = []
const grid = new Map<string, Cell>()
const CELL = 64

function keyOf(cx: number, cz: number): string { return `${cx}:${cz}` }

function addPeakToCell(p: Peak, cx: number, cz: number) {
  const k = keyOf(cx, cz)
  let c = grid.get(k)
  if (!c) { c = { peaks: [] }; grid.set(k, c) }
  c.peaks.push(p)
}

/** Build the field from the world's mountain decorations (call once per world build). */
export function initMountainField(decos: Deco[]) {
  field.length = 0
  grid.clear()
  for (const d of decos) {
    if (d.kind !== 'mountain') continue
    const seed = d.seed ?? 0
    const variant = d.variant ?? 0
    const base = d.base ?? 40
    const h = d.h ?? 60
    const ry = d.ry ?? 0
    const ez = variant === 2 ? 1.85 : 0.9 + hashJ(seed, 4) * 0.2
    // conservative world footprint: base · max(ez, 1) — the profile foot is the widest point
    const rMax = base * Math.max(1, ez) + 4
    const p: Peak = {
      x: d.x, z: d.z, h, s: base / REF_BASE, ys: h / REF_H, ez, variant, seed, ry,
      cos: Math.cos(ry), sin: Math.sin(ry), rMax,
    }
    field.push(p)
    const cx0 = Math.floor((d.x - rMax) / CELL), cx1 = Math.floor((d.x + rMax) / CELL)
    const cz0 = Math.floor((d.z - rMax) / CELL), cz1 = Math.floor((d.z + rMax) / CELL)
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) addPeakToCell(p, cx, cz)
  }
}

/** Deterministic hash matching mHash in terrain-noise (kept local to avoid a circular import surface). */
function hashJ(a: number, b: number): number {
  let h = Math.imul((a * 374761393 + b * 668265263) | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 15), 2246822519)
  h = Math.imul(h ^ (h >>> 13), 3266489917)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * Terrain surface height at (x,z) — 0 outside every massif. This is the exact
 * y the renderer draws (max over overlapping peaks), so standing on it reads
 * as standing ON the mountain, never inside it.
 */
export function mountainHeightAt(x: number, z: number): number {
  const c = grid.get(keyOf(Math.floor(x / CELL), Math.floor(z / CELL)))
  if (!c) return 0
  let best = 0
  for (const p of c.peaks) {
    const dx = x - p.x, dz = z - p.z
    if (dx * dx + dz * dz > p.rMax * p.rMax) continue
    // world → local (inverse of rotation.y): lx = dx·cos − dz·sin; lz = dx·sin + dz·cos
    const lx = dx * p.cos - dz * p.sin
    const lz = dx * p.sin + dz * p.cos
    // unscale plan (uniform s, then the ellipse elongation ez on local z)
    const ux = lx / p.s
    const uz = lz / (p.s * p.ez)
    const rd = Math.hypot(ux, uz)
    if (rd > REF_BASE) continue // outside the (monotonic) profile foot
    const angle = Math.atan2(uz, ux)
    const ny = solveNy(rd, p)
    if (ny <= 0) continue
    const jag = p.variant === 3 ? jagTerm(angle, ny, p.seed) : 0
    const yLocal = REF_H * ny * (1 + jag) + cragVertical(angle, ny, p.seed) * REF_H
    const y = yLocal * p.ys
    if (y > best) best = y
  }
  return best
}

/**
 * Exact inversion of the strictly-monotonic horizontal profile
 * R(ny) = REF_BASE · profileR(ny, variant): bisection to ~1e-9 of the height
 * range. Vertical crags displace only y — they never break monotonicity.
 */
function solveNy(rd: number, p: Peak): number {
  if (rd >= REF_BASE) return 0
  if (rd <= 0) return 1
  let lo = 0, hi = 1
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (REF_BASE * profileR(mid, p.variant) >= rd) lo = mid
    else hi = mid
  }
  return lo
}

/** Ground height for spawn/teleport placement — never returns more than the true surface. */
export function mountainSpawnHeight(x: number, z: number): number {
  return mountainHeightAt(x, z)
}

