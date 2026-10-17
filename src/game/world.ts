// VoteChor world renderer — builds the 3D city from shared WorldDef data.
// Procedural canvas textures, instanced crowd, animated props. No external assets.
import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { WorldDef, Deco } from './shared/types'

const ZONE_COLORS = ['#c96f4a', '#b85c3e', '#7f9a8c', '#c9a86a', '#9a7b5f']

// ---- v37 realistic trees: one merged vertex-colored geometry per variant (cached,
// ~1 draw call per tree vs 3 before) — tapered leaning trunk, branches reaching into
// a layered canopy of foliage clumps with per-vertex color variation. ----
const treeGeoCache = new Map<number, THREE.BufferGeometry>()
const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 })

/** Fill a geometry's color attribute from a per-vertex color function (x,y,z → color). */
function treePaint(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => THREE.Color): THREE.BufferGeometry {
  const pos = g.attributes.position
  const arr = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const col = fn(pos.getX(i), pos.getY(i), pos.getZ(i))
    arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  g.deleteAttribute('uv')
  return g
}
/** Deterministic foliage jitter (hash of position) so cached geometry is stable. */
function jitterColor(base: THREE.Color, x: number, y: number, z: number, amt: number): THREE.Color {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
  const f = 1 + ((h - Math.floor(h)) - 0.5) * amt
  return new THREE.Color(
    Math.min(1, base.r * f),
    Math.min(1, base.g * f),
    Math.min(1, base.b * f),
  )
}

function getTreeGeo(variant: number): THREE.BufferGeometry {
  const hit = treeGeoCache.get(variant)
  if (hit) return hit
  const parts: THREE.BufferGeometry[] = []
  const barkLo = new THREE.Color('#43301f')
  const barkHi = new THREE.Color('#6f5138')
  // trunk — tapered, slight lean, vertical bark gradient
  const tall = variant === 1
  const trunkH = tall ? 3.0 : 2.5
  const trunk = new THREE.CylinderGeometry(tall ? 0.11 : 0.13, tall ? 0.22 : 0.26, trunkH, 7)
  trunk.translate(0, trunkH / 2, 0)
  trunk.rotateZ(tall ? -0.04 : 0.03)
  parts.push(treePaint(trunk, (_x, y) => barkLo.clone().lerp(barkHi, Math.min(1, Math.max(0, y / trunkH)))))
  // branches reaching into the canopy
  const branchSpec: Array<[number, number, number, number]> = tall
    ? [[0.5, 0.09, 0.28, trunkH * 0.78], [-0.62, 0.1, -0.2, trunkH * 0.62]]           // rz, rx, z offset, y
    : [[0.55, 0.12, 0.3, trunkH * 0.8], [-0.6, 0.14, -0.25, trunkH * 0.72], [0.1, -0.5, 0.45, trunkH * 0.68]]
  for (const [rz, rx, zoff, by] of branchSpec) {
    const br = new THREE.CylinderGeometry(0.05, 0.085, 1.15, 5)
    br.translate(0, 0.575, 0)
    br.rotateZ(rz); br.rotateX(rx)
    br.translate(0, by, zoff)
    parts.push(treePaint(br, () => barkHi.clone().multiplyScalar(0.9)))
  }
  // layered canopy — foliage clumps, darker low / lighter high, squashed vertically
  const leafLo = new THREE.Color(tall ? '#4a7440' : '#4e7a42')
  const leafMid = new THREE.Color(tall ? '#5c8a4e' : '#5c8a4e')
  const leafHi = new THREE.Color(tall ? '#86a05a' : '#6e9a58')
  const blobs: Array<[number, number, number, number, THREE.Color]> = tall
    ? [
        [0, 4.05, 0, 1.0, leafMid],
        [0.58, 3.5, 0.18, 0.68, leafLo],
        [-0.56, 3.62, -0.22, 0.74, leafLo],
        [0.05, 4.75, -0.05, 0.72, leafHi],
      ]
    : [
        [0, 3.45, 0, 1.28, leafMid],
        [0.92, 3.0, 0.32, 0.84, leafLo],
        [-0.86, 3.05, -0.26, 0.9, leafLo],
        [0.1, 3.1, -0.95, 0.8, leafLo],
        [-0.26, 3.2, 0.92, 0.74, leafMid],
        [0.05, 4.28, -0.05, 0.9, leafHi],
      ]
  for (const [bx, by, bz, r, col] of blobs) {
    const blob = new THREE.IcosahedronGeometry(r, 1)
    blob.scale(1, 0.85, 1)
    blob.translate(bx, by, bz)
    parts.push(treePaint(blob, (x, y, z) => jitterColor(col, x, y, z, 0.14)))
  }
  const norm = parts.map(p => (p.index ? p : (mergeVertices(p, 1e-4) ?? p)))
  const geo = mergeGeometries(norm, false) ?? parts[0]
  if (geo !== parts[0]) for (const p of norm) p.dispose()
  geo.computeVertexNormals()
  treeGeoCache.set(variant, geo)
  geo.userData.vcShared = true // v43: survives WorldRenderer.dispose() — reused by rebuilt worlds
  return geo
}

