// VoteChor audio — fully synthesized WebAudio: SFX, crowd ambience, adaptive music.
// No external audio assets; everything generated procedurally.
'use client'

export type SfxName =
  | 'footstep' | 'footstepRun' | 'jump' | 'doublejump' | 'land' | 'slide' | 'whistle' | 'whistleFar'
  | 'pickup' | 'token' | 'throw' | 'impact' | 'hit' | 'policehit' | 'vault' | 'capture' | 'release'
  | 'heal' | 'revive' | 'checkpoint' | 'uiClick' | 'uiHover' | 'bossHit' | 'stampSlam'
  | 'shockwave' | 'paperRustle' | 'dizzy' | 'victory' | 'defeat' | 'cash' | 'horn' | 'moo' | 'gate'
  | 'shout' | 'thunder'
  | 'bark' | 'meow' | 'chirp' | 'crunch'

/**
 * Adaptive music themes. 'none' = sequencer fully stopped (silent menus —
 * v48: background sound only plays while a match is running).
 */
export type MusicTheme = 'menu' | 'ambient' | 'chase' | 'boss' | 'victory' | 'none'

class AudioManagerImpl {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfxGain: GainNode | null = null
  private musicGain: GainNode | null = null
  private crowdGain: GainNode | null = null
  private crowdSource: AudioBufferSourceNode | null = null
  private musicTimer: ReturnType<typeof setInterval> | null = null
  private theme: MusicTheme = 'menu'
  private step = 0
  volumes = { master: 0.8, music: 0.5, sfx: 0.9 }
  private started = false

  init() {
    if (this.ctx) return
    try {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.volumes.master
      this.master.connect(this.ctx.destination)
      this.sfxGain = this.ctx.createGain()
      this.sfxGain.gain.value = this.volumes.sfx
      this.sfxGain.connect(this.master)
      this.musicGain = this.ctx.createGain()
      this.musicGain.gain.value = this.volumes.music
      this.musicGain.connect(this.master)
      this.crowdGain = this.ctx.createGain()
      this.crowdGain.gain.value = 0
      this.crowdGain.connect(this.master)
    } catch { /* no audio */ }
  }

