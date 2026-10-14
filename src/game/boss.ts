// VoteChor boss client — renders The Great Vote Collector + arena hazards.
import * as THREE from 'three'
import { buildBoss } from './character'
import { BOSS_NAME } from './shared/constants'
import type { BossNetState } from './shared/types'

export class BossClient {
  group = new THREE.Group()
  private bossParts = buildBoss()
  private telegraphMeshes = new Map<string, THREE.Mesh>()
  private paperMeshes = new Map<string, THREE.Group>()
  private ballotMeshes = new Map<string, THREE.Group>()
  private stationMeshes = new Map<string, THREE.Group>()
  private speechBubble: THREE.Sprite
  private lastPhase = -1
  private slamTimer = 0
  visible = false

  constructor() {
    this.bossParts.group.position.set(0, 0, -534)
    this.bossParts.group.visible = false
    this.group.add(this.bossParts.group)

    // speech bubble (sprite with canvas)
    const canvas = document.createElement('canvas')
    canvas.width = 512; canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#f5efdc'
    ctx.strokeStyle = '#2c3947'
    ctx.lineWidth = 6
    ctx.beginPath(); ctx.roundRect(6, 6, 500, 100, 20); ctx.fill(); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(240, 106); ctx.lineTo(256, 126); ctx.lineTo(272, 106); ctx.fill()
    ctx.fillStyle = '#8c1f28'
    ctx.font = 'bold 30px Arial'
    ctx.textAlign = 'center'
    ctx.fillText('ORDER! ORDDDERRR!', 256, 66)
    const tex = new THREE.CanvasTexture(canvas)
    this.speechBubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }))
    this.speechBubble.scale.set(6, 1.5, 1)
    this.speechBubble.position.set(0, 12.4, 0)
    this.speechBubble.visible = false
    this.bossParts.group.add(this.speechBubble)

    this.group.name = 'boss'
  }

  private makeStation(kind: string, id: string): THREE.Group {
    const g = new THREE.Group()
    if (kind.startsWith('mega')) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 10, 1, true), new THREE.MeshStandardMaterial({ color: '#f2c14e', metalness: 0.4, side: THREE.DoubleSide }))
      cone.rotation.x = Math.PI
      cone.position.y = 1.7
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.5, 6), new THREE.MeshStandardMaterial({ color: '#4a4038' }))
      pole.position.y = 0.75
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.25, 10), new THREE.MeshStandardMaterial({ color: '#8a8574' }))
      base.position.y = 0.12
      g.add(cone, pole, base)
    } else if (kind.startsWith('sort') || kind.startsWith('team')) {
      const desk = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), new THREE.MeshStandardMaterial({ color: '#7a5c3e', flatShading: true }))
      desk.position.y = 0.5
      const papers = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: '#f5efdc' }))
      papers.position.set(0.3, 1.05, 0)
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 6), new THREE.MeshStandardMaterial({ color: kind.startsWith('team') ? '#4e7d6b' : '#b54a32', emissive: kind.startsWith('team') ? '#1a5c38' : '#5c1a18', emissiveIntensity: 0.5 }))
      flag.position.set(-0.6, 1.5, 0)
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 5), new THREE.MeshStandardMaterial({ color: '#4a4038' }))
      pole.position.set(-0.6, 1.1, 0)
      g.add(desk, papers, flag, pole)
    }
    g.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = true })
    g.userData.kind = kind
    return g
  }

  applyState(s: BossNetState, t: number) {
    const wasVisible = this.visible
    this.visible = s.active || s.phase > 0
    this.bossParts.group.visible = this.visible && s.phase < 6 || (s.phase === 6 && s.timer < 8)
    if (!wasVisible && this.visible) this.lastPhase = -1

    // phase entrance
    if (s.phase !== this.lastPhase) {
      if (s.phase >= 1 && this.lastPhase < 1) {
        // ensure stations visible for phases
      }
      this.lastPhase = s.phase
      if (s.phase === 3) this.slamTimer = 0.4
    }

    // boss pose animation
    const b = this.bossParts
    b.group.position.set(s.x, 0, s.z)
    b.group.rotation.y = s.ry
    const sway = Math.sin(t * 1.2) * 0.04
    b.torsoPivot.rotation.z = sway
    switch (s.stateName) {
      case 'speech': {
        // arm raised, gesticulating
        b.armR.rotation.x = -2.4 + Math.sin(t * 3.4) * 0.3
        b.armL.rotation.x = -0.6 + Math.sin(t * 2.2) * 0.25
        b.headPivot.rotation.x = -0.1
        this.speechBubble.visible = true
        break
      }
      case 'paperwork': {
        b.armR.rotation.x = -1.2 + Math.sin(t * 5) * 0.5
        b.armL.rotation.x = -1.2 - Math.sin(t * 5) * 0.5
        this.speechBubble.visible = Math.sin(t * 0.7) > 0.2
        break
      }
      case 'stamp': {
        // stamp raising then slamming rhythm
        const cycle = (t * 1.4) % 1
        b.armR.rotation.x = cycle < 0.7 ? -2.8 + cycle * 2 : -0.6 + (1 - cycle) * 6
        if (cycle >= 0.68 && cycle < 0.72) this.slamTimer = 0.25
        this.speechBubble.visible = false
        break
      }
      case 'dizzy': {
        b.torsoPivot.rotation.z = Math.sin(t * 4) * 0.18
        b.headPivot.rotation.z = Math.sin(t * 3.4) * 0.3
        b.armR.rotation.x = 0.4
        b.armL.rotation.x = 0.4
        this.speechBubble.visible = true
        break
      }
      case 'teamwork':
      case 'finalvote': {
        b.armR.rotation.x = -1.8
        b.armL.rotation.x = -1.8
        this.speechBubble.visible = s.stateName === 'finalvote'
        break
      }
      case 'defeated': {
        // comically face-plant forward
        const fall = Math.min(1, s.timer / 2.5)
        b.torsoPivot.rotation.x = fall * 1.35
        b.group.position.y = -fall * 0.5
        this.speechBubble.visible = false
        break
      }
      default:
        b.armR.rotation.x = -0.3
        b.armL.rotation.x = -0.3
        this.speechBubble.visible = false
    }

    // shield ring visibility (hidden in phase 5+)
    const shield = this.bossParts.group.getObjectByName('shield')
    if (shield) {
      shield.visible = s.phase < 5
      shield.rotation.z = t * 0.8
      shield.position.y = 5.6 + Math.sin(t * 1.8) * 0.2
    }

    // slam shake
    if (this.slamTimer > 0) this.slamTimer -= 0.016

    // telegraphs
    const seen = new Set<string>()
    for (const tg of s.telegraphs) {
      seen.add(tg.id)
      let mesh = this.telegraphMeshes.get(tg.id)
      if (!mesh) {
        const geo = tg.kind === 'ring' ? new THREE.RingGeometry(tg.r - 0.4, tg.r, 32) : new THREE.CircleGeometry(tg.r, 32)
        mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: tg.kind === 'stamp' ? '#ff3b30' : '#ff9f1c', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }))
        mesh.rotation.x = -Math.PI / 2
        mesh.position.set(tg.x, 0.14, tg.z)
        this.group.add(mesh)
        this.telegraphMeshes.set(tg.id, mesh)
      }
      const progress = 1 - Math.max(0, Math.min(1, tg.t / 2.1))
      ;(mesh.material as THREE.MeshBasicMaterial).opacity = 0.25 + progress * 0.5
      mesh.scale.setScalar(0.6 + progress * 0.4)
    }
    for (const [id, mesh] of this.telegraphMeshes) {
      if (!seen.has(id)) {
        this.group.remove(mesh)
        this.telegraphMeshes.delete(id)
      }
    }

    // paperwork hazards
    const paperIds = new Set(s.paperwork.map(p => p.id))
    for (const p of s.paperwork) {
      let g = this.paperMeshes.get(p.id)
      if (!g) {
        g = new THREE.Group()
        for (let i = 0; i < 5; i++) {
          const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.55), new THREE.MeshStandardMaterial({ color: '#f5efdc', side: THREE.DoubleSide, transparent: true, opacity: 0.9 }))
          sheet.position.set((Math.random() - 0.5) * 0.7, Math.random() * 1.6, (Math.random() - 0.5) * 0.7)
          sheet.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3)
          sheet.userData.spin = Math.random() * 4 + 2
          g.add(sheet)
        }
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshBasicMaterial({ color: '#e8e2d4', transparent: true, opacity: 0.12 }))
        g.add(glow)
        this.group.add(g)
        this.paperMeshes.set(p.id, g)
      }
      g.position.set(p.x, 0, p.z)
      g.rotation.y += 0.03
      g.children.forEach(c => { if (c.userData.spin) c.rotation.x += 0.03 * c.userData.spin * 0.05 + 0.02 })
    }
    for (const [id, g] of this.paperMeshes) {
      if (!paperIds.has(id)) { this.group.remove(g); this.paperMeshes.delete(id) }
    }

    // stations
    const stationIds = new Set(s.stations.map(st => st.id))
    for (const st of s.stations) {
      let g = this.stationMeshes.get(st.id)
      if (!g) {
        g = this.makeStation(st.id, st.id)
        g.position.set(st.x, 0, st.z)
        this.group.add(g)
        this.stationMeshes.set(st.id, g)
      }
      const mat = (g.children.find(c => c instanceof THREE.Mesh && c.geometry instanceof THREE.CylinderGeometry && c.geometry.parameters.height < 0.4) as THREE.Mesh | undefined)?.material as THREE.MeshStandardMaterial | undefined
      const activeMat = g.userData.kind.startsWith('team') ? '#4e7d6b' : '#f2c14e'
      if (mat) mat.emissive.set(st.active ? activeMat : '#000000')
      g.rotation.y += st.active ? 0.02 : 0
    }
    for (const [id, g] of this.stationMeshes) {
      if (!stationIds.has(id)) { this.group.remove(g); this.stationMeshes.delete(id) }
    }

    // ballots
    if (s.votes !== undefined) {
      const ballotIds = new Set<string>()
      // ballots come as separate list; boss netstate carries votes count only.
      // Ballots rendered via setBallots() called by game
      void ballotIds
    }
  }

  setBallots(ballots: { id: string; x: number; z: number; taken: boolean }[], t: number) {
    const ids = new Set(ballots.filter(b => !b.taken).map(b => b.id))
    for (const b of ballots) {
      if (b.taken) {
        const g = this.ballotMeshes.get(b.id)
        if (g) { this.group.remove(g); this.ballotMeshes.delete(b.id) }
        continue
      }
      let g = this.ballotMeshes.get(b.id)
      if (!g) {
        g = new THREE.Group()
        const envelope = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.04), new THREE.MeshStandardMaterial({ color: '#f5efdc', emissive: '#c9a86a', emissiveIntensity: 0.4 }))
        const seal = new THREE.Mesh(new THREE.CircleGeometry(0.08, 10), new THREE.MeshBasicMaterial({ color: '#8c1f28' }))
        seal.position.z = 0.03
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), new THREE.MeshBasicMaterial({ color: '#f2c14e', transparent: true, opacity: 0.2 }))
        g.add(envelope, seal, glow)
        g.position.set(b.x, 1, b.z)
        this.group.add(g)
        this.ballotMeshes.set(b.id, g)
      }
      g.position.y = 1 + Math.sin(t * 2.6 + b.x) * 0.16
      g.rotation.y = t * 1.6
    }
    for (const [id, g] of this.ballotMeshes) {
      if (!ids.has(id)) { this.group.remove(g); this.ballotMeshes.delete(id) }
    }
  }

  hideAll() {
    this.bossParts.group.visible = false
    this.visible = false
    for (const [, m] of this.telegraphMeshes) this.group.remove(m)
    this.telegraphMeshes.clear()
    for (const [, g] of this.paperMeshes) this.group.remove(g)
    this.paperMeshes.clear()
    for (const [, g] of this.ballotMeshes) this.group.remove(g)
    this.ballotMeshes.clear()
    for (const [, g] of this.stationMeshes) this.group.remove(g)
    this.stationMeshes.clear()
  }
}

export { BOSS_NAME }
