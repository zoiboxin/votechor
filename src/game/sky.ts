// VoteChor atmosphere — shader sky dome (sun disc + glow + horizon haze), moon, stars,
// drifting cloud sprites, GPU rain, lightning flashes, fog + lighting driven by a
// full day/night cycle and a weather state machine (clear → cloudy → overcast →
// monsoon rain → thunderstorm → fog). Purely client-side ambience.
import * as THREE from 'three'
import type { ResolvedQuality } from './engine'

export type WeatherKind = 'clear' | 'cloudy' | 'overcast' | 'rain' | 'storm' | 'fog'
export type TimeMode = 'cycle' | 'dawn' | 'noon' | 'dusk' | 'night'
export type WeatherMode = 'auto' | WeatherKind

interface WeatherDef {
  label: string
  cloudOp: number   // 0..1 cloud sprite opacity
  cloudDark: number // 0..1 how dark/stormy clouds are
  rain: number      // 0..1 rain intensity
  fogMul: number    // multiplies base fog distances
  sunMult: number   // multiplies sun light
  wind: number      // cloud drift + rain slant
  lightning: number // strikes per second (probability accumulator)
}

const WEATHER: Record<WeatherKind, WeatherDef> = {
  clear:    { label: 'Clear Skies',  cloudOp: 0.32, cloudDark: 0.0,  rain: 0,    fogMul: 1.0,  sunMult: 1.0,  wind: 0.22, lightning: 0 },
  cloudy:   { label: 'Cloudy',       cloudOp: 0.72, cloudDark: 0.14, rain: 0,    fogMul: 0.9,  sunMult: 0.8,  wind: 0.42, lightning: 0 },
  overcast: { label: 'Overcast',     cloudOp: 0.95, cloudDark: 0.42, rain: 0,    fogMul: 0.72, sunMult: 0.52, wind: 0.55, lightning: 0 },
  rain:     { label: 'Monsoon Rain', cloudOp: 0.92, cloudDark: 0.55, rain: 0.6,  fogMul: 0.55, sunMult: 0.42, wind: 0.72, lightning: 0.004 },
  storm:    { label: 'Thunderstorm', cloudOp: 1.0,  cloudDark: 0.8,  rain: 1.0,  fogMul: 0.45, sunMult: 0.3,  wind: 1.0,  lightning: 0.05 },
  fog:      { label: 'Lohri Fog',    cloudOp: 0.45, cloudDark: 0.22, rain: 0,    fogMul: 0.26, sunMult: 0.55, wind: 0.1,  lightning: 0 },
}

// auto (markov-ish) weather progression — makes multi-hour sessions feel alive
const NEXT_WEATHER: Record<WeatherKind, [WeatherKind, number][]> = {
  clear:    [['clear', 0.42], ['cloudy', 0.34], ['fog', 0.12], ['overcast', 0.12]],
  cloudy:   [['clear', 0.3], ['cloudy', 0.24], ['overcast', 0.28], ['rain', 0.14], ['fog', 0.04]],
  overcast: [['rain', 0.34], ['cloudy', 0.3], ['storm', 0.14], ['overcast', 0.12], ['clear', 0.1]],
  rain:     [['rain', 0.3], ['storm', 0.26], ['overcast', 0.28], ['cloudy', 0.16]],
  storm:    [['rain', 0.5], ['overcast', 0.3], ['storm', 0.2]],
  fog:      [['clear', 0.4], ['cloudy', 0.34], ['fog', 0.26]],
}

interface PaletteKey {
  e: number        // sun elevation key
  top: number      // sky zenith color
  hor: number      // horizon color
  fog: number      // fog / lower-atmosphere color
  sun: number      // directional light color
  hemiS: number    // hemisphere sky color
  hemiG: number    // hemisphere ground color
  amb: number      // hemi intensity
  exp: number      // tone-mapping exposure
  star: number     // star opacity
  glow: number     // sun glow strength
  haze: number     // wide sun haze strength
  cloudLit: number // cloud lit color
}

