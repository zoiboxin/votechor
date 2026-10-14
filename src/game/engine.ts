// VoteChor engine core — renderer, scene, sky, lighting, adaptive quality, main loop.
import * as THREE from 'three'
import { SkySystem } from './sky'

export type QualityLevel = 'auto' | 'low' | 'medium' | 'high'
export type ResolvedQuality = 'low' | 'medium' | 'high' // concrete tier after 'auto' probes the device

export class Engine {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  sky: SkySystem
  quality: QualityLevel = 'auto'
  pixelRatio = 1
  /** Current render resolution scale — adaptive when quality==='auto' (HUD perf chip reads this). */
  effectivePixelRatio = 1
  /** Why the current effective pixel ratio was chosen (auto ladder step or manual tier). */
  resReason = 'boot'
  // adaptive-resolution state (auto quality only)
  private resLadder: number[] = [1]
  private resIdx = 0
  private fpsEma = 60
  private lowStreak = 0
  private highStreak = 0
  private lastResStep = 0
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
    this.scene.fog = new THREE.Fog(0xe8d5b0, 60, 210) // sky system rewrites color/distance every frame

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

    this.sky = new SkySystem(this.scene, 'high', this.hemi, this.sun)
    this.resize()
  }

  setQuality(q: QualityLevel) {
    this.quality = q
    let level: ResolvedQuality
    if (q === 'auto') {
      const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4
      const cores = navigator.hardwareConcurrency ?? 4
      level = cores >= 8 && mem >= 8 ? 'high' : cores >= 4 ? 'medium' : 'low'
    } else {
      level = q
    }
    const dpr = window.devicePixelRatio
    this.pixelRatio = level === 'high' ? Math.min(dpr, 2) : level === 'medium' ? Math.min(dpr, 1.35) : 1
    this.renderer.shadowMap.enabled = level !== 'low'
    if (level !== 'low') {
      this.sun.shadow.mapSize.set(level === 'high' ? 2048 : 1024, level === 'high' ? 2048 : 1024)
      this.sun.shadow.map?.dispose()
      this.sun.shadow.map = null
    }
    this.sky.setQuality(level)
    if (q === 'auto') {
      // Adaptive resolution: start at full 'high' ratio and walk a ladder down/up to hold
      // ~45-57 fps. renderer.setPixelRatio only fires on actual ladder steps (min 2s apart).
      const start = Math.min(dpr, 2)
      this.resLadder = [start, 1.5, 1.25, 1, 0.85, 0.7].filter(
        (v, i, arr) => v <= start + 1e-6 && (i === 0 || v < arr[i - 1] - 1e-6),
      )
      this.resIdx = 0
      this.fpsEma = 60
      this.lowStreak = 0
      this.highStreak = 0
      this.lastResStep = performance.now()
      this.effectivePixelRatio = this.resLadder[0]
      this.resReason = 'auto: full res'
      this.renderer.setPixelRatio(this.effectivePixelRatio)
    } else {
      // manual tiers keep the classic fixed-ratio behavior (controller off)
      this.effectivePixelRatio = this.pixelRatio
      this.resReason = `manual ${level}`
      this.renderer.setPixelRatio(this.pixelRatio)
    }
    this.resize()
  }

  /** Every 0.5s fps sample: smooth into a ~2s EMA and step the resolution ladder. */
  private adaptResolution(fps: number) {
    if (this.quality !== 'auto' || this.resLadder.length <= 1) return
    this.fpsEma += (fps - this.fpsEma) * 0.25 // ~2s EMA at 0.5s samples
    const now = performance.now()
    const canStep = now - this.lastResStep >= 2000 // anti-oscillation guard
    if (this.fpsEma < 45) {
      this.lowStreak++
      this.highStreak = 0
      if (this.lowStreak >= 3 && canStep && this.resIdx < this.resLadder.length - 1) {
        this.resIdx++
        this.applyResolution(`auto: fps ${Math.round(this.fpsEma)} ↓ res ${this.resLadder[this.resIdx].toFixed(2)}`)
        this.lowStreak = 0
      }
    } else if (this.fpsEma > 57) {
      this.highStreak++
      this.lowStreak = 0
      if (this.highStreak >= 6 && canStep && this.resIdx > 0) {
        this.resIdx--
        this.applyResolution(`auto: fps ${Math.round(this.fpsEma)} ↑ res ${this.resLadder[this.resIdx].toFixed(2)}`)
        this.highStreak = 0
      }
    } else {
      this.lowStreak = 0
      this.highStreak = 0
    }
  }

  private applyResolution(reason: string) {
    this.effectivePixelRatio = this.resLadder[this.resIdx]
    this.lastResStep = performance.now()
    this.resReason = reason
    this.renderer.setPixelRatio(this.effectivePixelRatio)
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }

  /** Keep the shadow-casting light centered on the player; direction comes from the sky (sun by day, moon by night) */
  trackSun(target: THREE.Vector3) {
    const d = this.sky.lightDir
    this.sun.position.set(target.x + d.x * 110, target.y + d.y * 110, target.z + d.z * 110)
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
        const fps = this.frames / this.fpsTime
        this.onFps?.(fps)
        this.adaptResolution(fps)
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
    this.sky.dispose()
    this.renderer.dispose()
  }
}
