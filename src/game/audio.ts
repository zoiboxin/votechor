// VoteChor audio — fully synthesized WebAudio: SFX, crowd ambience, adaptive music.
// No external audio assets; everything generated procedurally.
'use client'

export type SfxName =
  | 'footstep' | 'footstepRun' | 'jump' | 'doublejump' | 'land' | 'slide' | 'whistle' | 'whistleFar'
  | 'pickup' | 'token' | 'throw' | 'impact' | 'hit' | 'policehit' | 'vault' | 'capture' | 'release'
  | 'heal' | 'revive' | 'checkpoint' | 'uiClick' | 'uiHover' | 'bossHit' | 'stampSlam'
  | 'shockwave' | 'paperRustle' | 'dizzy' | 'victory' | 'defeat' | 'cash' | 'horn' | 'moo' | 'gate'
  | 'shout' | 'thunder'

export type MusicTheme = 'menu' | 'ambient' | 'chase' | 'boss' | 'victory'

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

  private osc(type: OscillatorType, freq: number, t: number, dur: number, peak: number, slideTo?: number, dest?: AudioNode) {
    if (!this.ctx || !this.sfxGain) return
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur)
    this.env(g, t, 0.008, dur, peak)
    o.connect(g); g.connect(dest ?? this.sfxGain)
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
    src.connect(f); f.connect(g); g.connect(dest ?? this.sfxGain)
    src.start(t)
  }

  play(name: SfxName, volume = 1) {
    if (!this.ctx || !this.sfxGain) return
    const t = this.ctx.currentTime
    const v = volume
    switch (name) {
      case 'footstep': this.noise(0.08, t, 0.12 * v, 500 + Math.random() * 300, 0.8); break
      case 'footstepRun': this.noise(0.09, t, 0.2 * v, 600 + Math.random() * 400, 0.8); this.osc('triangle', 90, t, 0.05, 0.06 * v); break
      case 'jump': this.osc('sine', 260, t, 0.18, 0.16 * v, 480); break
      case 'doublejump': {
        // distinctive whoosh-flap: layered filtered-noise sweeps + quick flutter blips
        this.noise(0.28, t, 0.14 * v, 900, 0.6)
        this.noise(0.22, t + 0.05, 0.1 * v, 2000, 0.7)
        this.osc('sine', 340, t, 0.26, 0.1 * v, 820)
        this.osc('triangle', 520, t + 0.02, 0.09, 0.06 * v, 700)
        this.osc('triangle', 660, t + 0.11, 0.09, 0.05 * v, 880)
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
      case 'land': this.noise(0.12, t, 0.25 * v, 300, 0.7); break
      case 'slide': this.noise(0.4, t, 0.16 * v, 900, 0.5); break
      case 'whistle': {
        this.osc('sine', 2100, t, 0.14, 0.14 * v, 2400)
        this.osc('sine', 2600, t + 0.16, 0.18, 0.14 * v, 2200)
        break
      }
      case 'shout': {
        // human-ish street yell — formant-ish saw sweep + breath noise + chest thump
        this.osc('sawtooth', 240, t, 0.24, 0.16 * v, 140)
        this.osc('square', 480, t + 0.02, 0.16, 0.05 * v, 320)
        this.noise(0.14, t, 0.07 * v, 950, 0.7)
        break
      }
      case 'whistleFar': this.osc('sine', 1900, t, 0.3, 0.05 * v, 2300); break
      case 'pickup': this.osc('sine', 660, t, 0.1, 0.14 * v, 880); this.osc('sine', 880, t + 0.07, 0.12, 0.12 * v, 1100); break
      case 'token': {
        for (let i = 0; i < 4; i++) this.osc('triangle', 700 + i * 160, t + i * 0.06, 0.14, 0.12 * v)
        break
      }
      case 'throw': this.noise(0.15, t, 0.1 * v, 1200, 0.6); break
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
      case 'moo': this.osc('sawtooth', 180, t, 0.5, 0.12 * v, 120); break
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

  /** level 0..1 — smoothly fades a looping filtered-noise rain bed in/out */
  setRain(level: number) {
    if (!this.ctx || !this.master) return
    if (level > 0.01 && !this.rainSrc) {
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

  // ---------- adaptive music (tiny step sequencer) ----------
  setTheme(theme: MusicTheme) {
    if (this.theme === theme) return
    this.theme = theme
    this.step = 0
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null }
    if (!this.ctx) return
    const tempos: Record<MusicTheme, number> = { menu: 2600, ambient: 3200, chase: 1900, boss: 1550, victory: 2000 }
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
