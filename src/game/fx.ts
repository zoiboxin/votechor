// VoteChor floating text FX — canvas-sprite popups that rise and fade (juice layer).
import * as THREE from 'three'

interface Popup {
  sprite: THREE.Sprite
  t: number
  life: number
  vy: number
  drift: number
  mat: THREE.SpriteMaterial
}

interface BurstParticle {
  sprite: THREE.Sprite
  mat: THREE.SpriteMaterial
  vx: number
  vy: number
  vz: number
  t: number
  life: number
}

export class FxSystem {
  group = new THREE.Group()
  private popups: Popup[] = []
  private pool: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial }[] = []
  private max = 24
  // particle bursts (double-jump ring, hit puffs) — tiny pooled sprite set
  private bursts: BurstParticle[] = []
  private burstPool: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial }[] = []
  private burstTex: THREE.CanvasTexture | null = null

  private makeTexture(text: string, color: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 96
    const ctx = canvas.getContext('2d')!
    ctx.font = 'bold 46px Arial'
    ctx.textAlign = 'center'
    ctx.lineWidth = 9
    ctx.strokeStyle = 'rgba(28,26,23,0.9)'
    ctx.strokeText(text, 128, 60)
    ctx.fillStyle = color
    ctx.fillText(text, 128, 60)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  private softDot(): THREE.CanvasTexture {
    if (!this.burstTex) {
      const canvas = document.createElement('canvas')
      canvas.width = 32; canvas.height = 32
      const ctx = canvas.getContext('2d')!
      const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 15)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.6, 'rgba(255,255,255,0.55)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 32, 32)
      this.burstTex = new THREE.CanvasTexture(canvas)
    }
    return this.burstTex
  }

  /** Spawn a floating text popup at a world position. */
  popup(text: string, color: string, x: number, y: number, z: number, life = 1.4) {
    if (this.popups.length >= this.max) {
      const old = this.popups.shift()
      if (old) { this.group.remove(old.sprite); this.pool.push({ sprite: old.sprite, mat: old.mat }) }
    }
    let entry = this.pool.pop()
    if (!entry) {
      const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false })
      const sprite = new THREE.Sprite(mat)
      this.group.add(sprite)
      entry = { sprite, mat }
    }
    const tex = this.makeTexture(text, color)
    entry.mat.map = tex
    entry.mat.opacity = 1
    entry.mat.needsUpdate = true
    entry.sprite.position.set(x, y, z)
    entry.sprite.scale.set(1.6, 0.6, 1)
    entry.sprite.visible = true
    this.popups.push({ sprite: entry.sprite, t: 0, life, vy: 1.6 + Math.random() * 0.5, drift: (Math.random() - 0.5) * 0.5, mat: entry.mat })
  }

  /**
   * Radial particle burst at a world position — a flat expanding ring of soft dots
   * (double-jump liftoff, vault puffs, hit sparks). Pooled, ≤ 60 live particles.
   */
  burst(x: number, y: number, z: number, color: string, count = 12, speed = 3.2, life = 0.5) {
    const tex = this.softDot()
    for (let i = 0; i < count; i++) {
      if (this.bursts.length >= 60) break
      let entry = this.burstPool.pop()
      if (!entry) {
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
        const sprite = new THREE.Sprite(mat)
        sprite.scale.set(0.28, 0.28, 1)
        this.group.add(sprite)
        entry = { sprite, mat }
      }
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4
      const sp = speed * (0.7 + Math.random() * 0.5)
      entry.mat.color.set(color)
      entry.mat.opacity = 0.95
      entry.sprite.visible = true
      entry.sprite.position.set(x, y, z)
      this.bursts.push({
        sprite: entry.sprite, mat: entry.mat,
        vx: Math.cos(ang) * sp, vy: 0.8 + Math.random() * 1.2, vz: Math.sin(ang) * sp,
        t: 0, life: life * (0.8 + Math.random() * 0.4),
      })
    }
  }

  update(dt: number) {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]
      p.t += dt
      const f = p.t / p.life
      if (f >= 1) {
        p.sprite.visible = false
        this.pool.push({ sprite: p.sprite, mat: p.mat })
        this.popups.splice(i, 1)
        continue
      }
      p.sprite.position.y += p.vy * dt * (1 - f * 0.6)
      p.sprite.position.x += p.drift * dt
      const scale = 0.7 + f * 0.35
      p.sprite.scale.set(1.6 * scale, 0.6 * scale, 1)
      p.mat.opacity = f < 0.7 ? 1 : 1 - (f - 0.7) / 0.3
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]
      b.t += dt
      const f = b.t / b.life
      if (f >= 1) {
        b.sprite.visible = false
        this.burstPool.push({ sprite: b.sprite, mat: b.mat })
        this.bursts.splice(i, 1)
        continue
      }
      b.sprite.position.x += b.vx * dt
      b.sprite.position.y += b.vy * dt
      b.sprite.position.z += b.vz * dt
      b.vx *= 1 - 2.2 * dt
      b.vz *= 1 - 2.2 * dt
      b.vy -= 2.6 * dt
      const s = 0.28 * (1 + f * 1.3)
      b.sprite.scale.set(s, s, 1)
      b.mat.opacity = 0.95 * (1 - f)
    }
  }

  clear() {
    for (const p of this.popups) { p.sprite.visible = false; this.pool.push({ sprite: p.sprite, mat: p.mat }) }
    this.popups = []
    for (const b of this.bursts) { b.sprite.visible = false; this.burstPool.push({ sprite: b.sprite, mat: b.mat }) }
    this.bursts = []
  }
}
