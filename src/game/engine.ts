// VoteChor engine core — renderer, scene, sky, lighting, adaptive quality, main loop.
import * as THREE from 'three'
import { SkySystem } from './sky'

export type QualityLevel = 'auto' | 'low' | 'medium' | 'high'
export type ResolvedQuality = 'low' | 'medium' | 'high' // concrete tier after 'auto' probes the device

/** Per-frame cost breakdown — averaged over the same 0.5s window that drives the FPS readout. */
export interface EngineFrameStats {
  fps: number
  frameMs: number // rAF delta (browser-observed frame time)
  fixedMs: number // fixed-step simulation time per frame (physics/AI/gameplay JS)
  renderJsMs: number // onRender callback time (camera, animators, minimap canvas, HUD sync)
  drawMs: number // renderer.render() wall time (CPU submit + GL wait, incl. shadow pass)
  drawCalls: number // main + shadow-pass draw calls per frame (renderer.info)
  triangles: number
  programs: number // compiled shader programs (compile stalls show up here)
  geometries: number
  textures: number
  shadowEvery: number // current shadow-update cadence (1 = every frame)
}

function makeStats(): EngineFrameStats {
  return { fps: 0, frameMs: 0, fixedMs: 0, renderJsMs: 0, drawMs: 0, drawCalls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0, shadowEvery: 1 }
}

