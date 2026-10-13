// VoteChor world renderer — builds the 3D city from shared WorldDef data.
// Procedural canvas textures, instanced crowd, animated props. No external assets.
import * as THREE from 'three'
import type { WorldDef, Deco } from './shared/types'

const ZONE_COLORS = ['#c96f4a', '#b85c3e', '#7f9a8c', '#c9a86a', '#9a7b5f']

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeatX, repeatY)
  return t
}

function windowTexture(color: string, variant: number): THREE.CanvasTexture {
  return canvasTex(128, 128, (ctx) => {
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 128, 128)
    // subtle grime
    ctx.fillStyle = 'rgba(0,0,0,0.06)'
    for (let i = 0; i < 20; i++) ctx.fillRect(Math.random() * 128, Math.random() * 128, 8, 2)
    const cols = variant === 2 ? 3 : 4
    const rows = 4
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = 10 + c * (108 / cols), y = 12 + r * 28
        ctx.fillStyle = Math.random() < 0.25 ? '#3a3630' : '#2c3947'
        ctx.fillRect(x, y, 108 / cols - 12, 18)
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'
        ctx.lineWidth = 2
        ctx.strokeRect(x, y, 108 / cols - 12, 18)
        // AC units / clotheslines on some
        if (Math.random() < 0.2) { ctx.fillStyle = '#d8d3c5'; ctx.fillRect(x + 4, y + 20, 12, 6) }
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.15)'
    ctx.fillRect(0, 120, 128, 8)
  })
}

function signTexture(text: string, bg = '#f5efdc', fg = '#8c1f28'): THREE.CanvasTexture {
  return canvasTex(256, 64, (ctx) => {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, 256, 64)
    ctx.strokeStyle = '#5a4a2f'; ctx.lineWidth = 4
    ctx.strokeRect(2, 2, 252, 60)
    ctx.fillStyle = fg
    ctx.font = 'bold 22px Arial'
    ctx.textAlign = 'center'
    ctx.fillText(text.slice(0, 26), 128, 40)
  })
}

export class WorldRenderer {
  group = new THREE.Group()
  world: WorldDef
  private searchlightCones: THREE.Mesh[] = []
  private searchlightGroups: THREE.Group[] = []
  private bossGate: THREE.Mesh | null = null
  private animated: ((t: number, dt: number) => void)[] = []
  private fountainParticles: THREE.Points | null = null
  private flags: THREE.Mesh[] = []
  private crowdBodies: THREE.InstancedMesh | null = null
  private crowdHeads: THREE.InstancedMesh | null = null
  private crowdSigns: THREE.Group[] = []

  constructor(world: WorldDef, quality: 'low' | 'medium' | 'high') {
    this.world = world
    this.buildGround()
    this.buildRoads()
    for (const d of world.decorations) this.buildDeco(d)
    this.buildCrowd(world, quality)
    this.buildSearchlights()
    this.buildCheckpointGates()
    this.buildBossArena()
    this.buildDust()
  }

