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

export class FxSystem {
  group = new THREE.Group()
  private popups: Popup[] = []
  private pool: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial }[] = []
  private max = 24

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
  }

  clear() {
    for (const p of this.popups) { p.sprite.visible = false; this.pool.push({ sprite: p.sprite, mat: p.mat }) }
    this.popups = []
  }
}