// v43 district tinting: the canvas textures stay the classic colors — a multiply
// color on the material shifts them per map without new texture uploads.
function tintRatio(hex: string, base: string): THREE.Color {
  const t = new THREE.Color(hex), b = new THREE.Color(base)
  return new THREE.Color(
    Math.min(2, Math.max(0.05, t.r / Math.max(0.01, b.r))),
    Math.min(2, Math.max(0.05, t.g / Math.max(0.01, b.g))),
    Math.min(2, Math.max(0.05, t.b / Math.max(0.01, b.b))),
  )
}

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeatX, repeatY)
  // crisp texture filtering: trilinear mipmaps + anisotropic sampling kills the
  // smeary blur on roads/ground at grazing angles (three clamps to device max)
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.anisotropy = 8
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

// matching emissive map: same window grid, but only the rooms that are awake at night
// glow warm/cool. Driven by worldRenderer.setNight() — black by day, city lights at dusk.
function windowEmissiveTexture(variant: number): THREE.CanvasTexture {
  return canvasTex(128, 128, (ctx) => {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 128, 128)
    const cols = variant === 2 ? 3 : 4
    const rows = 4
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (Math.random() < 0.42) continue // dark room — nobody home
        const x = 10 + c * (108 / cols), y = 12 + r * 28
        const roll = Math.random()
        ctx.fillStyle = roll < 0.62 ? '#ffbe6e' : roll < 0.86 ? '#ffd696' : '#a8ccf0'
        ctx.fillRect(x, y, 108 / cols - 12, 18)
        // half-drawn curtains on a few
        if (Math.random() < 0.18) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x, y, 108 / cols - 12, 8) }
      }
    }
  })
}

