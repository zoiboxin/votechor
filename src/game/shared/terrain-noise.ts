// VoteChor shared terrain math — the SINGLE SOURCE used by BOTH the mountain
// renderer (world.ts getMountainGeo) and the collision heightfield
// (mountain-field.ts). DO NOT FORK these formulas: the mountain surfaces the
// player walks on are exactly the surfaces the GPU draws because both sides
// call these functions. (v64 rebuild of the lost v62/v63 pipeline.)

/** Deterministic 0..1 hash from two scalars (position/angle seeds). */
export function mHash(a: number, b: number): number {
  let h = Math.imul((a * 374761393 + b * 668265263) | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 15), 2246822519)
  h = Math.imul(h ^ (h >>> 13), 3266489917)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Bilinear value-noise lookup on an infinite lattice — smooth 0..1 field. */
export function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = mHash(xi, yi), b = mHash(xi + 1, yi)
  const c = mHash(xi, yi + 1), d = mHash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/**
 * Two-octave crag noise sampled on the unit circle (cos/sin) so it is
 * CONTINUOUS and 2π-PERIODIC through the angle wrap — mountains never show a
 * seam, and the renderer's angle convention (any of a / a−2π) yields the same
 * value. Octave frequencies are INTEGER multiples of the angle for the same
 * reason. Returns roughly 0..1 (centered ~0.5).
 */
export function mNoise(angle: number, ny: number, seed: number): number {
  const cx = Math.cos(angle), sx = Math.sin(angle)
  const n1 = vnoise((cx + 1) * 3.1 + seed * 17.7, (sx + 1) * 3.1 + ny * 4.3 + seed * 9.1)
  // octave 2 on the double-angle circle (integer k=2 → stays 2π-periodic)
  const c2 = Math.cos(2 * angle + 1.3), s2 = Math.sin(2 * angle + 1.3)
  const n2 = vnoise((c2 + 1) * 7.9 + seed * 31.3, (s2 + 1) * 7.9 + ny * 9.7 + seed * 5.4)
  return n1 * 0.68 + n2 * 0.32
}

/** Dome variant: blend the lower flank to the cone's linear falloff (walkable) — the raw hemisphere's equator was an unclimbable 86° cliff. Above this fraction the spherical cap takes over. */
export const DOME_PROFILE_R = 0.62

/**
 * Base damping — zero the jitter at the foot ring so every massif sits FLUSH
 * on the ground (kills invisible base walls and floating skirts).
 */
export function baseDamp(ny: number): number {
  const t = Math.min(1, Math.max(0, ny / 0.14))
  return t * t * (3 - 2 * t)
}

/**
 * Horizontal profile radius at normalized height ny (0=foot, 1=summit), before
 * noise. Variant 0 sharp cone, 1 dome, 2 ridge-mass, 3 jagged cluster.
 * MONOTONIC decreasing in ny — the heightfield may bisect on it.
 */
export function profileR(ny: number, variant: number): number {
  // concave "matterhorn" flanks — wide skirt, narrow summit
  const concave = Math.pow(1 - ny, 0.35)
  if (variant === 1) {
    // dome: hemisphere cap above DOME_PROFILE_R, linear cone falloff below
    if (ny < DOME_PROFILE_R) return concave
    const t = (ny - DOME_PROFILE_R) / (1 - DOME_PROFILE_R)
    return Math.sqrt(Math.max(0, 1 - t * t)) * concave * 0.92 + 0.08 * concave
  }
  return concave
}

/**
 * VERTICAL crag displacement (fraction of REF_H) at (angle, ny) — ridges and
 * gullies on the flank. Displacing VERTICALLY (never radially) keeps the
 * horizontal profile R(ny) strictly monotonic, so the collision heightfield
 * inverts the surface EXACTLY — no folds, no ambiguity, perfect parity.
 * Strongest low on the flank, damped at the foot ring AND at the summit
 * (the summit ring collapses to one point — all angles must agree there).
 */
export function cragVertical(angle: number, ny: number, seed: number): number {
  const low = (mNoise(angle, ny, seed) - 0.5) * 0.10 * (1 - ny * 0.55)
  const fine = (mNoise(2 * angle + 1.1, ny * 1.7, seed + 7) - 0.5) * 0.03
  return (low + fine) * baseDamp(ny) * summitDamp(ny)
}

/** Fades displacement to 0 as ny → 1 so every angle agrees at the collapsed summit point. */
export function summitDamp(ny: number): number {
  const t = Math.min(1, Math.max(0, (1 - ny) / 0.12))
  return t * t * (3 - 2 * t)
}

/** Jagged-cluster sub-summit term WITH the summit damp applied (shared by render + field). */
export function jagTerm(angle: number, ny: number, seed: number): number {
  if (ny >= 1) return 0
  return jagBump(angle, seed) * 0.9 * summitDamp(ny)
}

/** Jagged-cluster variant (3): two unequal sub-summits via gaussian angular bumps. Returns extra height fraction 0..~0.35. */
export function jagBump(angle: number, seed: number): number {
  const a1 = mHash(seed, 1) * Math.PI * 2
  const a2 = mHash(seed, 2) * Math.PI * 2
  const bump = (a: number, center: number, width: number, amp: number) => {
    let d = Math.abs(a - center)
    if (d > Math.PI) d = Math.PI * 2 - d
    return amp * Math.exp(-(d * d) / (2 * width * width))
  }
  return bump(angle, a1, 0.5, 0.34) + bump(angle, a2, 0.3, 0.2)
}

/** Contour-band jitter for the rock/snow color boundaries (renderer only). */
export function bandJit(angle: number, ny: number, seed: number): number {
  return (mNoise(2 * angle, ny * 6.1, seed + 13) - 0.5) * 0.085
}

/** Snowline fraction per colorway: rim granite 0.62, far range 0.55, green hills none (-1). */
export function snowlineFor(cw: number): number {
  return cw === 2 ? 0.55 : cw === 0 ? 0.62 : -1
}