const P: PaletteKey[] = [
  { e: -0.75, top: 0x05070f, hor: 0x121a30, fog: 0x0a0f20, sun: 0x93a7dc, hemiS: 0x232c54, hemiG: 0x0b0e16, amb: 0.5,  exp: 0.7,  star: 1.0,  glow: 0.0,  haze: 0.04, cloudLit: 0x2a3350 },
  { e: -0.28, top: 0x0b1228, hor: 0x25244a, fog: 0x141a34, sun: 0x9aa8d8, hemiS: 0x303a68, hemiG: 0x12161f, amb: 0.6,  exp: 0.76, star: 0.8,  glow: 0.04, haze: 0.08, cloudLit: 0x3a4166 },
  { e: -0.1,  top: 0x18224c, hor: 0x5c4577, fog: 0x2a2c52, sun: 0xc4a0c8, hemiS: 0x46508c, hemiG: 0x1d2130, amb: 0.76, exp: 0.84, star: 0.4,  glow: 0.2,  haze: 0.16, cloudLit: 0x585078 },
  { e: 0.02,  top: 0x2c3e74, hor: 0xf2814e, fog: 0xa86446, sun: 0xff9550, hemiS: 0x84708e, hemiG: 0x3c2f28, amb: 0.92, exp: 0.94, star: 0.08, glow: 0.6,  haze: 0.34, cloudLit: 0xf5b078 },
  { e: 0.16,  top: 0x4678b4, hor: 0xf6c586, fog: 0xc8a278, sun: 0xffc986, hemiS: 0xb0a89a, hemiG: 0x584838, amb: 1.04, exp: 1.0,  star: 0.0,  glow: 0.38, haze: 0.24, cloudLit: 0xffe0b0 },
  { e: 0.42,  top: 0x3a7ccd, hor: 0xb4d8ea, fog: 0xc4d4de, sun: 0xfff0d4, hemiS: 0xd0e2f2, hemiG: 0x8a7a64, amb: 1.14, exp: 1.05, star: 0.0,  glow: 0.16, haze: 0.1,  cloudLit: 0xffffff },
  { e: 1.0,   top: 0x2c6fc2, hor: 0xa6cae2, fog: 0xbcd0dc, sun: 0xfff8ea, hemiS: 0xdae8f5, hemiG: 0x90806a, amb: 1.2,  exp: 1.08, star: 0.0,  glow: 0.12, haze: 0.08, cloudLit: 0xffffff },
]

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position; // dome is centered on the camera, so object-space position IS the view direction
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`

const SKY_FRAG = /* glsl */`
uniform vec3 uTop;
uniform vec3 uHor;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uGlow;
uniform float uHaze;
uniform float uSunDisc;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = pow(clamp(h, 0.0, 1.0), 0.52);
  vec3 col = mix(uHor, uTop, t);
  // below the horizon line: fade toward the darker ground haze
  col = mix(col, uBottom, smoothstep(0.015, -0.22, h));
  float sd = dot(d, normalize(uSunDir));
  // wide warm haze + tight glow around the sun
  col += uSunColor * pow(max(sd, 0.0), 5.0) * uHaze;
  col += uSunColor * pow(max(sd, 0.0), 60.0) * uGlow;
  // sun disc
  float disc = smoothstep(1.0 - uSunDisc, 1.0 - uSunDisc * 0.55, sd);
  col = mix(col, uSunColor * 1.45 + vec3(0.22), disc * step(-0.06, uSunDir.y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

const RAIN_VERT = /* glsl */`
attribute float seed;
attribute float tip;
uniform float uTime;
uniform vec3 uCam;
uniform float uArea;
uniform float uHeight;
uniform float uSpeed;
uniform float uWind;
uniform float uLen;
varying float vFade;
void main() {
  vec3 p = position;
  float fall = uTime * uSpeed * (0.75 + 0.5 * seed);
  p.y = mod(p.y - fall, uHeight);
  p.x = mod(p.x - uCam.x + uArea * 0.5 + uTime * uWind * 3.0, uArea) - uArea * 0.5 + uCam.x;
  p.z = mod(p.z - uCam.z + uArea * 0.5, uArea) - uArea * 0.5 + uCam.z;
  vec3 vel = normalize(vec3(uWind * 0.45, -1.0, uWind * 0.15));
  p += vel * uLen * (0.6 + 0.8 * seed) * tip;
  float dist = distance(p, uCam);
  vFade = smoothstep(60.0, 22.0, dist) * (0.55 + 0.45 * seed);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`

const RAIN_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vFade);
  if (gl_FragColor.a < 0.01) discard;
}`

interface CloudGroup {
  sprites: THREE.Sprite[]
  mats: THREE.SpriteMaterial[]
  offsets: THREE.Vector3[]
  baseOp: number
  angle: number
  radius: number
  height: number
  drift: number
}

export class SkySystem {
  group = new THREE.Group()
  /** the fixed-time/cycle selector (settings.timeMode) */
  timeMode: TimeMode = 'cycle'
  /** settings.weatherMode — 'auto' runs the weather state machine */
  weatherMode: WeatherMode = 'auto'
  /** seconds for a full 24h cycle when timeMode = 'cycle' */
  dayLength = 420
  /** fired at the moment a lightning flash starts (game wires HUD flash + thunder) */
  onLightning: (() => void) | null = null
  /** current normalized light direction (sun by day, moon by night) — engine reads this */
  lightDir = new THREE.Vector3(0.4, 0.8, 0.3).normalize()

  timeOfDay = 10.5 // hours [0,24)
  weather: WeatherKind = 'clear'
  private targetWeather: WeatherKind = 'clear'
  private wTimer = 40 + Math.random() * 60

  // smoothed weather params (approach the target def exponentially → free transitions)
  private cur = { ...WEATHER.clear }

  private dome: THREE.Mesh
  private domeMat: THREE.ShaderMaterial
  private stars: THREE.Points
  private starMat: THREE.PointsMaterial
  private moon: THREE.Sprite
  private moonMat: THREE.SpriteMaterial
  private clouds: CloudGroup[] = []
  private cloudLit = new THREE.Color(0xffffff)
  private rain: THREE.LineSegments
  private rainMat: THREE.ShaderMaterial
  private rainBasePos: Float32Array

  private hemi: THREE.HemisphereLight
  private sun: THREE.DirectionalLight
  private scene: THREE.Scene
  private exposureBase = 1.05

  private cTop = new THREE.Color()
  private cHor = new THREE.Color()
  private cBottom = new THREE.Color()
  private cFog = new THREE.Color()
  private cSun = new THREE.Color()
  private cHemiS = new THREE.Color()
  private cHemiG = new THREE.Color()
  private cA = new THREE.Color()
  private cB = new THREE.Color()
  private greyDay = new THREE.Color(0x8d9099)
  private greyNight = new THREE.Color(0x23262e)
  private fogTintCol = new THREE.Color(0xb9bcc2)
  private tmpDir = new THREE.Vector3()

  private quality: ResolvedQuality = 'high'
  private time = 0
  private flashT = 0      // remaining flash time
  private flashBoost = 0  // 0..1 extra light during a flash
  private nextFlashIn = 0
  private camPos = new THREE.Vector3()

  constructor(scene: THREE.Scene, quality: ResolvedQuality, hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight) {
    this.scene = scene
    this.quality = quality
    this.hemi = hemi
    this.sun = sun

    // ---------- sky dome ----------
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x3a7ccd) },
        uHor: { value: new THREE.Color(0xb4d8ea) },
        uBottom: { value: new THREE.Color(0x9aa8a8) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) },
        uSunColor: { value: new THREE.Color(0xfff0d4) },
        uGlow: { value: 0.16 },
        uHaze: { value: 0.1 },
        uSunDisc: { value: 0.0006 },
      },
    })
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 18), this.domeMat)
    this.dome.renderOrder = -10
    this.dome.frustumCulled = false
    this.group.add(this.dome)

    // ---------- stars ----------
    const starCount = 620
    const sPos = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i++) {
      // upper hemisphere, biased away from the horizon so stars sit in the deep sky
      const u = Math.random()
      const elev = Math.pow(u, 0.7) * 1.35 // 0..~1.35 rad
      const az = Math.random() * Math.PI * 2
      const r = 355
      sPos[i * 3] = Math.cos(elev) * Math.cos(az) * r
      sPos[i * 3 + 1] = Math.sin(elev) * r
      sPos[i * 3 + 2] = Math.cos(elev) * Math.sin(az) * r
    }
    const sGeo = new THREE.BufferGeometry()
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3))
    this.starMat = new THREE.PointsMaterial({
      color: 0xd6e0ff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    })
    this.stars = new THREE.Points(sGeo, this.starMat)
    this.stars.renderOrder = -9
    this.stars.frustumCulled = false
    this.group.add(this.stars)

    // ---------- moon ----------
    this.moonMat = new THREE.SpriteMaterial({ map: SkySystem.moonTexture(), transparent: true, opacity: 0, depthWrite: false, fog: false })
    this.moon = new THREE.Sprite(this.moonMat)
    this.moon.scale.set(34, 34, 1)
    this.moon.renderOrder = -8
    this.group.add(this.moon)

    // ---------- clouds ----------
    const cloudTex = SkySystem.cloudTexture()
    for (let g = 0; g < 11; g++) {
      const group: CloudGroup = { sprites: [], mats: [], offsets: [], baseOp: 0.4 + Math.random() * 0.5, angle: Math.random() * Math.PI * 2, radius: 150 + Math.random() * 150, height: 62 + Math.random() * 85, drift: 0.5 + Math.random() * 0.9 }
      const puffs = 3 + Math.floor(Math.random() * 3)
      for (let s = 0; s < puffs; s++) {
        const mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0, depthWrite: false, fog: false })
        const sp = new THREE.Sprite(mat)
        const sc = 26 + Math.random() * 34
        sp.scale.set(sc * (1.4 + Math.random() * 0.7), sc * 0.62, 1)
        group.offsets.push(new THREE.Vector3((Math.random() - 0.5) * 52, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 30))
        group.sprites.push(sp)
        group.mats.push(mat)
        this.group.add(sp)
      }
      this.clouds.push(group)
    }

    // ---------- rain ----------
    const dropCount = quality === 'high' ? 640 : quality === 'medium' ? 420 : 240
    const area = 60, height = 26
    this.rainBasePos = new Float32Array(dropCount * 2 * 3)
    const seeds = new Float32Array(dropCount * 2)
    const tips = new Float32Array(dropCount * 2)
    for (let i = 0; i < dropCount; i++) {
      const x = Math.random() * area, y = Math.random() * height, z = Math.random() * area
      const seed = Math.random()
      for (let v = 0; v < 2; v++) {
        const o = (i * 2 + v) * 3
        this.rainBasePos[o] = x; this.rainBasePos[o + 1] = y; this.rainBasePos[o + 2] = z
        seeds[i * 2 + v] = seed
        tips[i * 2 + v] = v // second vertex trails along the velocity → streak
      }
    }
    const rGeo = new THREE.BufferGeometry()
    rGeo.setAttribute('position', new THREE.BufferAttribute(this.rainBasePos, 3))
    rGeo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1))
    rGeo.setAttribute('tip', new THREE.BufferAttribute(tips, 1))
    this.rainMat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uArea: { value: area },
        uHeight: { value: height },
        uSpeed: { value: 17 },
        uWind: { value: 0.3 },
        uLen: { value: 0.95 },
        uColor: { value: new THREE.Color(0xb6c6da) },
        uOpacity: { value: 0 },
      },
    })
    this.rain = new THREE.LineSegments(rGeo, this.rainMat)
    this.rain.frustumCulled = false
    this.rain.renderOrder = 5
    this.rain.visible = false
    scene.add(this.rain)

    scene.add(this.group)
  }

  private static moonTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas')
    c.width = 128; c.height = 128
    const ctx = c.getContext('2d')!
    const glow = ctx.createRadialGradient(64, 64, 30, 64, 64, 64)
    glow.addColorStop(0, 'rgba(214,226,255,0.5)')
    glow.addColorStop(1, 'rgba(214,226,255,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, 128, 128)
    ctx.fillStyle = '#e8edf8'
    ctx.beginPath(); ctx.arc(64, 64, 30, 0, 7); ctx.fill()
    ctx.fillStyle = 'rgba(160,172,200,0.55)'
    ;[[52, 50, 8], [74, 66, 6], [62, 80, 5], [78, 46, 4], [48, 72, 4]].forEach(([x, y, r]) => {
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
    })
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  private static cloudTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas')
    c.width = 160; c.height = 96
    const ctx = c.getContext('2d')!
    for (let i = 0; i < 9; i++) {
      const x = 26 + Math.random() * 108
      const y = 40 + Math.random() * 30
      const r = 18 + Math.random() * 22
      const g = ctx.createRadialGradient(x, y, 2, x, y, r)
      g.addColorStop(0, 'rgba(255,255,255,0.85)')
      g.addColorStop(0.65, 'rgba(255,255,255,0.4)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 160, 96)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  setQuality(q: ResolvedQuality) {
    this.quality = q
  }

  setTimeMode(m: TimeMode) {
    if (m === this.timeMode) return
    this.timeMode = m
    if (m === 'dawn') this.timeOfDay = 5.9
    else if (m === 'noon') this.timeOfDay = 12.2
    else if (m === 'dusk') this.timeOfDay = 17.9
    else if (m === 'night') this.timeOfDay = 22.5
    // 'cycle' resumes from wherever the sky currently is
  }

  setWeatherMode(m: WeatherMode) {
    if (m === this.weatherMode) return
    this.weatherMode = m
    if (m !== 'auto') this.targetWeather = m
    this.wTimer = 45 + Math.random() * 70
  }

  /** Human-readable environment info for the HUD chip. */
  envInfo(): { time: string; phase: string; weather: string; icon: 'sun' | 'sunrise' | 'sunset' | 'moon'; wIcon: WeatherKind } {
    const h = Math.floor(this.timeOfDay)
    const m = Math.floor((this.timeOfDay - h) * 60)
    const elev = this.sunElevation()
    let phase = 'Night'
    let icon: 'sun' | 'sunrise' | 'sunset' | 'moon' = 'moon'
    if (elev > 0.32) {
      phase = this.timeOfDay < 15 ? 'Morning' : 'Afternoon'
      icon = 'sun'
    } else if (elev > 0.08) {
      phase = this.timeOfDay < 12 ? 'Sunrise Glow' : 'Golden Hour'
      icon = 'sun'
    } else if (elev > -0.14) {
      const morningSide = this.timeOfDay >= 2 && this.timeOfDay < 12
      phase = morningSide ? 'Dawn' : 'Dusk'
      icon = morningSide ? 'sunrise' : 'sunset'
    }
    return { time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, phase, weather: WEATHER[this.weather].label, icon, wIcon: this.weather }
  }

  update(dt: number, camPos: THREE.Vector3) {
    this.time += dt
    this.camPos.copy(camPos)

    // ---- clock ----
    if (this.timeMode === 'cycle') {
      this.timeOfDay = (this.timeOfDay + (dt / this.dayLength) * 24) % 24
    }

    // ---- weather state machine ----
    if (this.weatherMode === 'auto') {
      this.wTimer -= dt
      if (this.wTimer <= 0) {
        this.wTimer = 50 + Math.random() * 75
        const opts = NEXT_WEATHER[this.targetWeather]
        let roll = Math.random()
        for (const [kind, p] of opts) {
          roll -= p
          if (roll <= 0) { this.targetWeather = kind; break }
        }
      }
    }
    this.weather = this.targetWeather
    const tgt = WEATHER[this.weather]
    const k = Math.min(1, dt * 0.22) // ~4.5s transition constant
    this.cur.cloudOp += (tgt.cloudOp - this.cur.cloudOp) * k
    this.cur.cloudDark += (tgt.cloudDark - this.cur.cloudDark) * k
    this.cur.rain += (tgt.rain - this.cur.rain) * k
    this.cur.fogMul += (tgt.fogMul - this.cur.fogMul) * k
    this.cur.sunMult += (tgt.sunMult - this.cur.sunMult) * k
    this.cur.wind += (tgt.wind - this.cur.wind) * k
    this.cur.lightning += (tgt.lightning - this.cur.lightning) * k

    // ---- sun / moon geometry ----
    const dayAngle = ((this.timeOfDay - 6) / 24) * Math.PI * 2 // 6:00 sunrise on the horizon
    const sunDir = this.tmpDir.set(Math.cos(dayAngle), Math.sin(dayAngle) * 0.96 + 0.04, 0.38).normalize()
    const moonDir = sunDir.clone().multiplyScalar(-1); moonDir.z = Math.abs(moonDir.z) * 0.6 + 0.2; moonDir.normalize()
    const elev = sunDir.y

    // ---- palette interpolation by sun elevation ----
    let i = 0
    while (i < P.length - 2 && elev > P[i + 1].e) i++
    const a = P[i], b = P[i + 1]
    const f = Math.max(0, Math.min(1, (elev - a.e) / (b.e - a.e)))
    this.lerpColor(this.cTop, a.top, b.top, f)
    this.lerpColor(this.cHor, a.hor, b.hor, f)
    this.lerpColor(this.cFog, a.fog, b.fog, f)
    this.lerpColor(this.cSun, a.sun, b.sun, f)
    this.lerpColor(this.cHemiS, a.hemiS, b.hemiS, f)
    this.lerpColor(this.cHemiG, a.hemiG, b.hemiG, f)
    const amb = a.amb + (b.amb - a.amb) * f
    const exp = a.exp + (b.exp - a.exp) * f
    const star = a.star + (b.star - a.star) * f
    const glow = a.glow + (b.glow - a.glow) * f
    const haze = a.haze + (b.haze - a.haze) * f
    this.lerpColor(this.cloudLit, a.cloudLit, b.cloudLit, f)

    // ---- weather modifiers ----
    const dark = this.cur.cloudDark
    const grey = this.greyDay
    const nightGrey = this.greyNight
    this.cA.copy(this.cloudLit).lerp(elev > 0 ? grey : nightGrey, Math.min(1, dark * 1.1))
    // fog: weather tints (overcast grey, fog pale, rain blue-grey)
    const fogTint = dark * 0.62 + (this.weather === 'fog' ? 0.42 : 0) + this.cur.rain * 0.24
    this.cFog.lerp(this.fogTintCol, Math.min(0.75, fogTint))

    // ---- sky dome uniforms ----
    const u = this.domeMat.uniforms
    ;(u.uTop.value as THREE.Color).copy(this.cTop).lerp(grey, dark * 0.62)
    ;(u.uHor.value as THREE.Color).copy(this.cHor).lerp(grey, dark * 0.68)
    ;(u.uBottom.value as THREE.Color).copy(this.cFog).multiplyScalar(0.85)
    ;(u.uSunDir.value as THREE.Vector3).copy(sunDir)
    ;(u.uSunColor.value as THREE.Color).copy(this.cSun).lerp(grey, dark * 0.6)
    u.uGlow.value = glow * this.cur.sunMult
    u.uHaze.value = haze * (0.4 + this.cur.sunMult * 0.6)

    // ---- stars / moon ----
    this.starMat.opacity = star * Math.max(0, 1 - dark * 1.35)
    this.stars.rotation.y = this.time * 0.004 // slow celestial drift
    const moonUp = Math.max(0, moonDir.y)
    this.moonMat.opacity = moonUp * Math.max(0.15, 1 - dark) * Math.min(1, star + 0.15) * 0.95
    this.moon.position.copy(moonDir).multiplyScalar(348)
    this.moon.visible = this.moonMat.opacity > 0.02

    // ---- clouds (positions are dome-LOCAL: the parent group already follows the camera) ----
    const cloudDim = Math.max(0.1, this.cur.sunMult * 0.55 + 0.45)
    for (const cl of this.clouds) {
      cl.angle += dt * 0.006 * cl.drift * (0.4 + this.cur.wind)
      const cx = Math.cos(cl.angle) * cl.radius
      const cz = Math.sin(cl.angle) * cl.radius * 0.8
      const cy = cl.height + Math.sin(this.time * 0.11 + cl.radius) * 3.5
      const op = cl.baseOp * this.cur.cloudOp * 0.92
      for (let s = 0; s < cl.sprites.length; s++) {
        const sp = cl.sprites[s]
        const off = cl.offsets[s]
        sp.position.set(cx + off.x, cy + off.y, cz + off.z)
        sp.material.opacity = op
        sp.material.color.copy(this.cA)
        sp.material.color.multiplyScalar(cloudDim)
        sp.visible = op > 0.03
      }
    }

    // ---- rain ----
    const rainOp = this.cur.rain * 0.68
    this.rain.visible = rainOp > 0.02
    if (this.rain.visible) {
      this.rainMat.uniforms.uTime.value = this.time
      ;(this.rainMat.uniforms.uCam.value as THREE.Vector3).set(this.camPos.x, Math.max(1.6, this.camPos.y - 2.5), this.camPos.z)
      this.rainMat.uniforms.uWind.value = this.cur.wind
      this.rainMat.uniforms.uOpacity.value = rainOp
      ;(this.rainMat.uniforms.uColor.value as THREE.Color).setHex(elev > 0.05 ? 0xb6c6da : 0x7a84a0)
    }

    // ---- lightning ----
    if (this.cur.lightning > 0.003) {
      this.nextFlashIn -= dt
      if (this.nextFlashIn <= 0 && this.flashT <= 0) {
        // interval scales with storm strength: 4–20s at full storm, minutes at a drizzle's odd rumble
        const strength = Math.max(0.25, this.cur.lightning / WEATHER.storm.lightning)
        this.nextFlashIn = (4 + Math.random() * 16) / strength
        this.flashT = 0.42
        this.onLightning?.()
      }
    }
    if (this.flashT > 0) {
      this.flashT -= dt
      const w = Math.max(0, this.flashT / 0.42)
      this.flashBoost = w * w * (Math.random() > 0.4 ? 1 : 0.45) // flickery decay
    } else this.flashBoost = 0

    // ---- lights + fog + exposure ----
    const sunUp = this.smooth(-0.02, 0.16, elev)
    const moonUp2 = this.smooth(0.05, 0.3, moonDir.y)
    const useMoon = sunUp < 0.03 && moonUp2 > 0.05
    if (useMoon) {
      this.lightDir.copy(moonDir)
      this.sun.color.setHex(0xa9bce6)
      this.sun.intensity = 0.5 * moonUp2 * Math.max(0.2, 1 - dark * 0.9)
    } else {
      this.lightDir.copy(sunDir)
      this.sun.color.copy(this.cSun)
      this.sun.intensity = 2.15 * sunUp * this.cur.sunMult + this.flashBoost * 2.6
    }
    const shadowDir = this.lightDir.clone()
    shadowDir.y = Math.max(shadowDir.y, 0.24)
    shadowDir.normalize()
    this.lightDir.copy(shadowDir) // engine.trackSun uses this for the shadow frustum

    this.hemi.color.copy(this.cHemiS)
    this.hemi.groundColor.copy(this.cHemiG)
    this.hemi.intensity = amb * (1 - dark * 0.5) + this.flashBoost * 2.2

    const fog = this.scene.fog as THREE.Fog | null
    if (fog) {
      fog.color.copy(this.cFog)
      const baseFar = this.quality === 'low' ? 150 : 210
      fog.far = baseFar * this.cur.fogMul
      fog.near = Math.min(60 * Math.pow(this.cur.fogMul, 0.7), fog.far * 0.4)
    }

    this.exposureBase = exp

    // ---- follow the camera ----
    this.group.position.copy(camPos)
  }

  /** renderer.toneMappingExposure should be driven from this (game reads it each frame) */
  get exposure() {
    return this.exposureBase * (1 - this.cur.cloudDark * 0.3) + this.flashBoost * 0.5
  }

  get rainLevel() {
    return this.cur.rain
  }

  private sunElevation(): number {
    const dayAngle = ((this.timeOfDay - 6) / 24) * Math.PI * 2
    return Math.sin(dayAngle) * 0.96 + 0.04
  }

  private lerpColor(out: THREE.Color, a: number, b: number, f: number) {
    this.cA.setHex(a)
    this.cB.setHex(b)
    out.copy(this.cA).lerp(this.cB, f)
  }

  private smooth(a: number, b: number, x: number) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }

  dispose() {
    this.scene.remove(this.group)
    this.scene.remove(this.rain)
    this.dome.geometry.dispose()
    this.domeMat.dispose()
    this.stars.geometry.dispose()
    this.starMat.dispose()
    this.rain.geometry.dispose()
    this.rainMat.dispose()
    for (const cl of this.clouds) for (const m of cl.mats) m.dispose()
    this.moonMat.dispose()
  }
}