// soft radial blob used for lamp head halos + ground light pools
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128; c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62)
  g.addColorStop(0, 'rgba(255,214,140,0.9)')
  g.addColorStop(0.35, 'rgba(255,190,110,0.38)')
  g.addColorStop(1, 'rgba(255,180,90,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
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
  private searchlightMats: THREE.MeshBasicMaterial[] = []
  private bossGate: THREE.Mesh | null = null
  private animated: ((t: number, dt: number) => void)[] = []
  private fountainParticles: THREE.Points | null = null
  private flags: THREE.Mesh[] = []
  private crowdBodies: THREE.InstancedMesh | null = null
  private crowdHeads: THREE.InstancedMesh | null = null
  private crowdSigns: THREE.Group[] = []

  // ---- night / street-light state ----
  private nightF = 0
  private lampHeadMats: { m: THREE.MeshStandardMaterial; base: number }[] = []   // deco + boss-gate lamp bulbs
  private instHeadMat = new THREE.MeshStandardMaterial({ color: '#ffe9b0', emissive: '#ffc866', emissiveIntensity: 0.5 })
  private glowMat = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  private coneMat = new THREE.MeshBasicMaterial({ color: '#ffcf8a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
  private poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  private windowMats: THREE.MeshStandardMaterial[] = []      // building emissive windows
  // ---- road-hazard visibility: obstacles must read clearly day AND night ----
  // retroreflective hazard tape on barricades (glows under street lights at night)
  private hazardStripeMat = new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: '#ffd9a0', emissiveIntensity: 0.18, roughness: 0.55 })
  private hazardFrameMat = new THREE.MeshStandardMaterial({ color: '#d94f30', emissive: '#c9482e', emissiveIntensity: 0.05, roughness: 0.85 })
  // market-stall / food-cart lanterns — night bazaar glow so road-edge props read after dark
  private lanternMat = new THREE.MeshStandardMaterial({ color: '#f7c66a', emissive: '#ffab3d', emissiveIntensity: 0.45 })
  private lanternHaloMat = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  private lightPositions: THREE.Vector3[] = []               // every street lamp bulb in the world
  private lightPool: THREE.PointLight[] = []                 // real lights, re-parked near the player
  private poolTimer = 0
  private camPos = new THREE.Vector3(0, 0, 0)

  constructor(world: WorldDef, quality: 'low' | 'medium' | 'high') {
    this.world = world
    this.buildGround()
    this.buildRoads()
    for (const d of world.decorations) this.buildDeco(d)
    this.buildHomes(world)
    this.buildWalls(world)
    this.buildExtraStreetLamps()
    this.buildCrowd(world, quality)
    this.buildSearchlights()
    this.buildCheckpointGates()
    this.buildBossArena()
    this.buildDust()
    this.buildLightPool(quality)
  }

  /**
   * v43 world swaps — free every GPU resource this renderer built. The module
   * cached tree geometries are tagged `vcShared` and survive (the next build
   * reuses them); everything else (geometries, materials, per-build canvas
   * textures) is disposed. All scene content lives inside this.group.
   */
  dispose() {
    this.group.removeFromParent()
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.geometry && !mesh.geometry.userData?.vcShared) mesh.geometry.dispose()
      const mat = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] | undefined
      if (Array.isArray(mat)) {
        for (const m of mat) { m.map?.dispose(); m.dispose() }
      } else if (mat) {
        mat.map?.dispose()
        const emi = (mat as THREE.MeshStandardMaterial).emissiveMap
        if (emi && emi !== mat.map) emi.dispose()
        mat.dispose()
      }
    })
    this.animated = []
    this.searchlightCones = []
    this.searchlightGroups = []
    this.searchlightMats = []
    this.bossGate = null
    this.fountainParticles = null
    this.flags = []
    this.crowdBodies = null
    this.crowdHeads = null
    this.crowdSigns = []
    this.lampHeadMats = []
    this.windowMats = []
    this.lightPositions = []
    this.lightPool = []
  }

  private buildGround() {
    // Base ground — dusty warm earth (v43: tinted per district via material color ratio)
    const tint = this.world.groundTint ?? '#c9a97c'
    const tex = canvasTex(256, 256, (ctx) => {
      ctx.fillStyle = '#c9a97c'
      ctx.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = ['#c2a171', '#d1b285', '#bd9c6f', '#c7a87b'][i % 4]
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 3, 3)
      }
    }, 86, 60)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 640),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1, color: tintRatio(tint, '#c9a97c') }),
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
      new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95, color: tintRatio(this.world.roadTint ?? '#6d675f', '#6d675f') }),
    )
    road.rotation.x = -Math.PI / 2
    road.position.set(0, 0.01, -275)
    road.receiveShadow = true
    this.group.add(road)

    // Avenue widening (zone D)
    const road2 = new THREE.Mesh(
      new THREE.PlaneGeometry(38, 150),
      new THREE.MeshStandardMaterial({ map: roadTex.clone(), roughness: 0.95, color: tintRatio(this.world.roadTint ?? '#6d675f', '#6d675f') }),
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

    // East-west cross streets — asphalt + sidewalks, split around the main road
    const roadTint = tintRatio(this.world.roadTint ?? '#6d675f', '#6d675f')
    for (const cr of this.world.crossRoads) {
      const tex = roadTex.clone()
      tex.repeat.set(1, 22)
      const road = new THREE.Mesh(
        new THREE.PlaneGeometry(cr.halfW * 2, 228),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, color: roadTint }),
      )
      road.rotation.x = -Math.PI / 2
      road.rotation.z = Math.PI / 2 // lay the strip's length (and its dashes) along X
      road.position.set(0, 0.008, cr.z)
      road.receiveShadow = true
      this.group.add(road)
      // sidewalk strips (x -114..-12 and 12..114, leaving the junction open)
      for (const edge of [-1, 1]) {
        const swt = swTex.clone()
        swt.repeat.set(26, 1)
        const swMat = new THREE.MeshStandardMaterial({ map: swt, roughness: 1 })
        for (const half of [-1, 1]) {
          const sw = new THREE.Mesh(new THREE.PlaneGeometry(102, 4), swMat)
          sw.rotation.x = -Math.PI / 2
          sw.position.set(half * 63, 0.02, cr.z + edge * (cr.halfW + 2))
          sw.receiveShadow = true
          this.group.add(sw)
        }
      }
    }
  }

  private buildDeco(d: Deco) {
    // homes + compound walls are rendered by dedicated instanced builders below
    if (d.kind === 'home' || d.kind === 'wall') return
    const g = new THREE.Group()
    g.position.set(d.x, d.y ?? 0, d.z)
    if (d.ry) g.rotation.y = d.ry
    const shadow = true
    switch (d.kind) {
      case 'building': {
        const w = d.w ?? 10, dep = d.d ?? 8, h = d.h ?? 10
        const tex = windowTexture(d.color ?? '#c96f4a', d.variant ?? 0)
        tex.repeat.set(Math.max(1, Math.round(w / 5)), Math.max(1, Math.round(h / 6)))
        const emi = windowEmissiveTexture(d.variant ?? 0)
        emi.repeat.copy(tex.repeat)
        const mat = new THREE.MeshStandardMaterial({
          map: tex, roughness: 0.9,
          emissive: 0xffffff, emissiveMap: emi, emissiveIntensity: 0, // lit windows at night
        })
        this.windowMats.push(mat)
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), mat)
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
        // hanging lantern — night-bazaar beacon so stalls read as road-edge obstacles after dark
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), this.lanternMat)
        lantern.position.set(-1.2, 1.95, 0.6)
        const lanternHalo = new THREE.Sprite(this.lanternHaloMat)
        lanternHalo.scale.set(1.5, 1.5, 1)
        lanternHalo.position.copy(lantern.position)
        const lantern2 = lantern.clone(); lantern2.position.x = 1.2
        const lanternHalo2 = lanternHalo.clone(); lanternHalo2.position.x = 1.2
        g.add(lantern, lantern2, lanternHalo, lanternHalo2)
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
        // lantern on a stub pole — carts sit IN the lanes, they must stay visible
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5), new THREE.MeshStandardMaterial({ color: '#5c4630' }))
        pole.position.set(-0.9, 1.25, -0.4)
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), this.lanternMat)
        lantern.position.set(-0.9, 1.74, -0.4)
        const lanternHalo = new THREE.Sprite(this.lanternHaloMat)
        lanternHalo.scale.set(1.4, 1.4, 1)
        lanternHalo.position.copy(lantern.position)
        g.add(body, wheel1, wheel2, handle, pole, lantern, lanternHalo)
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
        // stove ember + hanging lantern — the chai stall glows at night
        const emberMat = new THREE.MeshStandardMaterial({ color: '#c9482e', emissive: '#ff6a2a', emissiveIntensity: 0.7 })
        const ember = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 8), emberMat)
        ember.position.set(-0.4, 1.33, 0)
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), this.lanternMat)
        lantern.position.set(0.55, 1.55, 0.3)
        const lanternHalo = new THREE.Sprite(this.lanternHaloMat)
        lanternHalo.scale.set(1.3, 1.3, 1)
        lanternHalo.position.copy(lantern.position)
        // steam
        g.add(cart, kettle, spout, stove, ember, lantern, lanternHalo)
        g.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = shadow })
        break
      }
      case 'tree': {
        const s = d.s ?? 1
        const tree = new THREE.Mesh(getTreeGeo(d.variant ?? 0), treeMat)
        tree.scale.setScalar(s)
        tree.castShadow = shadow
        g.add(tree)
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
      // ---- v43 level-map landmark props (district variants) ----
      case 'stringLights': {
        // festival lights strung between two poles across the road; bulbs dim by
        // day and glow at night via the shared lamp-head registry
        const len = d.w ?? 19.6
        const poleMat = new THREE.MeshStandardMaterial({ color: '#4a4038', roughness: 0.9 })
        const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.2, 6), poleMat)
        p1.position.set(-len / 2, 2.6, 0)
        p1.castShadow = true
        const p2 = p1.clone(); p2.position.x = len / 2
        const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff6dd', emissive: d.color ?? '#ffbe55', emissiveIntensity: 0.9 })
        this.lampHeadMats.push({ m: bulbMat, base: 0.9 })
        const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 6, 5), bulbMat, 24)
        const m4 = new THREE.Matrix4()
        for (let i = 0; i < 24; i++) {
          const f = (i + 0.5) / 24
          m4.setPosition(-len / 2 + f * len, 4.9 - Math.sin(f * Math.PI) * 0.55, 0) // gentle sag
          bulbs.setMatrixAt(i, m4)
        }
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, len, 4), new THREE.MeshBasicMaterial({ color: '#2c2620' }))
        wire.rotation.z = Math.PI / 2
        wire.position.y = 4.9
        g.add(p1, p2, wire, bulbs)
        break
      }
      case 'archGate': {
        // welcome arch straddling the avenue: legs off the asphalt, banner span overhead
        const w = d.w ?? 20.4, h = d.h ?? 6.2
        const col = d.color ?? '#b23a48'
        const legMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 })
        const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.9), legMat)
        leg1.position.set(-w / 2, h / 2, 0)
        leg1.castShadow = true
        const leg2 = leg1.clone(); leg2.position.x = w / 2
        const span = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, 1.2), legMat)
        span.position.y = h + 0.4
        span.castShadow = true
        const face = new THREE.Mesh(
          new THREE.PlaneGeometry(Math.min(w - 4, 14), 0.9),
          new THREE.MeshBasicMaterial({ map: signTexture(d.sign ?? 'WELCOME', col, '#f5efdc'), side: THREE.DoubleSide }),
        )
        face.position.set(0, h + 0.42, 0.65)
        const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.16, 1.4), new THREE.MeshStandardMaterial({ color: '#f2c14e', emissive: '#c98a2a', emissiveIntensity: 0.25 }))
        trim.position.y = h + 1.0
        g.add(leg1, leg2, span, face, trim)
        break
      }
      case 'ferrisWheel': {
        // THE finale landmark — a lit ferris wheel, cabins staying upright as it turns
        const R = 11
        const col = d.color ?? '#b23a48'
        const wheelG = new THREE.Group() // spins in its own plane
        wheelG.position.y = 13
        const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.32, 8, 30), new THREE.MeshStandardMaterial({ color: col, roughness: 0.7 }))
        const rim2 = new THREE.Mesh(new THREE.TorusGeometry(R, 0.1, 6, 30), new THREE.MeshStandardMaterial({ color: '#f2c14e', emissive: '#c98a2a', emissiveIntensity: 0.5 }))
        wheelG.add(rim, rim2)
        const spokeMat = new THREE.MeshStandardMaterial({ color: '#8a5c3e', roughness: 0.85 })
        for (let i = 0; i < 8; i++) {
          const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, R * 2, 5), spokeMat)
          sp.rotation.z = (i / 8) * Math.PI
          wheelG.add(sp)
        }
        const cabinMat = new THREE.MeshStandardMaterial({ color: '#f2c14e', emissive: '#c98a2a', emissiveIntensity: 0.35, roughness: 0.6 })
        const cabins: THREE.Mesh[] = []
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2
          const holder = new THREE.Group()
          holder.position.set(Math.cos(a) * R, Math.sin(a) * R, 0)
          const cab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 1.0), cabinMat)
          cab.position.y = -0.85
          cab.castShadow = true
          holder.add(cab)
          wheelG.add(holder)
          cabins.push(cab)
        }
        // A-frame support (in the XZ plane — wheel faces the avenue east-west)
        const legMat = new THREE.MeshStandardMaterial({ color: '#8a5c3e', roughness: 0.9 })
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 14.4, 6), legMat)
            leg.position.set(sx * 1.6, 7, sz * 2.6)
            leg.rotation.x = sz * 0.2
            leg.rotation.z = sx * -0.22
            leg.castShadow = true
            g.add(leg)
          }
        }
        const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 3.6, 8), spokeMat)
        axle.rotation.x = Math.PI / 2
        axle.position.y = 13
        // wheel plane faces the road: build in XY then yaw 90°
        const yaw = new THREE.Group()
        yaw.rotation.y = Math.PI / 2
        yaw.add(wheelG)
        this.animated.push((_t, dt) => {
          wheelG.rotation.z += dt * 0.14
          for (let i = 0; i < 8; i++) cabins[i].rotation.z = -wheelG.rotation.z - (i / 8) * Math.PI * 2
        })
        g.add(yaw, axle)
        break
      }
      case 'crane': {
        // gantry crane silhouette for the depot district — slow trolley drift
        const col = d.color ?? '#c9622e'
        const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 })
        for (const sx of [-3.4, 3.4]) {
          for (const sz of [-1.6, 1.6]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 13, 0.5), mat)
            leg.position.set(sx, 6.5, sz)
            leg.castShadow = true
            g.add(leg)
          }
        }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.8, 2.2), mat)
        beam.position.y = 13.2
        beam.castShadow = true
        const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.4), new THREE.MeshStandardMaterial({ color: '#4a5a6a', roughness: 0.7 }))
        cab.position.y = 12.1
        const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.4, 4), new THREE.MeshBasicMaterial({ color: '#2c2620' }))
        hook.position.y = 10.4
        const hookTrolley = new THREE.Group()
        hookTrolley.add(cab, hook)
        hookTrolley.position.x = 2.2
        g.add(beam, hookTrolley)
        this.animated.push((t) => { hookTrolley.position.x = Math.sin(t * 0.22) * 2.8 })
        break
      }
      case 'lamp': {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 5, 6), new THREE.MeshStandardMaterial({ color: '#3a4046' }))
        pole.position.y = 2.5
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: '#3a4046' }))
        arm.position.set(0.35, 5, 0)
        const headMat = new THREE.MeshStandardMaterial({ color: '#ffe9b0', emissive: '#ffc866', emissiveIntensity: 0.5 })
        this.lampHeadMats.push({ m: headMat, base: 0.5 })
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), headMat)
        head.position.set(0.7, 4.9, 0)
        pole.castShadow = true
        g.add(pole, arm, head)
        // night halo + downlight cone; world position recorded for the light pool
        const ry = d.ry ?? 0
        const hx = d.x + Math.cos(ry) * 0.7, hz = d.z - Math.sin(ry) * 0.7
        const halo = new THREE.Sprite(this.glowMat)
        halo.position.set(hx, 4.9, hz)
        halo.scale.set(2.6, 2.6, 1)
        this.group.add(halo)
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1.7, 4.8, 10, 1, true), this.coneMat)
        cone.position.set(hx, 2.5, hz)
        this.group.add(cone)
        const poolG = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 5.2), this.poolMat)
        poolG.rotation.x = -Math.PI / 2
        poolG.position.set(hx, 0.045, hz)
        this.group.add(poolG)
        this.lightPositions.push(new THREE.Vector3(hx, 4.7, hz))
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
      case 'clothesline': {
        // laundry strung between two bamboo poles across a gali — sways in the wind
        const len = d.w ?? 6
        const poleMat = new THREE.MeshStandardMaterial({ color: '#6b5236', flatShading: true })
        const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.3, 6), poleMat)
        p1.position.set(-len / 2, 1.15, 0)
        const p2 = p1.clone(); p2.position.x = len / 2
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, len, 4), new THREE.MeshBasicMaterial({ color: '#3a2d1a' }))
        rope.rotation.z = Math.PI / 2
        rope.position.y = 2.15
        g.add(p1, p2, rope)
        const clothColors = ['#c95a8c', '#5a8cc9', '#e8d5a8', '#7ec97e', '#e8b13c']
        for (let i = 0; i < 4; i++) {
          const cloth = new THREE.Mesh(
            new THREE.PlaneGeometry(0.6, 0.75),
            new THREE.MeshStandardMaterial({ color: clothColors[(i + (d.variant ?? 0)) % clothColors.length], side: THREE.DoubleSide, roughness: 1 }),
          )
          cloth.position.set(-len / 2 + (len / 5) * (i + 1), 1.72, 0)
          const phase = Math.random() * 9
          this.animated.push((t) => { cloth.rotation.x = Math.sin(t * 1.7 + phase) * 0.22 })
          g.add(cloth)
        }
        break
      }
      case 'barrier': {
        const w = d.w ?? 4, dep = d.d ?? 1.6
        // long checkpoint fence lines use wider frame spacing to stay cheap
        const spacing = w > 24 ? 4 : 2
        const frames = Math.max(1, Math.round(w / spacing))
        for (let i = 0; i < frames; i++) {
          const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 0.12), this.hazardFrameMat)
          frame.position.set(-w / 2 + (i + 0.5) * (w / frames), 0.6, 0)
          // two reflective tape bands (top + bottom) — readable edge-on and at night
          const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.2, 0.14), this.hazardStripeMat)
          stripe.position.copy(frame.position); stripe.position.y += 0.2
          const stripe2 = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 0.14), this.hazardStripeMat)
          stripe2.position.copy(frame.position); stripe2.position.y -= 0.3
          const legA = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.15, 0.07), new THREE.MeshStandardMaterial({ color: '#5f5f5b' }))
          legA.position.set(frame.position.x - 0.8, 0.55, 0.35)
          const legB = legA.clone(); legB.position.z = -0.35
          g.add(frame, stripe, stripe2, legA, legB)
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

  /**
   * Round-19 mohalla homes — every small house in the side blocks is rendered with
   * just 4 draw calls: instanced plaster bodies, instanced roofs (pitched + flat),
   * and ONE merged geometry carrying every door/window/shutter quad with a shared
   * atlas (night emissive drives the lit windows like the big buildings).
   */
  private buildHomes(world: WorldDef) {
    const homes = world.decorations.filter(d => d.kind === 'home')
    if (!homes.length) return
    const n = homes.length

    // shared textures ---------------------------------------------------------
    const plaster = canvasTex(128, 128, (ctx) => {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, 128, 128)
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = `rgba(${90 + Math.random() * 60},${70 + Math.random() * 50},${50 + Math.random() * 40},${0.05 + Math.random() * 0.06})`
        ctx.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 3, 2 + Math.random() * 3)
      }
      // weathering streaks under the roofline
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = 'rgba(60,50,40,0.08)'
        ctx.fillRect(Math.random() * 128, 0, 2 + Math.random() * 3, 20 + Math.random() * 30)
      }
    })
    const atlas = canvasTex(256, 256, (ctx) => {
      // cell 0 (top-left): wooden door
      ctx.fillStyle = '#7a5230'; ctx.fillRect(0, 0, 128, 128)
      ctx.fillStyle = '#8f6238'; for (let i = 0; i < 4; i++) ctx.fillRect(10 + i * 28, 8, 22, 112)
      ctx.strokeStyle = '#4a3320'; ctx.lineWidth = 5; ctx.strokeRect(6, 4, 116, 120)
      ctx.fillStyle = '#e8c96a'; ctx.beginPath(); ctx.arc(112, 68, 5, 0, 7); ctx.fill()
      // cell 1 (top-right): window with panes
      ctx.fillStyle = '#b8a488'; ctx.fillRect(128, 0, 128, 128)
      ctx.fillStyle = '#31404f'; ctx.fillRect(140, 12, 104, 100)
      ctx.strokeStyle = '#b8a488'; ctx.lineWidth = 8
      ctx.beginPath(); ctx.moveTo(192, 12); ctx.lineTo(192, 112); ctx.moveTo(140, 62); ctx.lineTo(244, 62); ctx.stroke()
      ctx.strokeRect(140, 12, 104, 100)
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(140, 12, 104, 12)
      // cell 2 (bottom-left): grilled window
      ctx.fillStyle = '#a89478'; ctx.fillRect(0, 128, 128, 128)
      ctx.fillStyle = '#3a4a58'; ctx.fillRect(12, 140, 104, 100)
      ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 4
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(20 + i * 22, 140); ctx.lineTo(20 + i * 22, 240); ctx.stroke() }
      ctx.strokeRect(12, 140, 104, 100)
      // cell 3 (bottom-right): closed wooden shutter
      ctx.fillStyle = '#9c8058'; ctx.fillRect(128, 128, 128, 128)
      ctx.fillStyle = '#8a6b45'; for (let i = 0; i < 6; i++) ctx.fillRect(136, 136 + i * 18, 112, 12)
      ctx.strokeStyle = '#5c4630'; ctx.lineWidth = 5; ctx.strokeRect(132, 132, 120, 120)
    })
    const night = canvasTex(256, 256, (ctx) => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 256, 256)
      // warm lit windows in cells 1 & 2 (a few panes stay dark), door/shutter stay dark
      ctx.fillStyle = '#ffb45e'; ctx.fillRect(140, 12, 46, 100)
      ctx.fillStyle = '#ffd696'; ctx.fillRect(198, 12, 46, 48)
      ctx.fillStyle = '#c98a4e'; ctx.fillRect(198, 62, 46, 50)
      ctx.fillStyle = '#e8a45e'; ctx.fillRect(12, 140, 104, 100)
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; for (let i = 0; i < 5; i++) if (Math.random() < 0.4) ctx.fillRect(20 + i * 22, 140, 10, 100)
    })
    atlas.colorSpace = THREE.SRGBColorSpace
    night.colorSpace = THREE.SRGBColorSpace

    // instanced bodies --------------------------------------------------------
    const bodyGeo = new THREE.BoxGeometry(1, 1, 1)
    bodyGeo.translate(0, 0.5, 0)
    const bodyMat = new THREE.MeshStandardMaterial({ map: plaster, roughness: 1 })
    const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, n)
    bodies.castShadow = true
    bodies.receiveShadow = true

    const wedge = new THREE.CylinderGeometry(1, 1, 1, 3, 1)
    wedge.rotateZ(Math.PI / 2) // prism axis along X, ridge up
    const roofMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true })
    const flatGeo = new THREE.BoxGeometry(1, 1, 1)
    const roofPitched: { i: number; x: number; z: number; w: number; d: number; h: number; ry: number; c: THREE.Color }[] = []
    const roofFlat: typeof roofPitched = []

    // merged openings ---------------------------------------------------------
    const openGeos: THREE.BufferGeometry[] = []
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const eu = new THREE.Euler()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    const col = new THREE.Color()

    const quad = (w: number, h: number, cell: number, x: number, y: number, z: number, ry: number) => {
      const geo = new THREE.PlaneGeometry(w, h)
      const cu = cell % 2, cv = Math.floor(cell / 2)
      const uv = geo.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, cu * 0.5 + uv.getX(i) * 0.5, (1 - (cv + 1) * 0.5) + uv.getY(i) * 0.5)
      }
      eu.set(0, ry, 0)
      m4.compose(pos.set(x, y, z), q.setFromEuler(eu), scl.set(1, 1, 1))
      geo.applyMatrix4(m4)
      openGeos.push(geo)
    }

    for (let i = 0; i < n; i++) {
      const d = homes[i]
      const w = d.w ?? 6, dep = d.d ?? 6, h = d.h ?? 3.5
      const ry = d.ry ?? 0
      col.set(d.color ?? '#d8c49a')
      eu.set(0, ry, 0)
      m4.compose(pos.set(d.x, 0, d.z), q.setFromEuler(eu), scl.set(w, h, dep))
      bodies.setMatrixAt(i, m4)
      bodies.setColorAt(i, col)

      // roof
      if ((d.variant ?? 0) % 2 === 0) {
        roofPitched.push({ i, x: d.x, z: d.z, w: w * 1.16, d: dep * 0.62, h, ry, c: new THREE.Color(['#b5543a', '#a34a34', '#8c5a3c', '#9c8058', '#7a5a48'][i % 5]) })
      } else {
        roofFlat.push({ i, x: d.x, z: d.z, w: w + 0.5, d: dep + 0.5, h, ry, c: new THREE.Color(['#b8b0a0', '#a8a094', '#96897a'][i % 3]) })
      }

      // local→world transform for opening quads (home rotation applied by hand)
      const cos = Math.cos(ry), sin = Math.sin(ry)
      const toWorld = (lx: number, lz: number): [number, number] => [d.x + lx * cos + lz * sin, d.z - lx * sin + lz * cos]
      // front (+z local) and back (−z) faces
      const doorCell = 0
      // front door
      {
        const [wx, wz] = toWorld(0, dep / 2 + 0.04)
        quad(1.1, 2.1, doorCell, wx, 1.05, wz, ry)
      }
      // front windows (skip if a door row home — keep, homes look better with windows)
      const wy = Math.min(h - 1.1, 2.55)
      for (const sx of [-1, 1]) {
        const [wx, wz] = toWorld(sx * w * 0.28, dep / 2 + 0.04)
        quad(0.85, 0.95, i % 3 === 1 ? 2 : 1, wx, wy, wz, ry)
        if (h >= 5) {
          const [ux, uz] = toWorld(sx * w * 0.28, dep / 2 + 0.04)
          quad(0.8, 0.9, i % 4 === 3 ? 3 : 2, ux, h - 1.25, uz, ry)
        }
      }
      // back face: one window (shutter on some)
      {
        const [wx, wz] = toWorld(0, -dep / 2 - 0.04)
        quad(0.9, 0.95, i % 3 === 2 ? 3 : 1, wx, wy, wz, ry + Math.PI)
      }
      // side walls — windows into the galis
      for (const sx of [-1, 1]) {
        const [wx, wz] = toWorld(sx * (w / 2 + 0.04), dep * 0.08)
        quad(0.8, 0.9, (i + 1) % 4 === 3 ? 3 : 2, wx, wy, wz, ry + sx * Math.PI / 2)
      }
    }
    bodies.instanceMatrix.needsUpdate = true
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true
    this.group.add(bodies)

    const setRoofs = (list: typeof roofPitched, mesh: THREE.InstancedMesh, pitched: boolean) => {
      for (let k = 0; k < list.length; k++) {
        const r = list[k]
        eu.set(0, r.ry, 0)
        if (pitched) {
          m4.compose(pos.set(r.x, r.h + 0.5, r.z), q.setFromEuler(eu), scl.set(r.w, 0.95, r.d * 0.9))
        } else {
          m4.compose(pos.set(r.x, r.h + 0.16, r.z), q.setFromEuler(eu), scl.set(r.w, 0.32, r.d))
        }
        mesh.setMatrixAt(k, m4)
        mesh.setColorAt(k, r.c)
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      this.group.add(mesh)
    }
    if (roofPitched.length) setRoofs(roofPitched, new THREE.InstancedMesh(wedge, roofMat, roofPitched.length), true)
    if (roofFlat.length) {
      const flatGeoT = flatGeo
      flatGeoT.translate(0, 0.5, 0)
      setRoofs(roofFlat, new THREE.InstancedMesh(flatGeoT, roofMat, roofFlat.length), false)
    }

    // one merged mesh for ALL doors/windows/shutters + night emissive
    if (openGeos.length) {
      const merged = mergeGeometries(openGeos, false)
      if (merged) {
        const openMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.9, emissive: 0xffffff, emissiveMap: night, emissiveIntensity: 0 })
        this.windowMats.push(openMat)
        const mesh = new THREE.Mesh(merged, openMat)
        mesh.castShadow = false
        this.group.add(mesh)
      }
      for (const g of openGeos) g.dispose()
    }
  }

  /** Instanced compound/courtyard walls (vaultable 1.1m) — one draw call. */
  private buildWalls(world: WorldDef) {
    const walls = world.decorations.filter(d => d.kind === 'wall')
    if (!walls.length) return
    const geo = new THREE.BoxGeometry(1, 1, 1)
    geo.translate(0, 0.5, 0)
    const mat = new THREE.MeshStandardMaterial({ roughness: 1 })
    const mesh = new THREE.InstancedMesh(geo, mat, walls.length)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const col = new THREE.Color()
    const tints = ['#cfc0a0', '#c2b494', '#d8ccae', '#b8ab8d']
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i]
      m.compose(new THREE.Vector3(w.x, 0, w.z), q, new THREE.Vector3(w.w ?? 4, w.h ?? 1.1, w.d ?? 0.4))
      mesh.setMatrixAt(i, m)
      col.set(tints[i % tints.length])
      mesh.setColorAt(i, col)
    }
    mesh.receiveShadow = true
    this.group.add(mesh)
  }

  /**
   * Dense instanced street lamps lining both curbs for the whole map — the deco lamps
   * above are too sparse to carry a night scene. 3 draw calls for ~60 lamps.
   */
  private buildExtraStreetLamps() {
    const spots: { x: number; z: number; ry: number }[] = []
    // march down the road, alternating curbs, arm always pointing toward the road
    let z = 2
    let side = 1
    while (z > -578) {
      const x = side * 9.7
      const ry = side > 0 ? Math.PI : 0
      // skip anything too close to an authored deco lamp
      const clash = this.lightPositions.some(p => Math.abs(p.x - x) < 5 && Math.abs(p.z - z) < 7)
      if (!clash) spots.push({ x, z, ry })
      z -= 23
      side *= -1
    }
    // cross streets: alternate curbs marching east→west, arms toward the road center
    for (const cr of this.world.crossRoads) {
      let x = -108
      let cside = 1
      while (x <= 108) {
        if (Math.abs(x) > 13) {
          spots.push({ x, z: cr.z + cside * (cr.halfW + 0.5), ry: cside > 0 ? Math.PI / 2 : -Math.PI / 2 })
        }
        x += 26
        cside *= -1
      }
    }
    if (!spots.length) return
    const n = spots.length
    const darkMat = new THREE.MeshStandardMaterial({ color: '#3a4046' })
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 5, 6), darkMat, n)
    const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.06, 0.06), darkMat, n)
    const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.18, 8, 6), this.instHeadMat, n)
    const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 4.8, 10, 1, true), this.coneMat, n)
    const poolG = new THREE.InstancedMesh(new THREE.PlaneGeometry(5.2, 5.2), this.poolMat, n)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const one = new THREE.Vector3(1, 1, 1)
    for (let i = 0; i < n; i++) {
      const s = spots[i]
      e.set(0, s.ry, 0); q.setFromEuler(e)
      m.compose(new THREE.Vector3(s.x, 2.5, s.z), q, one); pole.setMatrixAt(i, m)
      m.compose(new THREE.Vector3(s.x + Math.cos(s.ry) * 0.35, 5, s.z - Math.sin(s.ry) * 0.35), q, one); arm.setMatrixAt(i, m)
      const hx = s.x + Math.cos(s.ry) * 0.7, hz = s.z - Math.sin(s.ry) * 0.7
      m.compose(new THREE.Vector3(hx, 4.9, hz), q, one); head.setMatrixAt(i, m)
      m.compose(new THREE.Vector3(hx, 2.5, hz), q, one); cone.setMatrixAt(i, m)
      m.compose(new THREE.Vector3(hx + Math.cos(s.ry) * 0.15, 0.045, hz - Math.sin(s.ry) * 0.15), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), one); poolG.setMatrixAt(i, m)
      this.lightPositions.push(new THREE.Vector3(hx, 4.7, hz))
    }
    pole.castShadow = true
    this.group.add(pole, arm, head, cone, poolG)
  }

  /** A small pool of REAL point lights that silently re-park onto the nearest lamps.
   *  Lights stay in the scene permanently (intensity 0 by day) — toggling visibility
   *  would force a full material recompile at every dusk/dawn. */
  private buildLightPool(quality: 'low' | 'medium' | 'high') {
    const count = quality === 'high' ? 8 : quality === 'medium' ? 5 : 3
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffb46a, 0, 17, 1.7)
      l.castShadow = false
      this.lightPool.push(l)
      this.group.add(l)
    }
  }

  /** Called every frame from game.ts with the sky's night factor + player focus. */
  setNight(nf: number, camPos: THREE.Vector3) {
    this.nightF = nf
    this.camPos.copy(camPos)
    const headE = 0.5 + 2.1 * nf
    for (const e of this.lampHeadMats) e.m.emissiveIntensity = e.base + 2.1 * nf
    this.instHeadMat.emissiveIntensity = headE
    this.glowMat.opacity = 0.85 * nf
    this.coneMat.opacity = 0.16 * nf
    this.poolMat.opacity = 0.42 * nf
    const winE = 1.15 * nf
    for (const m of this.windowMats) m.emissiveIntensity = winE
    // road hazards read at night: retroreflective tape + lantern glows
    this.hazardStripeMat.emissiveIntensity = 0.18 + 1.7 * nf
    this.hazardFrameMat.emissiveIntensity = 0.05 + 0.5 * nf
    this.lanternMat.emissiveIntensity = 0.45 + 2.3 * nf
    this.lanternHaloMat.opacity = 0.55 * nf
    // searchlights read better against a dark sky
    for (const m of this.searchlightMats) m.opacity = 0.16 + 0.15 * nf
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
      this.searchlightMats.push(cone.material as THREE.MeshBasicMaterial)
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
      this.lampHeadMats.push({ m: lamp.material as THREE.MeshStandardMaterial, base: 1.4 })
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
    const N = 160
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 230
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

    // ---- street light pool: re-park real lights onto the nearest lamps at ~3Hz ----
    if (this.lightPool.length && this.lightPositions.length) {
      this.poolTimer -= dt
      if (this.poolTimer <= 0) {
        this.poolTimer = 0.35
        const cam = this.camPos
        // partial selection: K nearest bulbs (N is ~80 — a simple scan is fine)
        const k = this.lightPool.length
        const idx = this.lightPositions
          .map((p, i) => ({ i, d: (p.x - cam.x) * (p.x - cam.x) + (p.z - cam.z) * (p.z - cam.z) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, k)
        for (let j = 0; j < k; j++) {
          const l = this.lightPool[j]
          const src = this.lightPositions[idx[j].i]
          l.position.set(src.x, src.y, src.z)
          l.userData.phase = idx[j].i * 1.7
        }
      }
      const base = 30 * this.nightF
      for (let j = 0; j < this.lightPool.length; j++) {
        const l = this.lightPool[j]
        // faint sodium-vapor shimmer so the glow feels alive
        l.intensity = base * (1 + 0.055 * Math.sin(t * 43 + (l.userData.phase ?? j * 7.3)))
      }
    }
  }
}