  resume() {
    this.init()
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {})
  }

  setVolumes(v: { master?: number; music?: number; sfx?: number }) {
    Object.assign(this.volumes, v)
    if (this.master) this.master.gain.value = this.volumes.master
    if (this.musicGain) this.musicGain.gain.value = this.volumes.music
    if (this.sfxGain) this.sfxGain.gain.value = this.volumes.sfx
  }

  // ---------- SFX ----------
  private env(g: GainNode, t: number, a: number, d: number, peak = 1) {
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + a)
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d)
  }

  /** Current per-play routing target — null = straight to the SFX bus (v45 spatial audio). */
  private playDest: AudioNode | null = null
  private out(): AudioNode { return this.playDest ?? this.sfxGain! }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, peak: number, slideTo?: number, dest?: AudioNode) {
    if (!this.ctx || !this.sfxGain) return
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur)
    this.env(g, t, 0.008, dur, peak)
    o.connect(g); g.connect(dest ?? this.out())
    o.start(t); o.stop(t + dur + 0.1)
  }

  private noise(dur: number, t: number, peak: number, filterFreq: number, q = 1, dest?: AudioNode) {
    if (!this.ctx || !this.sfxGain) return
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur))
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const f = this.ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = filterFreq
    f.Q.value = q
    const g = this.ctx.createGain()
    this.env(g, t, 0.005, dur, peak)
    src.connect(f); f.connect(g); g.connect(dest ?? this.out())
    src.start(t)
  }

  /**
   * A human whistle voice — the two cues that make a bare sine read as
   * "someone actually whistling through lips/fingers" are (1) VIBRATO, a
   * slow ±dozens-of-Hz wobble on the pitch, and (2) breath tremolo, a gentle
   * amplitude shimmer tied to the air stream. Adds a swell envelope: soft
   * tongue-attack, brief hold, quick release. Near-pure sine carrier because
   * real whistles carry almost no harmonics.
   */
  private whistleTone(t: number, f0: number, f1: number, dur: number, peak: number, vibHz: number, vibDepth: number) {
    if (!this.ctx || !this.sfxGain) return
    const ctx = this.ctx
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(Math.max(200, f0), t)
    o.frequency.exponentialRampToValueAtTime(Math.max(200, f1), t + dur * 0.55)
    const g = ctx.createGain() // swell envelope
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + 0.035)
    g.gain.setValueAtTime(peak, t + dur * 0.75)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    const am = ctx.createGain() // breath tremolo multiplies the carrier
    am.gain.value = 0.86
    const amOsc = ctx.createOscillator()
    amOsc.type = 'sine'
    amOsc.frequency.value = vibHz * 0.9
    const amDepth = ctx.createGain()
    amDepth.gain.value = peak * 0.14
    amOsc.connect(amDepth); amDepth.connect(am.gain)
    const lfo = ctx.createOscillator() // vibrato: pitch wobble
    lfo.type = 'sine'
    lfo.frequency.value = vibHz
    const lfoDepth = ctx.createGain()
    lfoDepth.gain.value = vibDepth
    lfo.connect(lfoDepth); lfoDepth.connect(o.frequency)
    o.connect(am); am.connect(g); g.connect(this.out())
    o.start(t); o.stop(t + dur + 0.05)
    lfo.start(t); lfo.stop(t + dur + 0.05)
    amOsc.start(t); amOsc.stop(t + dur + 0.05)
  }

  play(name: SfxName, volume = 1) {
    if (!this.ctx || !this.sfxGain) return
    this.playDest = null
    this.emit(name, volume)
  }

  /**
   * v45 — spatial one-shot: a voice/sound emitted at world position (sx, sz),
   * heard by a listener at (lx, lz) facing yaw (Three.js convention: yaw 0
   * faces −z, right vector = (cos yaw, −sin yaw)). Distance rolls off with a
   * smoothstep curve to zero at `range` metres; direction becomes a stereo pan
   * so a bark on your left ear actually sits left. Silent past the range.
   */
  playAt(name: SfxName, sx: number, sz: number, lx: number, lz: number, yaw: number, range = 52, base = 1) {
    if (!this.ctx || !this.sfxGain) return
    const dx = sx - lx, dz = sz - lz
    const dist = Math.hypot(dx, dz)
    const k = Math.max(0, Math.min(1, 1 - dist / range))
    const atten = base * k * k * (3 - 2 * k) // smoothstep — full near, 0 at range
    if (atten < 0.02) return // out of earshot — no nodes, no cost
    let pan = 0
    if (dist > 0.35) {
      pan = Math.max(-1, Math.min(1, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / dist)) * 0.85
    }
    const ctx = this.ctx
    const g = ctx.createGain()
    g.gain.value = atten
    if (Math.abs(pan) > 0.01 && typeof ctx.createStereoPanner === 'function') {
      const sp = ctx.createStereoPanner()
      sp.pan.value = pan
      sp.connect(g); g.connect(this.sfxGain)
      this.playDest = sp
    } else {
      g.connect(this.sfxGain)
      this.playDest = g
    }
    this.emit(name, 1)
    this.playDest = null
  }

  private emit(name: SfxName, v: number) {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    switch (name) {
      case 'footstep': {
        // walk footfall anatomy: heel-weight thud + rubber-sole scuff + short
        // toe flick. Pitch/brightness randomized per step so steps never loop.
        // v45: peaks raised ~65% — players reported walking as nearly silent.
        const f = 0.9 + Math.random() * 0.2
        this.osc('sine', (78 + Math.random() * 14) * f, t, 0.055, 0.2 * v)
        this.noise(0.05, t, 0.28 * v, (850 + Math.random() * 350) * f, 1.1)
        this.noise(0.035, t + 0.05, 0.13 * v, 1400 * f, 1.4)
        break
      }
      case 'footstepRun': {
        // run footfall: heavier full-weight slam, bigger scuff, audible sole
        // slap a beat after contact — reads as real ground strikes, louder
        const f = 0.9 + Math.random() * 0.2
        this.osc('sine', (72 + Math.random() * 12) * f, t, 0.07, 0.3 * v)
        this.noise(0.06, t, 0.4 * v, (750 + Math.random() * 400) * f, 1)
        this.noise(0.04, t + 0.055, 0.16 * v, 1700 * f, 1.3)
        break
      }
      case 'jump': {
        // v45: doubled the voice + a cloth/sole scuff layer so the hop reads
        // as a physical push-off, not a faint video-game blip
        this.osc('sine', 260, t, 0.2, 0.32 * v, 480)
        this.noise(0.09, t, 0.12 * v, 1100, 0.9)
        break
      }
      case 'doublejump': {
        // distinctive whoosh-flap: layered filtered-noise sweeps + quick flutter blips
        this.noise(0.28, t, 0.2 * v, 900, 0.6)
        this.noise(0.22, t + 0.05, 0.15 * v, 2000, 0.7)
        this.osc('sine', 340, t, 0.26, 0.16 * v, 820)
        this.osc('triangle', 520, t + 0.02, 0.09, 0.09 * v, 700)
        this.osc('triangle', 660, t + 0.11, 0.09, 0.08 * v, 880)
        break
      }
      case 'vault': {
        // soft rise-and-thud mantle: airy swish landing on a low wooden knock
        this.noise(0.16, t, 0.07 * v, 700, 0.5)
        this.osc('sine', 150, t + 0.08, 0.12, 0.09 * v, 90)
        this.noise(0.06, t + 0.09, 0.05 * v, 320, 0.8)
        break
      }
      case 'policehit': {
        // comic, non-graphic thwack — cartoon bonk + quick slide-whistle wobble
        this.noise(0.09, t, 0.22 * v, 1000, 0.9)
        this.osc('sine', 300, t, 0.16, 0.18 * v, 110)
        this.osc('triangle', 190, t + 0.015, 0.14, 0.1 * v, 90)
        this.osc('sine', 620, t + 0.05, 0.22, 0.05 * v, 380)
        break
      }
      case 'land': this.noise(0.12, t, 0.38 * v, 300, 0.7); this.osc('sine', 95, t, 0.09, 0.14 * v, 60); break
      case 'slide': {
        // long ground-scrape glide: two overlapping band-passed scrapes with a
        // falling filter (sole rubbing the road), rhythmic scuff pulses as the
        // body skips, and a low friction hum underneath. Length matches the
        // tuned ~1.5 s slide window.
        if (this.ctx && this.sfxGain) {
          const len = Math.max(1, Math.floor(this.ctx.sampleRate * 1.25))
          const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
          const data = buf.getChannelData(0)
          for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
          const src = this.ctx.createBufferSource()
          src.buffer = buf
          const flt = this.ctx.createBiquadFilter()
          flt.type = 'bandpass'
          flt.Q.value = 0.7
          flt.frequency.setValueAtTime(950, t)
          flt.frequency.exponentialRampToValueAtTime(380, t + 1.15)
          const g = this.ctx.createGain()
          g.gain.setValueAtTime(0.0001, t)
          g.gain.exponentialRampToValueAtTime(0.2 * v, t + 0.07)
          g.gain.setValueAtTime(0.2 * v, t + 0.85)
          g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2)
          src.connect(flt); flt.connect(g); g.connect(this.out())
          src.start(t)
        }
        // skip pulses — the body bouncing on the leading leg
        this.noise(0.06, t + 0.12, 0.09 * v, 620, 1.1)
        this.noise(0.05, t + 0.48, 0.06 * v, 540, 1.1)
        this.noise(0.05, t + 0.86, 0.045 * v, 460, 1.1)
        this.osc('sine', 95, t, 0.5, 0.05 * v, 70)
        break
      }
      case 'whistle': {
        // real mouth/finger whistle, two blows — breathy air pickup, then a
        // rising "fwee" and a louder held "wheeet" with natural vibrato and
        // breath shimmer (whistleTone). ~2x louder than the old bare beeps.
        const j = 0.94 + Math.random() * 0.12 // per-play pitch jitter — no two whistles identical
        this.noise(0.06, t, 0.05 * v, 3200, 1.2) // tongue/air attack
        this.whistleTone(t, 1700 * j, 2500 * j, 0.2, 0.22 * v, 5.5, 60)
        this.whistleTone(t + 0.24, 2600 * j, 2250 * j, 0.42, 0.3 * v, 6.5, 85)
        this.noise(0.09, t + 0.64, 0.035 * v, 2600, 1) // airy tail
        break
      }
      case 'shout': {
        // street yell — pitch RISES into the vowel then falls off ("AAZADII!"),
        // chest-octave square underneath, breath layer, clipped stop so it
        // reads as a voice, not a beep. Per-play pitch jitter.
        const f = 0.94 + Math.random() * 0.12
        this.osc('sawtooth', 195 * f, t, 0.13, 0.2 * v, 300 * f)
        this.osc('sawtooth', 300 * f, t + 0.13, 0.17, 0.18 * v, 150 * f)
        this.osc('square', 95 * f, t, 0.26, 0.07 * v, 75)
        this.noise(0.16, t, 0.09 * v, 1000, 0.7)
        this.noise(0.05, t + 0.26, 0.04 * v, 500, 0.8)
        break
      }
      case 'whistleFar': {
        // distant constable's pea-whistle: shrill tone with a fast ~22 Hz
        // warble trill (the pea bouncing) — FM + AM both fire at that rate
        this.whistleTone(t, 2350, 2500, 0.5, 0.07 * v, 22, 90)
        break
      }
      case 'pickup': {
        // physical grab (hand/cloth snap) + short rising confirming chirp
        this.noise(0.045, t, 0.1 * v, 950, 1.6)
        this.osc('sine', 560, t + 0.02, 0.09, 0.16 * v, 820)
        this.osc('sine', 840, t + 0.085, 0.1, 0.12 * v, 1120)
        break
      }
      case 'token': {
        for (let i = 0; i < 4; i++) this.osc('triangle', 700 + i * 160, t + i * 0.06, 0.14, 0.12 * v)
        break
      }
      case 'throw': {
        // arm-swing whoosh: band-passed air that brightens then falls as the
        // item leaves the hand (filter sweeps 2.9k → 650), arc-shaped amp,
        // plus a tiny grip-release tick at the start
        if (this.ctx && this.sfxGain) {
          const len = Math.max(1, Math.floor(this.ctx.sampleRate * 0.24))
          const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
          const data = buf.getChannelData(0)
          for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
          const src = this.ctx.createBufferSource()
          src.buffer = buf
          const flt = this.ctx.createBiquadFilter()
          flt.type = 'bandpass'
          flt.Q.value = 0.8
          flt.frequency.setValueAtTime(2900, t)
          flt.frequency.exponentialRampToValueAtTime(650, t + 0.22)
          const g = this.ctx.createGain()
          g.gain.setValueAtTime(0.0001, t)
          g.gain.exponentialRampToValueAtTime(0.24 * v, t + 0.05)
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.23)
          src.connect(flt); flt.connect(g); g.connect(this.out())
          src.start(t)
        }
        this.noise(0.02, t, 0.07 * v, 3400, 1.2)
        break
      }
      case 'impact': this.noise(0.16, t, 0.24 * v, 420, 0.8); this.osc('sine', 160, t, 0.12, 0.16 * v, 70); break
      case 'hit': this.osc('sawtooth', 200, t, 0.16, 0.2 * v, 80); this.noise(0.1, t, 0.18 * v, 700, 1); break
      case 'capture': {
        this.osc('square', 880, t, 0.12, 0.1 * v, 880)
        this.osc('square', 660, t + 0.14, 0.3, 0.1 * v, 220)
        this.noise(0.2, t, 0.1 * v, 800, 0.7)
        break
      }
      case 'release': this.osc('sine', 520, t, 0.2, 0.12 * v, 780); this.osc('sine', 780, t + 0.16, 0.24, 0.1 * v, 1040); break
      case 'heal': this.osc('sine', 520, t, 0.2, 0.1 * v, 700); this.osc('sine', 700, t + 0.14, 0.24, 0.1 * v, 920); break
      case 'revive': {
        for (let i = 0; i < 5; i++) this.osc('triangle', 500 + i * 120, t + i * 0.07, 0.16, 0.1 * v)
        break
      }
      case 'checkpoint': {
        for (let i = 0; i < 3; i++) this.osc('square', 523 + i * 262, t + i * 0.11, 0.18, 0.09 * v)
        break
      }
      case 'uiClick': this.osc('sine', 700, t, 0.06, 0.08 * v, 900); break
      case 'uiHover': this.osc('sine', 500, t, 0.04, 0.04 * v, 620); break
      case 'bossHit': this.osc('square', 320, t, 0.2, 0.14 * v, 120); this.noise(0.15, t, 0.16 * v, 500, 1); break
      case 'stampSlam': {
        this.noise(0.3, t, 0.4 * v, 180, 0.5)
        this.osc('sine', 90, t, 0.4, 0.34 * v, 40)
        break
      }
      case 'shockwave': this.noise(0.5, t, 0.3 * v, 350, 0.4); this.osc('sine', 120, t, 0.5, 0.2 * v, 50); break
      case 'paperRustle': this.noise(0.25, t, 0.12 * v, 2400, 0.4); break
      case 'dizzy': {
        this.osc('sine', 900, t, 0.4, 0.08 * v, 400)
        this.osc('sine', 700, t + 0.3, 0.4, 0.08 * v, 300)
        break
      }
      case 'gate': {
        this.osc('sawtooth', 90, t, 0.9, 0.16 * v, 300)
        this.osc('sine', 440, t + 0.5, 0.5, 0.1 * v, 660)
        break
      }
      case 'horn': this.osc('sawtooth', 310, t, 0.4, 0.14 * v, 290); this.osc('sawtooth', 155, t, 0.4, 0.12 * v, 145); break
      case 'moo': {
        // proper cow moo — slow attack (no click), saw voice gliding down with a
        // sub-octave chest layer and a breathy low band. Reads as a big animal.
        const j = 0.92 + Math.random() * 0.16
        const o = this.ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.setValueAtTime(172 * j, t)
        o.frequency.exponentialRampToValueAtTime(118 * j, t + 0.75)
        const g = this.ctx.createGain()
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.15 * v, t + 0.13)
        g.gain.setValueAtTime(0.15 * v, t + 0.6)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95)
        const sub = this.ctx.createOscillator()
        sub.type = 'sine'
        sub.frequency.setValueAtTime(86 * j, t)
        sub.frequency.exponentialRampToValueAtTime(58 * j, t + 0.8)
        const sg = this.ctx.createGain()
        sg.gain.setValueAtTime(0.0001, t)
        sg.gain.exponentialRampToValueAtTime(0.11 * v, t + 0.15)
        sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
        o.connect(g); sub.connect(sg)
        g.connect(this.out()); sg.connect(this.out())
        o.start(t); o.stop(t + 1)
        sub.start(t); sub.stop(t + 1)
        this.noise(0.55, t + 0.1, 0.05 * v, 340, 0.6)
        break
      }
      case 'bark': {
        // two quick woofs — short saw bursts with a hard pitch drop (bow-wow)
        // plus a breathy chest layer; per-play jitter so barks never loop
        const j = 0.9 + Math.random() * 0.2
        for (const [dt2, f0, f1, pk] of [[0, 430, 250, 0.15], [0.19, 400, 230, 0.13]] as const) {
          this.osc('sawtooth', f0 * j, t + dt2, 0.09, pk * v, f1 * j)
          this.noise(0.07, t + dt2, 0.09 * v, 850 * j, 1)
          this.osc('square', 120 * j, t + dt2, 0.07, 0.05 * v, 90)
        }
        break
      }
      case 'meow': {
        // two-part mew: rising "mee" then falling "ow" with a slow vibrato
        const j = 0.92 + Math.random() * 0.16
        this.osc('sawtooth', 350 * j, t, 0.2, 0.08 * v, 640 * j)
        this.osc('sine', 700 * j, t + 0.02, 0.18, 0.05 * v, 900 * j)
        this.osc('sawtooth', 620 * j, t + 0.2, 0.3, 0.07 * v, 320 * j)
        this.noise(0.34, t + 0.06, 0.025 * v, 1700, 0.8)
        break
      }
      case 'chirp': {
        // 2-3 quick high songbird notes, each a fast down-chirp
        const j = 0.92 + Math.random() * 0.16
        const n = 2 + (Math.random() < 0.5 ? 1 : 0)
        for (let i = 0; i < n; i++) {
          this.osc('sine', (3400 - i * 180) * j, t + i * 0.11, 0.07, 0.045 * v, (2500 - i * 150) * j)
        }
        break
      }
      case 'crunch': {
        // eating — 3 short crisp bites with a lower crumble tail
        this.noise(0.05, t, 0.13 * v, 2100, 1.2)
        this.noise(0.05, t + 0.13, 0.11 * v, 1500, 1.2)
        this.noise(0.06, t + 0.27, 0.09 * v, 2300, 1.3)
        this.noise(0.09, t + 0.4, 0.05 * v, 800, 0.9)
        break
      }
      case 'cash': this.osc('triangle', 1200, t, 0.1, 0.1 * v); this.osc('triangle', 1600, t + 0.06, 0.14, 0.1 * v); break
      case 'victory': {
        const notes = [523, 659, 784, 1046, 784, 1046]
        notes.forEach((n, i) => this.osc('triangle', n, t + i * 0.16, 0.3, 0.12 * v))
        break
      }
      case 'defeat': {
        const notes = [392, 330, 262, 196]
        notes.forEach((n, i) => this.osc('sawtooth', n, t + i * 0.22, 0.34, 0.1 * v))
        break
      }
      case 'thunder': {
        // layered rumble: long low-passed noise + deep sine drop + a crack transient
        this.noise(1.8, t, 0.34 * v, 140, 0.35)
        this.noise(0.35, t + 0.02, 0.22 * v, 900, 0.5)
        this.osc('sine', 70, t, 1.6, 0.3 * v, 32)
        break
      }
    }
  }

  // ---------- weather ambience (looping rain hiss, gain-driven) ----------
  private rainGain: GainNode | null = null
  private rainSrc: AudioBufferSourceNode | null = null

  /** level 0..1 — smoothly fades a looping filtered-noise rain bed in/out.
   *  v49: level ≤ 0.01 also HARD-STOPS the looping source after the fade tail —
   *  a parked rain loop used to keep hissing behind menus after quitting a match. */
  setRain(level: number) {
    if (!this.ctx || !this.master) return
    if (level <= 0.01) {
      if (this.rainGain && this.ctx) this.rainGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.8)
      if (this.rainSrc) {
        const src = this.rainSrc
        this.rainSrc = null
        this.rainGain = null
        try { src.stop(this.ctx.currentTime + 2.5) } catch { /* already stopped */ }
        src.onended = () => { try { src.disconnect() } catch { /* already disconnected */ } }
      }
      return
    }
    if (!this.rainSrc) {
      const len = this.ctx.sampleRate * 2
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const data = buf.getChannelData(0)
      let last = 0
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1
        last = (last + 0.35 * white) / 1.35
        data[i] = (last * 1.8 + white * 0.35)
      }
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      const hp = this.ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 900
      const lp = this.ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 6500
      const g = this.ctx.createGain()
      g.gain.value = 0
      src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.master)
      src.start()
      this.rainSrc = src
      this.rainGain = g
    }
    if (this.rainGain && this.ctx) {
      this.rainGain.gain.setTargetAtTime(level * 0.16, this.ctx.currentTime, 1.2)
    }
  }

  /** Fully stop the rain bed (menus are silent — v49). */
  stopRain() {
    this.setRain(0)
  }

  // ---------- crowd ambience ----------
  startCrowd() {
    if (!this.ctx || !this.crowdGain || this.crowdSource) return
    const len = this.ctx.sampleRate * 3
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch)
      let last = 0
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1
        last = (last + 0.02 * white) / 1.02 // brown-ish noise
        data[i] = last * 3.5
      }
    }
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const f = this.ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 900
    src.connect(f); f.connect(this.crowdGain)
    src.start()
    this.crowdSource = src
  }

  setCrowdLevel(v: number) {
    if (!this.ctx || !this.crowdGain) return
    this.crowdGain.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.8)
  }

  /** Fully stop the crowd bed (menus are silent — v48). startCrowd() rebuilds it safely. */
  stopCrowd() {
    if (this.crowdSource) {
      try { this.crowdSource.stop() } catch { /* already stopped */ }
      this.crowdSource.disconnect()
      this.crowdSource = null
    }
    if (this.ctx && this.crowdGain) this.crowdGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4)
  }

  // ---------- adaptive music (tiny step sequencer) ----------
  setTheme(theme: MusicTheme) {
    if (this.theme === theme) return
    this.theme = theme
    this.step = 0
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null }
    // 'none' (or no ctx yet): sequencer stays stopped — silence until the next real theme
    if (!this.ctx || theme === 'none') return
    const tempos: Record<MusicTheme, number> = { menu: 2600, ambient: 3200, chase: 1900, boss: 1550, victory: 2000, none: 3200 }
    this.musicTimer = setInterval(() => this.tickMusic(), tempos[theme])
    this.tickMusic()
  }

  private tickMusic() {
    if (!this.ctx || !this.musicGain) return
    const t = this.ctx.currentTime
    const s = this.step++
    const g = this.musicGain
    switch (this.theme) {
      case 'menu': {
        const bass = [110, 110, 98, 110][s % 4]
        this.osc('triangle', bass, t, 1.4, 0.16, undefined, g)
        if (s % 2 === 0) this.osc('sine', [440, 392, 349, 392][s % 4], t + 0.3, 1.2, 0.05, undefined, g)
        break
      }
      case 'ambient': {
        if (s % 4 === 0) this.osc('sine', 130, t, 2.4, 0.1, undefined, g)
        if (s % 8 === 3) this.osc('triangle', [392, 440, 349][Math.floor(s / 8) % 3], t, 1.8, 0.04, undefined, g)
        break
      }
      case 'chase': {
        const bass = [98, 98, 110, 98, 87, 87, 98, 110][s % 8]
        this.osc('sawtooth', bass, t, 0.16, 0.12, undefined, g)
        if (s % 2 === 0) this.noise(0.05, t, 0.05, 4000, 2, g)
        break
      }
      case 'boss': {
        const bass = [87, 87, 103, 87, 78, 78, 92, 103][s % 8]
        this.osc('sawtooth', bass, t, 0.22, 0.14, undefined, g)
        this.osc('square', bass * 2, t + 0.05, 0.1, 0.04, undefined, g)
        if (s % 4 === 2) this.osc('triangle', [659, 622, 659, 698][Math.floor(s / 4) % 4], t, 0.3, 0.05, undefined, g)
        if (s % 2 === 0) this.noise(0.06, t, 0.07, 3000, 1.5, g)
        break
      }
      case 'victory': {
        const mel = [523, 523, 523, 659, 784, 784, 659, 1046]
        this.osc('triangle', mel[s % 8], t, 0.5, 0.1, undefined, g)
        this.osc('sine', 131, t, 0.8, 0.1, undefined, g)
        break
      }
    }
  }
}

export const AudioManager = new AudioManagerImpl()
export type AudioManagerType = AudioManagerImpl
