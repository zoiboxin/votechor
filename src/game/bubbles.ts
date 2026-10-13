// VoteChor speech bubbles — pooled canvas-sprite dialogue bubbles that follow
// world anchors (NPC rigs). Paper texture, ink border, speech tail. Client-side juice only.
import * as THREE from 'three'

interface Bubble {
  sprite: THREE.Sprite
  mat: THREE.SpriteMaterial
  key: string
  t: number
  life: number
  getPos: () => THREE.Vector3 | null
  popT: number // squash-in animation
}

const POOL_MAX = 10

export class SpeechBubbleSystem {
  group = new THREE.Group()
  private bubbles: Bubble[] = []
  private pool: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial }[] = []
  /** Optional wall-occlusion test (camera → bubble anchor). Set by the game orchestrator. */
  occlusionCheck: ((x: number, y: number, z: number) => boolean) | null = null

  private makeTexture(text: string): { tex: THREE.CanvasTexture; aspect: number } {
    const maxW = 28
    // naive word wrap for hindi-english satire lines
    const words = text.split(' ')
    const lines: string[] = []
    let cur = ''
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > maxW && cur) { lines.push(cur.trim()); cur = w }
      else cur = (cur + ' ' + w).trim()
    }
    if (cur) lines.push(cur.trim())
    const charW = 22
    const w = Math.min(760, Math.max(200, Math.max(...lines.map(l => l.length)) * charW + 84))
    const h = 58 + lines.length * 44
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h + 26
    const ctx = canvas.getContext('2d')!
    // paper bubble
    const r = 26
    ctx.beginPath()
    ctx.moveTo(r, 4)
    ctx.lineTo(w - r, 4)
    ctx.quadraticCurveTo(w - 4, 4, w - 4, r)
    ctx.lineTo(w - 4, h - r)
    ctx.quadraticCurveTo(w - 4, h, w - r, h)
    ctx.lineTo(r, h)
    ctx.quadraticCurveTo(4, h, 4, h - r)
    ctx.lineTo(4, r)
    ctx.quadraticCurveTo(4, 4, r, 4)
    ctx.closePath()
    ctx.fillStyle = '#f5efdc'
    ctx.fill()
    ctx.lineWidth = 7
    ctx.strokeStyle = '#1c1a17'
    ctx.stroke()
    // tail
    ctx.beginPath()
    ctx.moveTo(w / 2 - 16, h - 3)
    ctx.lineTo(w / 2, h + 22)
    ctx.lineTo(w / 2 + 16, h - 3)
    ctx.closePath()
    ctx.fillStyle = '#f5efdc'
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = '#1c1a17'
    ctx.beginPath(); ctx.moveTo(w / 2 - 16, h - 2); ctx.lineTo(w / 2, h + 22); ctx.lineTo(w / 2 + 16, h - 2); ctx.stroke()
    ctx.fillStyle = '#f5efdc'
    ctx.fillRect(w / 2 - 14, h - 8, 28, 8)
    // text
    ctx.font = 'bold 34px Arial'
    ctx.textAlign = 'center'
    ctx.fillStyle = '#1c1a17'
    const startY = h / 2 - (lines.length - 1) * 22 - 6
    lines.forEach((l, i) => ctx.fillText(l, w / 2, startY + i * 44))
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return { tex, aspect: w / (h + 26) }
  }

  /**
   * Show a bubble anchored above a moving world position.
   * One bubble per key — saying again replaces it.
   */
  say(key: string, text: string, getPos: () => THREE.Vector3 | null, life = 4.2) {
    const existing = this.bubbles.find(b => b.key === key)
    if (existing) { existing.t = 0; existing.life = life; return }
    if (this.bubbles.length >= POOL_MAX) {
      const old = this.bubbles.shift()
      if (old) { old.sprite.visible = false; this.pool.push({ sprite: old.sprite, mat: old.mat }) }
    }
    let entry = this.pool.pop()
    if (!entry) {
      const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false })
      const sprite = new THREE.Sprite(mat)
      sprite.renderOrder = 30
      this.group.add(sprite)
      entry = { sprite, mat }
    }
    const { tex, aspect } = this.makeTexture(text)
    entry.mat.map = tex
    entry.mat.opacity = 0
    entry.mat.needsUpdate = true
    entry.sprite.visible = true
    const h = 1.35
    this.bubbles.push({ sprite: entry.sprite, mat: entry.mat, key, t: 0, life, getPos, popT: 0 })
    void h
  }

  update(dt: number) {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]
      b.t += dt
      b.popT = Math.min(1, b.popT + dt * 5)
      const f = b.t / b.life
      const pos = b.getPos()
      if (!pos || f >= 1) {
        b.sprite.visible = false
        this.pool.push({ sprite: b.sprite, mat: b.mat })
        this.bubbles.splice(i, 1)
        continue
      }
      // fade in fast, hold, fade out
      b.mat.opacity = b.t < 0.18 ? b.t / 0.18 : f > 0.82 ? 1 - (f - 0.82) / 0.18 : 1
      const bob = Math.sin(b.t * 2.1) * 0.05
      const pop = 0.7 + 0.3 * (1 - Math.pow(1 - b.popT, 3))
      const tex = b.mat.map
      const img = tex?.image as { width?: number; height?: number } | undefined
      const aspect = img?.width && img?.height ? img.width / img.height : 2.4
      b.sprite.scale.set(3.1 * pop * aspect * 0.62, 3.1 * pop * 0.62, 1)
      const by = pos.y + 2.45 + bob
      b.sprite.position.set(pos.x, by, pos.z)
      // hide when the speaker is occluded from the camera (walls, buildings)
      if (this.occlusionCheck && b.mat.opacity > 0) {
        b.sprite.visible = !this.occlusionCheck(pos.x, by, pos.z)
      }
    }
  }

  clear() {
    for (const b of this.bubbles) { b.sprite.visible = false; this.pool.push({ sprite: b.sprite, mat: b.mat }) }
    this.bubbles = []
  }
}

// ---- satirical dialogue pools (fictional humor only) ----
export const NPC_LINES: Record<string, string[]> = {
  police: [
    'Do NOT run. Jogging is also suspicious.',
    'Chai break in 3… 2… 1… interrupted. Again.',
    'I joined the force for the whistle.',
    'This road is 402% restricted now.',
    'My mustache senses protest activity.',
    'Paperwork first, democracy second.',
    'I have my eye on you. Both of them.',
    'No assembly of more than one (1) citizen.',
  ],
  chase: [
    'STOP! You are under arrest for jogging!',
    'You can outrun the lathi but not the FORM!',
    'This chase counts as my cardio, thank you.',
    'Come back! I have forms you must fill!',
  ],
  security: [
    'This zone is restricted. And next door too.',
    'My lanyard says authority. See?',
    'I have counted these crates 14 times today.',
    'Suspicious energy detected. Investigating.',
    'The searchlight and I are best friends.',
  ],
  guard: [
    'I guard this gate with my life. And my stamp.',
    'Nobody passes without Form 27-B in triplicate.',
    'Ceremonial duty. Very ceremonial. Extremely.',
    'I have been standing here since 1987.',
    'The gate stays shut. The committee insists.',
  ],
}
