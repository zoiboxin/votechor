// VoteChor animation state machine tests — pure logic, no DOM.
//
// Coverage:
//   • pickLoco priority matrix — capture states > impact states > locomotion,
//     airborne split (jump / doubleJump / fall), grounded speed thresholds.
//   • mapToAnimName — LocoState → network/procedural AnimName mapping.
//   • CLIP_FALLBACK — every state has a chain; resolution against the full
//     exported clip set and against a degraded (idle-only) model.
//   • GLBAnimDriver — crossfade play/hold behavior + fallback + no-crash on
//     animation-free models.
//
// Run: bun tests/anim-test.ts
import * as THREE from 'three'
import { pickLoco, mapToAnimName, CLIP_FALLBACK, GLBAnimDriver, type LocoState } from '../src/game/anim'
import type { AnimContext } from '../src/game/anim'

let pass = 0
let fail = 0
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ FAIL: ${label}`) }
}

const ctx = (over: Partial<AnimContext> = {}): AnimContext => ({
  grounded: true, vy: 0, hSpeed: 0, sliding: false, dazed: false, detained: false,
  landTimer: 0, recoverTimer: 0, jumpsUsed: 0, ...over,
})

console.log('— pickLoco: grounded locomotion —')
ok(pickLoco(ctx()) === 'idle', 'standing still → idle')
ok(pickLoco(ctx({ hSpeed: 0.6 })) === 'idle', 'hSpeed 0.6 (≤0.6) → idle')
ok(pickLoco(ctx({ hSpeed: 0.7 })) === 'walk', 'hSpeed 0.7 → walk')
ok(pickLoco(ctx({ hSpeed: 5 })) === 'walk', 'hSpeed 5 → walk')
ok(pickLoco(ctx({ hSpeed: 6.4 })) === 'walk', 'hSpeed 6.4 (≤6.4) → walk')
ok(pickLoco(ctx({ hSpeed: 6.5 })) === 'run', 'hSpeed 6.5 → run (sprint)')
ok(pickLoco(ctx({ hSpeed: 9 })) === 'run', 'hSpeed 9 → run')

console.log('— pickLoco: airborne split —')
ok(pickLoco(ctx({ grounded: false, vy: 4, jumpsUsed: 1 })) === 'jump', 'rising after first jump → jump')
ok(pickLoco(ctx({ grounded: false, vy: 4, jumpsUsed: 2 })) === 'doubleJump', 'rising after second jump → doubleJump')
ok(pickLoco(ctx({ grounded: false, vy: -1.5, jumpsUsed: 1 })) === 'jump', 'slow descent (≥-2.5) → jump (apex hold)')
ok(pickLoco(ctx({ grounded: false, vy: -3, jumpsUsed: 1 })) === 'fall', 'vy -3 → fall')
ok(pickLoco(ctx({ grounded: false, vy: -4, jumpsUsed: 2 })) === 'fall', 'double-jump then plummeting → fall takes over')
ok(pickLoco(ctx({ grounded: false, vy: -2.4, jumpsUsed: 2 })) === 'doubleJump', 'double-jump hang (≥-3, ≥-2.5) → doubleJump')

console.log('— pickLoco: impact + capture priority —')
ok(pickLoco(ctx({ hSpeed: 5, landTimer: 0.3 })) === 'land', 'landing window beats locomotion')
ok(pickLoco(ctx({ hSpeed: 5, recoverTimer: 0.4 })) === 'recover', 'getup window beats locomotion')
ok(pickLoco(ctx({ landTimer: 0.3, recoverTimer: 0.4 })) === 'land', 'landing beats getup')
ok(pickLoco(ctx({ hSpeed: 9, sliding: true })) === 'slide', 'slide beats run')
ok(pickLoco(ctx({ dazed: true, sliding: true, grounded: false, vy: -5 })) === 'hit', 'dazed → hit beats slide/fall')
ok(pickLoco(ctx({ detained: true, dazed: true, sliding: true, grounded: false, vy: -5, landTimer: 1 })) === 'detained', 'detained beats everything')

console.log('— mapToAnimName —')
ok(mapToAnimName('idle') === 'idle', 'idle identity')
ok(mapToAnimName('run') === 'run', 'run identity')
ok(mapToAnimName('doubleJump') === 'jump', 'doubleJump publishes as jump')
ok(mapToAnimName('fall') === 'fall', 'fall publishes as fall (new net state)')
ok(mapToAnimName('land') === 'land', 'land publishes as land (new net state)')
ok(mapToAnimName('recover') === 'recover', 'recover publishes as recover (new net state)')
ok(mapToAnimName('hit') === 'dazed', 'hit publishes as dazed (existing net state)')

console.log('— CLIP_FALLBACK coverage —')
const exportedClips = ['idle', 'walk', 'run', 'jump', 'fall', 'land', 'slide', 'hit', 'detained', 'recover', 'celebrate', 'throw', 'heal']
const allStates: LocoState[] = ['idle', 'walk', 'run', 'jump', 'doubleJump', 'fall', 'land', 'slide', 'hit', 'detained', 'recover', 'celebrate', 'throw', 'heal']
let chainsOk = true
for (const s of allStates) {
  const chain = CLIP_FALLBACK[s]
  if (!chain || chain.length === 0) { chainsOk = false; console.log(`  ✗ ${s} has no fallback chain`) }
}
ok(chainsOk, 'every LocoState has a non-empty fallback chain')

// full model: every state resolves to its FIRST choice (the export ships all clips)
const fullRoot = new THREE.Group()
const hips = new THREE.Object3D(); hips.name = 'Hips'; fullRoot.add(hips)
const fullClipMap = new Map<string, THREE.AnimationClip>()
for (const name of exportedClips) {
  fullClipMap.set(name, new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 0, 0]),
  ]))
}
const fullDriver = new GLBAnimDriver(new THREE.AnimationMixer(fullRoot), fullClipMap)
let firstChoiceOk = true
for (const s of allStates) {
  // expected = first chain entry that the model actually ships
  const expected = CLIP_FALLBACK[s].find((c) => fullClipMap.has(c)) ?? null
  if (fullDriver.resolveClip(s) !== expected) { firstChoiceOk = false; console.log(`  ✗ ${s} should resolve to ${expected}`) }
}
ok(firstChoiceOk, 'full clip set → every state resolves to its first available clip')
ok(fullDriver.resolveClip('doubleJump') === 'jump', 'doubleJump falls back to the jump clip (not exported as its own)')
ok(fullDriver.playableClips === exportedClips.length, `driver sees all ${exportedClips.length} clips`)

// play/hold behavior on the full model
fullDriver.play('run', ctx({ hSpeed: 8 }))
ok(fullDriver.activeClipName === 'run', 'play(run) → run clip active')
fullDriver.play('run', ctx({ hSpeed: 8 }))
ok(fullDriver.activeClipName === 'run' && (fullDriver as unknown as { currentState: string }).currentState === 'run', 'same-state replay keeps the action (no restart)')
fullDriver.play('land', ctx({ landTimer: 0.4 }))
ok(fullDriver.activeClipName === 'land', 'one-shot land clip plays')
fullDriver.update(0.016)
fullDriver.play('walk', ctx({ hSpeed: 4 }))
fullDriver.update(0.016)
ok(fullDriver.activeClipName === 'walk', 'crossfade to walk works')

// degraded model: only idle exists — everything falls back to idle, driver never crashes
const idleOnly = new Map<string, THREE.AnimationClip>([['idle', fullClipMap.get('idle')!]])
const idleDriver = new GLBAnimDriver(new THREE.AnimationMixer(fullRoot), idleOnly)
idleDriver.play('slide', ctx({ sliding: true }))
ok(idleDriver.activeClipName === 'idle', 'degraded model: slide falls back to idle')
idleDriver.play('celebrate', ctx())
ok(idleDriver.activeClipName === 'idle', 'degraded model: celebrate falls back to idle')

// animation-free model: resolveClip null everywhere, play() is a no-op
const emptyDriver = new GLBAnimDriver(new THREE.AnimationMixer(fullRoot), new Map())
let emptyPlayThrew = false
try { emptyDriver.play('run', ctx({ hSpeed: 8 })); emptyDriver.update(0.016) } catch { emptyPlayThrew = true }
ok(!emptyPlayThrew && emptyDriver.activeClipName === null, 'animation-free model: play() no-ops safely')

// LOD throttle: updates coalesce below the interval
const lodDriver = new GLBAnimDriver(new THREE.AnimationMixer(fullRoot), fullClipMap)
;(lodDriver as unknown as { lodInterval: number }).lodInterval = 0.066
const mixer = (lodDriver as unknown as { mixer: THREE.AnimationMixer }).mixer
const before = mixer.time
lodDriver.update(0.01); lodDriver.update(0.01); lodDriver.update(0.01)
ok(mixer.time === before, 'LOD: sub-interval updates are held')
lodDriver.update(0.05)
ok(mixer.time > before, 'LOD: crossing the interval flushes accumulated dt')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
