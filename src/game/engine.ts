// VoteChor engine core — renderer, scene, sky, lighting, adaptive quality, main loop.
import * as THREE from 'three'

export type QualityLevel = 'low' | 'medium' | 'high'

export class Engine {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  quality: QualityLevel = 'high'
  pixelRatio = 1
  private accum = 0
  private last = performance.now()
  private frames = 0
  private fpsTime = 0
  onFixedUpdate: ((dt: number) => void) | null = null
  onRender: ((dt: number, alpha: number) => void) | null = null
  onFps: ((fps: number) => void) | null = null
  private running = false
  private canvas: HTMLCanvasElement
  private disposed = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // photo-mode snapshot support (canvas.toDataURL)
    })
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0xe8d5b0, 60, 210)

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 420)

    // Warm late-afternoon Indian sky
    this.hemi = new THREE.HemisphereLight(0xfff3dd, 0xc4a37a, 0.85)
    this.scene.add(this.hemi)
    this.sun = new THREE.DirectionalLight(0xffe0b0, 2.1)
    this.sun.position.set(60, 90, 30)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55
    sc.near = 10; sc.far = 260
    this.sun.shadow.bias = -0.0004
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)

    this.scene.add(this.buildSky())
    this.resize()
  }

  private buildSky(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(380, 24, 12)
    const canvas = document.createElement('canvas')
    canvas.width = 64; canvas.height = 256
    const ctx = canvas.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, 0, 256)
    g.addColorStop(0, '#7fb2d9')
    g.addColorStop(0.45, '#f2d9a8')
    g.addColorStop(0.72, '#f7c98b')
    g.addColorStop(1, '#e8b184')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 256)
    // a few clouds
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    for (let i = 0; i < 14; i++) {
      const y = 30 + Math.random() * 80
      ctx.beginPath(); ctx.ellipse(Math.random() * 64, y, 10 + Math.random() * 14, 4 + Math.random() * 5, 0, 0, 7); ctx.fill()
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = -10
    return mesh
  }

  setQuality(q: 'low' | 'medium' | 'high' | 'auto') {
    let level: QualityLevel = q as QualityLevel
    if (q === 'auto') {
      const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4
      const cores = navigator.hardwareConcurrency ?? 4
      level = cores >= 8 && mem >= 8 ? 'high' : cores >= 4 ? 'medium' : 'low'
    }
    this.quality = level
    this.pixelRatio = level === 'high' ? Math.min(window.devicePixelRatio, 2) : level === 'medium' ? Math.min(window.devicePixelRatio, 1.35) : 1
    this.renderer.setPixelRatio(this.pixelRatio)
    this.renderer.shadowMap.enabled = level !== 'low'
    if (level !== 'low') {
      this.sun.shadow.mapSize.set(level === 'high' ? 2048 : 1024, level === 'high' ? 2048 : 1024)
      this.sun.shadow.map?.dispose()
      this.sun.shadow.map = null
    }
    this.resize()
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }

  /** Keep the sun + shadow frustum centered on the player as they travel down the map */
  trackSun(target: THREE.Vector3) {
    this.sun.position.set(target.x + 55, 90, target.z + 35)
    this.sun.target.position.set(target.x, 0, target.z)
    this.sun.target.updateMatrixWorld()
  }

  start() {
    if (this.running) return
    this.running = true
    const fixed = 1 / 60
    const loop = () => {
      if (this.disposed) return
      requestAnimationFrame(loop)
      const now = performance.now()
      let dt = (now - this.last) / 1000
      this.last = now
      dt = Math.min(dt, 0.1)
      this.accum += dt
      let alpha = 0
      let steps = 0
      while (this.accum >= fixed && steps < 5) {
        this.onFixedUpdate?.(fixed)
        this.accum -= fixed
        steps++
        alpha = this.accum / fixed
      }
      this.onRender?.(dt, alpha)
      this.renderer.render(this.scene, this.camera)
      // fps
      this.frames++
      this.fpsTime += dt
      if (this.fpsTime >= 0.5) {
        this.onFps?.(this.frames / this.fpsTime)
        this.frames = 0
        this.fpsTime = 0
      }
    }
    requestAnimationFrame(loop)
  }

  stop() { this.running = false }
  dispose() {
    this.disposed = true
    this.stop()
    this.renderer.dispose()
  }
}