  private buildGround() {
    // Base ground — dusty warm earth
    const tex = canvasTex(256, 256, (ctx) => {
      ctx.fillStyle = '#c9a97c'
      ctx.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = ['#c2a171', '#d1b285', '#bd9c6f', '#c7a87b'][i % 4]
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 3, 3)
      }
    }, 40, 60)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 640),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.set(0, -0.02, -280)
    ground.receiveShadow = true
    this.group.add(ground)
  }

  private buildRoads() {
    // Asphalt spine down the map
    const roadTex = canvasTex(128, 256, (ctx) => {
      ctx.fillStyle = '#565452'
      ctx.fillRect(0, 0, 128, 256)
      for (let i = 0; i < 300; i++) {
        ctx.fillStyle = `rgba(${60 + Math.random() * 40},${58 + Math.random() * 38},${56 + Math.random() * 36},0.5)`
        ctx.fillRect(Math.random() * 128, Math.random() * 256, 2, 2)
      }
      // dashed center line
      ctx.fillStyle = '#e8df9a'
      for (let y = 0; y < 256; y += 64) ctx.fillRect(61, y, 6, 34)
    }, 1, 60)
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(17, 620),
      new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 }),
    )
    road.rotation.x = -Math.PI / 2
    road.position.set(0, 0.01, -275)
    road.receiveShadow = true
    this.group.add(road)

    // Avenue widening (zone D)
    const road2 = new THREE.Mesh(
      new THREE.PlaneGeometry(38, 150),
      new THREE.MeshStandardMaterial({ map: roadTex.clone(), roughness: 0.95 }),
    )
    ;(road2.material as THREE.MeshStandardMaterial).map!.repeat.set(2, 16)
    road2.rotation.x = -Math.PI / 2
    road2.position.set(0, 0.012, -350)
    road2.receiveShadow = true
    this.group.add(road2)

    // sidewalks — light concrete strips
    const swTex = canvasTex(64, 64, (ctx) => {
      ctx.fillStyle = '#b5ab96'
      ctx.fillRect(0, 0, 64, 64)
      ctx.strokeStyle = '#9c927e'
      for (let i = 0; i <= 64; i += 16) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 64); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(64, i); ctx.stroke() }
    }, 3, 160)
    for (const side of [-1, 1]) {
      const sw = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 620),
        new THREE.MeshStandardMaterial({ map: swTex, roughness: 1 }),
      )
      sw.rotation.x = -Math.PI / 2
      sw.position.set(side * 11, 0.02, -275)
      sw.receiveShadow = true
      this.group.add(sw)
    }
  }

  private buildDeco(d: Deco) {
    const g = new THREE.Group()
    g.position.set(d.x, d.y ?? 0, d.z)
    if (d.ry) g.rotation.y = d.ry
    const shadow = true
    switch (d.kind) {
      case 'building': {
        const w = d.w ?? 10, dep = d.d ?? 8, h = d.h ?? 10
        const tex = windowTexture(d.color ?? '#c96f4a', d.variant ?? 0)
        tex.repeat.set(Math.max(1, Math.round(w / 5)), Math.max(1, Math.round(h / 6)))
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }))
        body.position.y = h / 2
        body.castShadow = shadow; body.receiveShadow = true
        g.add(body)
        // parapet
        const par = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.5, dep + 0.4), new THREE.MeshStandardMaterial({ color: '#8a7a62' }))
        par.position.y = h + 0.2
        g.add(par)
        // roof water tank
        if ((d.variant ?? 0) % 2 === 0) {
          const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 10), new THREE.MeshStandardMaterial({ color: '#2e3d4f', flatShading: true }))
          tank.position.set(w * 0.25, h + 1.1, -dep * 0.2)
          g.add(tank)
        }
        // shop sign facing road
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w - 1.5, 8), 1.4), new THREE.MeshBasicMaterial({ map: signTexture(d.sign ?? 'SHOP'), transparent: false }))
        sign.position.set(0, 2.6, d.x < 0 ? dep / 2 + 0.06 : -dep / 2 - 0.06)
        if (d.x > 0) sign.rotation.y = Math.PI
        // striped awning
        const awnTex = canvasTex(64, 32, (ctx) => {
          for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#e8e2d0' : '#b54a32'; ctx.fillRect(i * 8, 0, 8, 32) }
        })
        awnTex.repeat.set(Math.max(2, w / 3), 1)
        const awn = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.85, 1.6), new THREE.MeshStandardMaterial({ map: awnTex, side: THREE.DoubleSide, roughness: 1 }))
        awn.position.set(0, 3.6, d.x < 0 ? dep / 2 + 0.7 : -dep / 2 - 0.7)
        awn.rotation.x = d.x < 0 ? -0.5 : 0.5
        if (d.x > 0) { awn.rotation.y = Math.PI }
        g.add(sign, awn)
        break
      }
      case 'stall': {
        const color = ['#b54a32', '#2e6e4e', '#b98a2e', '#7d3b8c'][d.variant ?? 0]
        const counter = new THREE.Mesh(new THREE.BoxGeometry(3, 1.1, 1.6), new THREE.MeshStandardMaterial({ color: '#7a5c3e', flatShading: true }))
        counter.position.y = 0.55
        const top = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.15, 1.9), new THREE.MeshStandardMaterial({ color: '#9c8058' }))
        top.position.y = 1.15
        const awnTex = canvasTex(64, 32, (ctx) => {
          for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#f2ead2' : color; ctx.fillRect(i * 8, 0, 8, 32) }
        })
        const awn = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 2.4), new THREE.MeshStandardMaterial({ map: awnTex }))
        awn.position.y = 2.3
        const pole1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 6), new THREE.MeshStandardMaterial({ color: '#5c4630' }))
        pole1.position.set(1.5, 1.15, 1); const pole2 = pole1.clone(); pole2.position.x = -1.5
        const goods = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshStandardMaterial({ color: '#d9822b', flatShading: true }))
        goods.position.set(0.5, 1.45, 0.2)
        const goods2 = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshStandardMaterial({ color: '#8c1f28', flatShading: true }))
        goods2.position.set(-0.6, 1.4, -0.2)
        if (d.sign) {
          const s = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.7), new THREE.MeshBasicMaterial({ map: signTexture(d.sign, '#f2ead2', '#5a4a2f') }))
          s.position.set(0, 2.65, 1.1)
          g.add(s)
        }
        g.add(counter, top, awn, pole1, pole2, goods, goods2)
        g.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = shadow })
        break
      }
      case 'cart': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 1.4), new THREE.MeshStandardMaterial({ color: '#8a6b45', flatShading: true }))
        body.position.y = 0.85
        const wheel1 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 12), new THREE.MeshStandardMaterial({ color: '#4a3826' }))
        wheel1.rotation.x = Math.PI / 2; wheel1.position.set(0, 0.5, 0.75)
        const wheel2 = wheel1.clone(); wheel2.position.z = -0.75
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), new THREE.MeshStandardMaterial({ color: '#5c4630' }))
        handle.rotation.z = 1.2; handle.position.set(1.5, 1.0, 0.4)
        g.add(body, wheel1, wheel2, handle)
        g.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = shadow })
        break
      }
      case 'teaKettle': {
        const cart = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 1), new THREE.MeshStandardMaterial({ color: '#9c8058', flatShading: true }))
        cart.position.y = 0.7
        const kettle = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshStandardMaterial({ color: '#b54a32', metalness: 0.4, roughness: 0.4 }))
        kettle.position.y = 1.35
        const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.4, 6), new THREE.MeshStandardMaterial({ color: '#b54a32', metalness: 0.4 }))
        spout.rotation.z = 1; spout.position.set(0.3, 1.4, 0)
        const stove = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 8), new THREE.MeshStandardMaterial({ color: '#3a3a3a' }))
        stove.position.set(-0.4, 1.15, 0)
        // steam
        g.add(cart, kettle, spout, stove)
        g.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = shadow })
        break
      }
      case 'tree': {
        const s = d.s ?? 1
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.3 * s, 2.6 * s, 7), new THREE.MeshStandardMaterial({ color: '#6b4f35', flatShading: true }))
        trunk.position.y = 1.3 * s
        const crownColor = d.variant ? '#5c8a4e' : '#6e9a58'
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 * s, 0), new THREE.MeshStandardMaterial({ color: crownColor, flatShading: true }))
        crown.position.y = 3.1 * s
        const crown2 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0 * s, 0), new THREE.MeshStandardMaterial({ color: crownColor, flatShading: true }))
        crown2.position.set(0.6 * s, 2.6 * s, 0.3 * s)
        trunk.castShadow = crown.castShadow = shadow
        g.add(trunk, crown, crown2)
        break
      }
      case 'bench': {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.55), new THREE.MeshStandardMaterial({ color: '#8a6b45' }))
        seat.position.y = 0.5
        const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.08), new THREE.MeshStandardMaterial({ color: '#8a6b45' }))
        back.position.set(0, 0.8, -0.25)
        const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: '#4a3a28' }))
        l1.position.set(0.95, 0.25, 0); const l2 = l1.clone(); l2.position.x = -0.95
        g.add(seat, back, l1, l2)
        g.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = shadow })
        break
      }
      case 'scooter': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 1.5), new THREE.MeshStandardMaterial({ color: ['#2e6e8c', '#b54a32', '#4e7d6b', '#c9a86a'][Math.floor(Math.random() * 4)], metalness: 0.3, roughness: 0.5 }))
        body.position.y = 0.55
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.6), new THREE.MeshStandardMaterial({ color: '#2a2a2a' }))
        seat.position.set(0, 0.78, -0.3)
        const w1 = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 10), new THREE.MeshStandardMaterial({ color: '#1a1a1a' }))
        w1.rotation.z = Math.PI / 2; w1.position.set(0, 0.24, 0.7)
        const w2 = w1.clone(); w2.position.z = -0.65
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: '#333' }))
        handle.position.set(0, 0.85, 0.6)
        g.add(body, seat, w1, w2, handle)
        g.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = shadow })
        break
      }
      case 'fountain': {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.4, 1, 18), new THREE.MeshStandardMaterial({ color: '#c2b280', flatShading: true }))
        base.position.y = 0.5
        const water = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 0.2, 18), new THREE.MeshStandardMaterial({ color: '#4e8ca8', transparent: true, opacity: 0.85, roughness: 0.2, metalness: 0.3 }))
        water.position.y = 0.95
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.2, 10), new THREE.MeshStandardMaterial({ color: '#c2b280' }))
        pillar.position.y = 1.9
        const top = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.5, 0.5, 12), new THREE.MeshStandardMaterial({ color: '#c2b280' }))
        top.position.y = 3.1
        base.castShadow = true
        g.add(base, water, pillar, top)
        // particle water
        const N = 60
        const pos = new Float32Array(N * 3)
        for (let i = 0; i < N; i++) { pos[i * 3] = 0; pos[i * 3 + 1] = 3.2; pos[i * 3 + 2] = 0 }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#9ecfe8', size: 0.12, transparent: true, opacity: 0.8 }))
        this.group.add(g)
        g.add(pts)
        this.fountainParticles = pts
        this.animated.push((t) => {
          const arr = pts.geometry.attributes.position.array as Float32Array
          for (let i = 0; i < N; i++) {
            const seed = i * 0.61
            const f = (t * 0.7 + seed) % 1
            arr[i * 3] = Math.cos(seed * 40) * f * 1.6
            arr[i * 3 + 1] = 3.3 + (1 - f) * 2.2 - f * f * 3.2
            arr[i * 3 + 2] = Math.sin(seed * 40) * f * 1.6
          }
          pts.geometry.attributes.position.needsUpdate = true
        })
        return // skip generic add
      }
      case 'banner': {
        // banner across the street
        const h = 4.4
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 22, 4), new THREE.MeshBasicMaterial({ color: '#3a2d1a' }))
        rope.rotation.z = Math.PI / 2
        rope.position.y = h
        const tex = signTexture(d.sign ?? 'PROTEST', '#e8b13c', '#2c3947')
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.5), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, transparent: true }))
        cloth.position.y = h - 0.8
        const sway = Math.random() * 10
        this.animated.push((t) => { cloth.rotation.z = Math.sin(t * 1.4 + sway) * 0.06; cloth.position.y = h - 0.8 + Math.sin(t * 1.1 + sway) * 0.05 })
        g.add(rope, cloth)
        break
      }
      case 'lamp': {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 5, 6), new THREE.MeshStandardMaterial({ color: '#3a4046' }))
        pole.position.y = 2.5
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: '#3a4046' }))
        arm.position.set(0.35, 5, 0)
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshStandardMaterial({ color: '#ffe9b0', emissive: '#ffb84e', emissiveIntensity: 0.6 }))
        head.position.set(0.7, 4.9, 0)
        pole.castShadow = true
        g.add(pole, arm, head)
        break
      }
      case 'tower': {
        // watchtower
        const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 4.6, 6), new THREE.MeshStandardMaterial({ color: '#6b4f35' }))
        legs.position.y = 2.3
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.8, 2.6), new THREE.MeshStandardMaterial({ color: '#7a5c3e', flatShading: true }))
        cabin.position.y = 5.4
        const roof = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.2, 4), new THREE.MeshStandardMaterial({ color: '#8c1f28', flatShading: true }))
        roof.position.y = 6.9
        roof.rotation.y = Math.PI / 4
        cabin.castShadow = true
        g.add(legs, cabin, roof)
        break
      }
      case 'crate': {
        const s = d.s ?? 1
        const crate = new THREE.Mesh(new THREE.BoxGeometry(1.6 * s, 1.6 * s, 1.6 * s), new THREE.MeshStandardMaterial({ color: '#9c8058', flatShading: true }))
        crate.position.y = 0.8 * s
        crate.castShadow = true
        const edge = new THREE.Mesh(new THREE.BoxGeometry(1.65 * s, 0.12, 1.65 * s), new THREE.MeshStandardMaterial({ color: '#6b5236' }))
        edge.position.y = 1.55 * s
        g.add(crate, edge)
        break
      }
      case 'barrier': {
        const w = d.w ?? 4, dep = d.d ?? 1.6
        for (let i = 0; i < Math.max(1, Math.round(w / 2)); i++) {
          const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 0.08), new THREE.MeshStandardMaterial({ color: '#c9482e', flatShading: true }))
          frame.position.set(-w / 2 + 1 + i * 2, 0.6, 0)
          const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.22, 0.1), new THREE.MeshStandardMaterial({ color: '#f2ead2' }))
          stripe.position.copy(frame.position); stripe.position.y += 0.18
          const legA = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.15, 0.06), new THREE.MeshStandardMaterial({ color: '#7a7a76' }))
          legA.position.set(frame.position.x - 0.8, 0.55, 0.35)
          const legB = legA.clone(); legB.position.z = -0.35
          g.add(frame, stripe, legA, legB)
        }
        break
      }
      case 'monument': {
        const w = d.w ?? 16, h = d.h ?? 14, dep = d.d ?? 16
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), new THREE.MeshStandardMaterial({ color: d.color ?? '#d8cfc0', roughness: 0.8 }))
        body.position.y = h / 2
        body.castShadow = true; body.receiveShadow = true
        g.add(body)
        // dome
        if ((d.variant ?? 0) % 2 === 0 || d.sign) {
          const dome = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, dep) * 0.32, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#7fa8a0', metalness: 0.35, roughness: 0.4 }))
          dome.position.y = h + 0.2
          const spire = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2, 8), new THREE.MeshStandardMaterial({ color: '#c9a86a', metalness: 0.5 }))
          spire.position.y = h + Math.min(w, dep) * 0.32 + 1.1
          g.add(dome, spire)
        }
        // columns
        for (let i = -2; i <= 2; i++) {
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, h * 0.85, 8), new THREE.MeshStandardMaterial({ color: '#e2d8c3' }))
          col.position.set(i * (w / 6), h * 0.42, dep / 2 + 0.5)
          g.add(col)
        }
        if (d.sign) {
          const s = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, 1.6), new THREE.MeshBasicMaterial({ map: signTexture(d.sign, '#e2d8c3', '#5a4a2f') }))
          s.position.set(0, h * 0.8, dep / 2 + 0.6)
          g.add(s)
        }
        break
      }
      case 'flagpole': {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 8, 6), new THREE.MeshStandardMaterial({ color: '#b8b4a8', metalness: 0.6 }))
        pole.position.y = 4
        const flagColors = [['#f5efdc', '#b54a32'], ['#2e6e4e', '#f2c14e'], ['#4e7d6b', '#e8b13c']][d.variant ?? 0]
        const flagTex = canvasTex(64, 40, (ctx) => {
          ctx.fillStyle = flagColors[0]; ctx.fillRect(0, 0, 64, 40)
          ctx.fillStyle = flagColors[1]; ctx.beginPath(); ctx.arc(32, 20, 9, 0, 7); ctx.fill()
        })
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1, 6, 1), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide }))
        flag.position.set(0.9, 7.2, 0)
        this.flags.push(flag)
        g.add(pole, flag)
        break
      }
      case 'billboard':
      case 'hoarding': {
        const post1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 4, 6), new THREE.MeshStandardMaterial({ color: '#4a4038' }))
        post1.position.set(-1.6, 2, 0)
        const post2 = post1.clone(); post2.position.x = 1.6
        const board = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.4, 0.15), new THREE.MeshStandardMaterial({ color: '#f2ead2' }))
        board.position.y = 5
        const face = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.2), new THREE.MeshBasicMaterial({ map: signTexture(d.sign ?? 'VOTECHOR', '#2c3947', '#f2c14e') }))
        face.position.set(0, 5, 0.09)
        board.castShadow = true
        g.add(post1, post2, board, face)
        const face2 = face.clone(); face2.rotation.y = Math.PI; face2.position.z = -0.09
        g.add(face2)
        break
      }
      case 'planter': {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.6, 0.7, 8), new THREE.MeshStandardMaterial({ color: '#b3543a', flatShading: true }))
        pot.position.y = 0.35
        const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 0), new THREE.MeshStandardMaterial({ color: '#5c8a4e', flatShading: true }))
        bush.position.y = 1.15
        g.add(pot, bush)
        break
      }
      case 'stage': {
        const deck = new THREE.Mesh(new THREE.BoxGeometry(8, 1.2, 8), new THREE.MeshStandardMaterial({ color: '#8a6b45', flatShading: true }))
        deck.position.y = 0.6
        const back = new THREE.Mesh(new THREE.BoxGeometry(8, 3.4, 0.3), new THREE.MeshStandardMaterial({ color: '#b54a32' }))
        back.position.set(0, 2.6, -3.8)
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.1), new THREE.MeshBasicMaterial({ map: signTexture('CHAUPAL — PEOPLE\'S STAGE', '#b54a32', '#f5efdc') }))
        banner.position.set(0, 3.2, -3.6)
        deck.receiveShadow = true
        g.add(deck, back, banner)
        break
      }
      case 'toilet': {
        const shed = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2), new THREE.MeshStandardMaterial({ color: '#7d8a6b', flatShading: true }))
        shed.position.y = 1.2
        const roof = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.15, 2.4), new THREE.MeshStandardMaterial({ color: '#4a5a48' }))
        roof.position.y = 2.5
        g.add(shed, roof)
        break
      }
    }
    this.group.add(g)
  }

  private buildCrowd(world: WorldDef, quality: 'low' | 'medium' | 'high') {
    const crowd = world.decorations.filter(d => d.kind === 'crowd')
    if (!crowd.length) return
    const count = quality === 'low' ? Math.floor(crowd.length * 0.5) : crowd.length
    const bodies = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.22, 0.3, 1.05, 6),
      new THREE.MeshStandardMaterial({ flatShading: true }),
      count,
    )
    const heads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.15, 6, 5),
      new THREE.MeshStandardMaterial({ color: '#c68a5c', flatShading: true }),
      count,
    )
    const m = new THREE.Matrix4()
    const color = new THREE.Color()
    const shirtColors = ['#2f9e6e', '#d9822b', '#7ea8d8', '#b54a32', '#e6e0d2', '#8c4a5e']
    let placed = 0
    for (let i = 0; i < crowd.length && placed < count; i++) {
      const c = crowd[i]
      const bob = Math.random() * 0.05
      m.makeTranslation(c.x, 0.62 + bob, c.z)
      bodies.setMatrixAt(placed, m)
      color.set(shirtColors[(c.variant ?? i) % shirtColors.length])
      bodies.setColorAt(placed, color)
      m.makeTranslation(c.x, 1.28 + bob, c.z)
      heads.setMatrixAt(placed, m)
      placed++
      if (c.sign) {
        // small sign group (max ~15 textured signs)
        if (this.crowdSigns.length < 16) {
          const sg = new THREE.Group()
          const board = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.45), new THREE.MeshBasicMaterial({ map: signTexture(c.sign, '#f5efdc', '#8c1f28'), side: THREE.DoubleSide }))
          board.position.set(0, 1.55, 0)
          sg.add(board)
          sg.position.set(c.x, 0, c.z)
          sg.rotation.y = (c.ry ?? 0) + Math.PI
          this.crowdSigns.push(sg)
          this.group.add(sg)
        }
      }
    }
    bodies.count = placed
    heads.count = placed
    bodies.castShadow = quality === 'high'
    this.group.add(bodies, heads)
    this.crowdBodies = bodies
    this.crowdHeads = heads
  }

  private buildSearchlights() {
    for (const sl of this.world.searchlights) {
      const grp = new THREE.Group()
      grp.position.set(sl.x, 5.6, sl.z)
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(2.6, 18, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: '#ffe9a0', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
      )
      cone.rotation.x = Math.PI / 2 - 0.6
      cone.position.set(0, 0, 9)
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.8, 8), new THREE.MeshStandardMaterial({ color: '#3a4046' }))
      housing.rotation.x = Math.PI / 2 - 0.6
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.42, 10), new THREE.MeshBasicMaterial({ color: '#fff3c4' }))
      lens.position.set(0, 0, 0.42)
      lens.rotation.x = -0.3
      housing.add(lens)
      grp.add(cone, housing)
      this.group.add(grp)
      this.searchlightCones.push(cone)
      this.searchlightGroups.push(grp)
      cone.userData.baseRotation = cone.rotation.x
    }
  }

  private buildCheckpointGates() {
    for (const cp of this.world.checkpoints) {
      const g = new THREE.Group()
      g.position.set(cp.x, 0, cp.z)
      for (const side of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 6.5, 8), new THREE.MeshStandardMaterial({ color: '#c2b280', flatShading: true }))
        pillar.position.set(side * 8.5, 3.25, 0)
        pillar.castShadow = true
        g.add(pillar)
        const top = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 8), new THREE.MeshStandardMaterial({ color: '#7fa8a0', metalness: 0.4 }))
        top.position.set(side * 8.5, 6.7, 0)
        g.add(top)
      }
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.6), new THREE.MeshBasicMaterial({ map: signTexture(`CHECKPOINT ${cp.id} — ${cp.name.toUpperCase()}`, '#2e6e4e', '#f5efdc'), side: THREE.DoubleSide }))
      banner.position.set(0, 6, 0)
      g.add(banner)
      this.group.add(g)
    }
  }

  private buildBossArena() {
    const a = this.world.bossArena
    const g = new THREE.Group()
    g.position.set(a.x, 0, a.z)
    // circular stone plaza
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(a.radius, a.radius + 2, 0.3, 40), new THREE.MeshStandardMaterial({ color: '#cfc4ab', roughness: 0.9 }))
    plaza.position.y = 0.1
    plaza.receiveShadow = true
    const ring = new THREE.Mesh(new THREE.TorusGeometry(a.radius - 1, 0.35, 8, 48), new THREE.MeshStandardMaterial({ color: '#b54a32' }))
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.28
    // podium for boss
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 1.2, 24), new THREE.MeshStandardMaterial({ color: '#b8ab8d' }))
    podium.position.set(0, 0.6, -14)
    podium.receiveShadow = true
    // giant ballot box (phase 5 deposit)
    const box = new THREE.Mesh(new THREE.BoxGeometry(3, 3.4, 3), new THREE.MeshStandardMaterial({ color: '#2e6e4e', flatShading: true }))
    box.position.set(0, 1.9, -12)
    const slot = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.4), new THREE.MeshStandardMaterial({ color: '#1c1a17' }))
    slot.position.set(0, 3.2, -10.6)
    box.castShadow = true
    g.add(plaza, ring, podium, box, slot)
    // boss gate pillars + energy barrier
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 9, 1.6), new THREE.MeshStandardMaterial({ color: '#8c1f28', flatShading: true }))
      pillar.position.set(side * 10, 4.5, a.gateZ - a.z)
      pillar.castShadow = true
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshStandardMaterial({ color: '#ffb84e', emissive: '#ff7b2e', emissiveIntensity: 1.4 }))
      lamp.position.set(side * 10, 9.6, a.gateZ - a.z)
      g.add(pillar, lamp)
    }
    const gate = new THREE.Mesh(
      new THREE.PlaneGeometry(18.4, 8.4, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#ff5c3a', transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
    )
    gate.position.set(0, 4.2, a.gateZ - a.z)
    this.bossGate = gate
    g.add(gate)
    // barrier stripes warning
    const warnTex = canvasTex(128, 32, (ctx) => {
      for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#f2c14e' : '#1c1a17'; ctx.fillRect(i * 16, 0, 16, 32) }
    })
    warnTex.repeat.set(6, 1)
    const warn = new THREE.Mesh(new THREE.PlaneGeometry(22, 1), new THREE.MeshBasicMaterial({ map: warnTex }))
    warn.rotation.x = -Math.PI / 2
    warn.position.set(0, 0.06, a.gateZ - a.z + 4)
    g.add(warn)
    // crowd ring around arena (instanced)
    const N = 64
    const bodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.3, 1.05, 6), new THREE.MeshStandardMaterial({ flatShading: true }), N)
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 6, 5), new THREE.MeshStandardMaterial({ color: '#c68a5c', flatShading: true }), N)
    const m = new THREE.Matrix4()
    const col = new THREE.Color()
    const shirts = ['#2f9e6e', '#d9822b', '#7ea8d8', '#b54a32', '#e6e0d2']
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2
      const r = a.radius + 2.5
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r
      const bob = Math.sin(i * 2.3) * 0.05
      m.makeTranslation(x, 0.62 + bob, z)
      bodies.setMatrixAt(i, m)
      col.set(shirts[i % shirts.length])
      bodies.setColorAt(i, col)
      m.makeTranslation(x, 1.28 + bob, z)
      heads.setMatrixAt(i, m)
    }
    g.add(bodies, heads)
    this.group.add(g)
    this.animated.push((t) => {
      if (this.bossGate && this.bossGate.visible) {
        const mm = this.bossGate.material as THREE.MeshBasicMaterial
        mm.opacity = 0.24 + Math.sin(t * 3) * 0.1
      }
      // ballot box glow
      const em = 0.5 + Math.sin(t * 2.4) * 0.3
      const boxMat = box.material as THREE.MeshStandardMaterial
      boxMat.emissive.setRGB(0.1 * em, 0.4 * em, 0.2 * em)
    })
  }

  private buildDust() {
    const N = 140
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 90
      pos[i * 3 + 1] = 0.5 + Math.random() * 8
      pos[i * 3 + 2] = Math.random() * -580
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#e8d5a8', size: 0.18, transparent: true, opacity: 0.35, depthWrite: false }))
    this.group.add(dust)
    this.animated.push((_t, dt) => {
      const arr = geo.attributes.position.array as Float32Array
      for (let i = 0; i < N; i++) {
        arr[i * 3] += Math.sin(i + performance.now() * 0.0002) * dt * 0.4
        arr[i * 3 + 1] += dt * 0.12
        if (arr[i * 3 + 1] > 9) arr[i * 3 + 1] = 0.5
      }
      geo.attributes.position.needsUpdate = true
    })
  }

  setBossGateOpen(open: boolean) {
    if (this.bossGate) this.bossGate.visible = !open
  }

  update(dt: number, t: number, searchlightRys?: Record<string, number>) {
    for (const fn of this.animated) fn(t, dt)
    // flag wave (cheap vertex-less: skew via rotation)
    for (const f of this.flags) f.rotation.y = Math.sin(t * 2.2 + f.position.x) * 0.14
    // searchlight rotation from server sim
    if (searchlightRys) {
      for (let i = 0; i < this.searchlightGroups.length; i++) {
        const sl = this.world.searchlights[i]
        const ry = searchlightRys[sl.id]
        if (ry !== undefined) {
          this.searchlightGroups[i].rotation.y = ry
        }
      }
    }
    // crowd subtle sway
    if (this.crowdBodies) this.crowdBodies.rotation.y = Math.sin(t * 0.5) * 0.004
  }
}
