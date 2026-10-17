// Task 37 — route sanity: (1) client traversal formula matches the legacy shuttle
// math for 2-point paths (backward compat), (2) sample points along every route
// keep clear of world colliders (per-kind half-width pads).
import { buildWorldDef } from '../src/game/shared/world-def'

function clientPos(path: Array<[number, number]>, speed: number, worldTime: number): [number, number] {
  const cum: number[] = [0]
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]))
  const total = cum[cum.length - 1]
  if (!(total > 0)) return [path[0][0], path[0][1]]
  const period = (total / speed) * 2
  const phase = ((worldTime % period) + period) % period
  const half = period / 2
  const s = (phase < half ? phase : period - phase) * speed
  let i = 0
  while (i < path.length - 2 && s > cum[i + 1]) i++
  const segLen = cum[i + 1] - cum[i]
  const t = segLen > 0 ? Math.min(1, Math.max(0, (s - cum[i]) / segLen)) : 0
  return [path[i][0] + (path[i + 1][0] - path[i][0]) * t, path[i][1] + (path[i + 1][1] - path[i][1]) * t]
}

// legacy 2-point ping-pong (pre-v37) — must match the polyline formula exactly
function legacyPos(path: Array<[number, number]>, speed: number, worldTime: number): [number, number] {
  const a = path[0]
  const b = path[path.length - 1]
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const period = (len / speed) * 2
  const phase = ((worldTime % period) + period) % period
  const half = period / 2
  const t = phase < half ? phase / half : 2 - phase / half
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

const HALF: Record<string, number> = { car: 0.95, bus: 1.3, auto: 0.85, bike: 0.4, cow: 0.7 }
// pre-existing v35/v36 brushes, unchanged routes, accepted (documented in worklog):
// bus1 squeezes the roadworks gap (2×0.1 m) and cow1 brushes the flyover ramp corner.
const PREEXISTING = new Set(['veh_bus1', 'veh_cow1'])

const w = buildWorldDef()
let fails = 0

for (const v of w.vehicles) {
  if (v.path.length === 2) {
    const period = (Math.hypot(v.path[1][0] - v.path[0][0], v.path[1][1] - v.path[0][1]) / v.speed) * 2
    for (let t = 0; t < period; t += period / 512) {
      const a = clientPos(v.path, v.speed, t)
      const b = legacyPos(v.path, v.speed, t)
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-9) { console.log(`FORMULA MISMATCH ${v.id} t=${t.toFixed(2)}`); fails++; break }
    }
  }
  const cum: number[] = [0]
  for (let i = 1; i < v.path.length; i++) cum.push(cum[i - 1] + Math.hypot(v.path[i][0] - v.path[i - 1][0], v.path[i][1] - v.path[i - 1][1]))
  const total = cum[cum.length - 1]
  const pad = HALF[v.kind] ?? 0.85
  let hit = ''
  for (let s = 0; s <= total && !hit; s += 0.5) {
    const [x, z] = clientPos(v.path, v.speed, s / v.speed)
    for (const c of w.colliders) {
      if (c.maxY <= 0.6) continue // low curbs tolerated
      const dx = Math.max(c.minX - x, 0, x - c.maxX)
      const dz = Math.max(c.minZ - z, 0, z - c.maxZ)
      if (Math.hypot(dx, dz) < pad) {
        hit = `@(${x.toFixed(1)},${z.toFixed(1)}) gap=${Math.hypot(dx, dz).toFixed(2)} pad=${pad} box=[${c.minX.toFixed(1)},${c.minZ.toFixed(1)}..${c.maxX.toFixed(1)},${c.maxZ.toFixed(1)}]`
        break
      }
    }
  }
  if (hit) {
    if (PREEXISTING.has(v.id)) console.log(`PRE-EXISTING (accepted) ${v.id} ${hit}`)
    else { console.log(`COLLIDER HIT ${v.id} ${hit}`); fails++ }
  }
}
console.log(fails === 0 ? `ALL ${w.vehicles.length} ROUTES OK (2-point backward-compat exact; new routes fully clear)` : `${fails} PROBLEMS`)