export class Engine {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  /** Soft shadowless fill from the opposite azimuth — lifts dark faces/sides for depth. */
  fill: THREE.DirectionalLight
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
  /** Frame-cost diagnostics (0.5s window averages) — HUD perf chip + QA tooling read this. */
  stats: EngineFrameStats = makeStats()
  /**
   * Shadow-map update throttle. false = every frame (three default). true = re-render the
   * shadow map only every Nth frame (N adapts to fps: 50+ → every 2nd, 30+ → every 3rd,
   * below → every 4th). Sun/moon move slowly and characters barely displace within 2-4
   * frames, so the visual delta is imperceptible while the whole shadow pass is skipped
   * on the other frames. Gameplay/physics are never throttled by this.
   */
  shadowThrottle = false
  /** v50 — false = skip the GL submit entirely. The main menu / loading screens are
   * OPAQUE full-screen paper UIs, so rendering the whole city (4k+ draw calls,
   * 260k triangles) behind them is pure GPU/battery burn that also kept the device
   * hot between matches. The game layer flips this every frame; in-match modes
   * (playing/paused/ended) always render, menu-like modes never do. */
  renderEnabled = true
  private frameIdx = 0
  private running = false
  private canvas: HTMLCanvasElement
  private disposed = false
  // ---- render-fault telemetry (device-specific GL failures must surface, not vanish) ----
  /** Last frame-phase exception (fixed step / render JS / GL draw) — surfaced on the HUD + diagnostics. */
  lastError: { phase: 'fixed' | 'render' | 'draw'; message: string; at: number } | null = null
  /** True between a webglcontextlost event and a successful restore. */
  contextLost = false
  /** Game-layer hooks: show a visible recovery banner / record diagnostics. */
  onError: ((phase: 'fixed' | 'render' | 'draw', message: string) => void) | null = null
  onContextLost: (() => void) | null = null
  onContextRestored: (() => void) | null = null
  private onCtxLost = (e: Event) => {
    e.preventDefault() // allow restore
    this.contextLost = true
    this.onContextLost?.()
  }
  private onCtxRestored = () => {
    this.contextLost = false
    this.onContextRestored?.()
  }
  // 0.5s window accumulators for the stats averages
  private accFrames = 0
  private accFrameMs = 0
  private accFixedMs = 0
  private accRenderJsMs = 0
  private accDrawMs = 0
  private accDrawCalls = 0
  private accTriangles = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance',
      stencil: false, // no stencil consumers — saves a full-screen buffer
      preserveDrawingBuffer: true, // EXACT config of commit 5b08baf ("v25"), the build the
      // affected device confirmed working — some GPU drivers mis-composite canvases without
      // it. Cost is negligible on modern hardware; photo snapshots also read the buffer directly.
    })
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0xe8d5b0, 60, 210) // sky system rewrites color/distance every frame

    // v70 — far 420 → 1050: the disc is 930 m across and the Vanodyan Rim skyline
    // (fog-immune, cull-exempt) must render from anywhere on it.
    // v71 — far 1050 → 1400: the FAR RANGE backdrop must clear the far plane.
    // v72 — far 1400 → 1600: the grown world (disc r 650, Far Range 690..770 from
    // center −340) spans ~1490 m corner-to-corner — the far plane must clear it
    // when the skyline is viewed from the opposite rim.
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1600)

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

    // shadowless counter-fill — keeps shadowed faces readable (depth without flatness)
    this.fill = new THREE.DirectionalLight(0xfff0e0, 0.3)
    this.fill.castShadow = false
    this.scene.add(this.fill)

    this.sky = new SkySystem(this.scene, 'high', this.hemi, this.sun)
    // GPU context loss can happen on memory pressure / driver resets — without these
    // listeners the canvas just goes blank with no trace of why. preventDefault keeps
    // the restore path alive so the renderer can rebuild its GL state.
    canvas.addEventListener('webglcontextlost', this.onCtxLost, false)
    canvas.addEventListener('webglcontextrestored', this.onCtxRestored, false)
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

  /** Shadow re-render cadence from the current fps (only used when shadowThrottle is on). */
  private shadowCadence(): number {
    const fps = this.fpsEma
    if (fps >= 50) return 2
    if (fps >= 30) return 3
    return 4
  }

  /** Fold the 0.5s window accumulators into the public stats object. */
  private finalizeStats(fps: number) {
    const n = Math.max(1, this.accFrames)
    const info = this.renderer.info
    const s = this.stats
    s.fps = fps
    s.frameMs = this.accFrameMs / n
    s.fixedMs = this.accFixedMs / n
    s.renderJsMs = this.accRenderJsMs / n
    s.drawMs = this.accDrawMs / n
    s.drawCalls = Math.round(this.accDrawCalls / n)
    s.triangles = Math.round(this.accTriangles / n)
    s.programs = info.programs?.length ?? 0
    s.geometries = info.memory.geometries
    s.textures = info.memory.textures
    s.shadowEvery = this.shadowThrottle && this.renderer.shadowMap.enabled ? this.shadowCadence() : 1
    this.accFrames = 0; this.accFrameMs = 0; this.accFixedMs = 0
    this.accRenderJsMs = 0; this.accDrawMs = 0; this.accDrawCalls = 0; this.accTriangles = 0
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
    // mirror the key light to the opposite azimuth, a bit lower — classic 3-point fill
    this.fill.position.set(target.x - d.x * 80, target.y + 55, target.z - d.z * 80)
    this.fill.intensity = Math.min(0.55, this.sun.intensity * 0.11 + this.hemi.intensity * 0.14)
  }

  start() {
    if (this.running) return
    this.running = true
    const fixed = 1 / 60
    const loop = () => {
      if (this.disposed) return
      requestAnimationFrame(loop)
      const now = performance.now()
      const rawDt = (now - this.last) / 1000 // REAL elapsed — fps/stats must not be clamped
      this.last = now
      const dt = Math.min(rawDt, 0.1) // simulation dt is clamped; wall-clock fps is not
      this.accum += dt
      let alpha = 0
      let steps = 0
      const t0 = performance.now()
      while (this.accum >= fixed && steps < 5) {
        try { this.onFixedUpdate?.(fixed) } catch (err) {
          // a throwing fixed step must not skip the accumulator drain or the render
          this.lastError = { phase: 'fixed', message: String((err as Error)?.message ?? err), at: Date.now() }
          this.onError?.('fixed', this.lastError.message)
        }
        this.accum -= fixed
        steps++
        alpha = this.accum / fixed
      }
      const t1 = performance.now()
      try { this.onRender?.(dt, alpha) } catch (err) {
        this.lastError = { phase: 'render', message: String((err as Error)?.message ?? err), at: Date.now() }
        this.onError?.('render', this.lastError.message)
      }
      const t2 = performance.now()
      // throttled shadow cadence: only mark the shadow map dirty every Nth frame
      this.frameIdx++
      if (this.renderEnabled && this.shadowThrottle && this.renderer.shadowMap.enabled) {
        const every = this.shadowCadence()
        this.renderer.shadowMap.autoUpdate = false
        this.renderer.shadowMap.needsUpdate = every <= 1 || this.frameIdx % every === 0
      }
      // v50 — opaque-UI frames skip the whole GL submit (see renderEnabled)
      if (!this.renderEnabled) {
        this.accFrames++
        this.accFrameMs += rawDt * 1000
        this.frames++
        this.fpsTime += rawDt
        if (this.fpsTime >= 0.5) {
          const fps = this.frames / this.fpsTime
          this.onFps?.(fps)
          this.finalizeStats(fps)
          this.frames = 0
          this.fpsTime = 0
        }
        return
      }
      try { this.renderer.render(this.scene, this.camera) } catch (err) {
        // GPU-side failures (shader compile on exotic drivers, context faults) used to
        // kill the frame silently — record + surface so the user sees a recovery path
        this.lastError = { phase: 'draw', message: String((err as Error)?.message ?? err), at: Date.now() }
        this.onError?.('draw', this.lastError.message)
      }
      const t3 = performance.now()
      // window accumulators (averaged into stats at the 0.5s fps sample)
      this.accFrames++
      this.accFrameMs += rawDt * 1000
      this.accFixedMs += t1 - t0
      this.accRenderJsMs += t2 - t1
      this.accDrawMs += t3 - t2
      const info = this.renderer.info
      this.accDrawCalls += info.render.calls
      this.accTriangles += info.render.triangles
      // fps — REAL wall-clock frames per second (the sim dt clamp must not fake this)
      this.frames++
      this.fpsTime += rawDt
      if (this.fpsTime >= 0.5) {
        const fps = this.frames / this.fpsTime
        this.onFps?.(fps)
        this.adaptResolution(fps)
        this.finalizeStats(fps)
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
    this.canvas.removeEventListener('webglcontextlost', this.onCtxLost, false)
    this.canvas.removeEventListener('webglcontextrestored', this.onCtxRestored, false)
    this.sky.dispose()
    // full teardown: free every geometry/material/texture left in the scene so a
    // fresh Game/Engine pair never inherits GPU memory from the previous match
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined
      const kill = (x: THREE.Material) => {
        const map = (x as unknown as { map?: THREE.Texture | null }).map
        if (map) map.dispose()
        x.dispose()
      }
      if (Array.isArray(m)) m.forEach(kill)
      else if (m) kill(m)
    })
    this.scene.clear()
    this.renderer.dispose()
  }
}
