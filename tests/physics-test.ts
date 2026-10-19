// v47 — physics substep regression: high-speed steps must NOT tunnel thin colliders.
// Before the substep, a sprint step at the 0.1 s dt clamp (0.92 m) skipped any
// collider thinner than ~0.9 m; now every sweep is bounded to ≤0.25 m.
import { PhysicsWorld } from '../src/game/physics'
import type { AABB } from '../src/game/shared/types'

let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`) }
  else { fail++; console.error(`  ✗ ${msg}`) }
}

const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, walkable = false): AABB => {
  const c: AABB = { minX, minY, minZ, maxX, maxY, maxZ }
  if (walkable) c.walkable = true
  return c
}

console.log('\n== substep anti-tunneling ==')
{
  // thin 0.4 m wall — thinner than one full sprint step
  const w = new PhysicsWorld()
  w.setColliders([box(-0.2, 0, -5, 0.2, 2.5, 5)]) // wall plane x=0, 0.4 m thick
  const pos = { x: -6, y: 0, z: 0 }
  const vel = { x: 9.2, y: 0, z: 0 } // full sprint
  const dt = 0.1 // the engine's dt clamp — worst case single step (0.92 m)
  const r = 0.35, h = 1.7
  // 6 s of sprinting straight into the wall — must NEVER end up past it
  let tunneled = false
  for (let i = 0; i < 60; i++) {
    const res = w.moveActor(pos, vel, dt, r, h)
    if (pos.x > 0.2) { tunneled = true; break }
    if (res.hitWall && pos.x > -0.2 - r - 0.2) break // resolved at the wall face — done
  }
  ok(!tunneled, `sprint 0.92 m step cannot tunnel a 0.4 m wall (final x=${pos.x.toFixed(2)})`)
}
{
  // same wall, walking speed at normal dt — reaches the wall and resolves
  const w = new PhysicsWorld()
  w.setColliders([box(-0.2, 0, -5, 0.2, 2.5, 5)])
  const pos = { x: -1.0, y: 0, z: 0 }
  const vel = { x: 5.2, y: 0, z: 0 }
  let hit = false
  for (let i = 0; i < 40; i++) {
    const res = w.moveActor(pos, vel, 0.016, 0.35, 1.7)
    if (res.hitWall) { hit = true; break }
  }
  ok(hit && pos.x < -0.2, `normal walk still collides (x=${pos.x.toFixed(2)}, hitWall=${hit})`)
}
{
  // thin collider along Z too
  const w = new PhysicsWorld()
  w.setColliders([box(-5, 0, -0.2, 5, 2.5, 0.2)])
  const pos = { x: 0, y: 0, z: -6 }
  const vel = { x: 0, y: 0, z: 9.2 }
  let tunneled = false
  for (let i = 0; i < 60; i++) {
    w.moveActor(pos, vel, 0.1, 0.35, 1.7)
    if (pos.z > 0.2) { tunneled = true; break }
  }
  ok(!tunneled, `sprint along Z cannot tunnel the thin wall (final z=${pos.z.toFixed(2)})`)
}
{
  // vault + step-up still work through the substep loop (behaviour unchanged)
  const w = new PhysicsWorld()
  w.setColliders([box(2, 0, -1, 3.2, 0.55, 1, true)]) // 0.55 m step-up platform
  const pos = { x: 1, y: 0, z: 0 }
  const vel = { x: 5.2, y: 0, z: 0 }
  for (let i = 0; i < 40; i++) w.moveActor(pos, vel, 0.05, 0.35, 1.7)
  ok(Math.abs(pos.y - 0.55) < 0.02, `step-up onto a 0.55 m platform still works (y=${pos.y.toFixed(2)})`)
}

console.log(`\n${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
