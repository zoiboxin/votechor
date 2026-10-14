// VoteChor input manager — keyboard, mouse (pointer lock), and touch state.
export interface InputState {
  forward: number // -1..1
  strafe: number  // -1..1
  jump: boolean   // held
  sprint: boolean
  slide: boolean
  interact: boolean
  lookDx: number
  lookDy: number
}

type OneShot = 'jump' | 'slide' | 'interact' | 'throw' | 'emote' | 'map' | 'squad' | 'pause' | 'respawn' | 'useItem' | 'gift'

export class InputManager {
  state: InputState = { forward: 0, strafe: 0, jump: false, sprint: false, slide: false, interact: false, lookDx: 0, lookDy: 0 }
  keys = new Set<string>()
  keybinds: Record<string, string> = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft', slide: 'KeyC', interact: 'KeyE', throw: 'KeyQ', emote: 'KeyG', map: 'KeyM', squad: 'Tab', pause: 'Escape', gift: 'KeyF' }
  enabled = false
  /** While true (map/big overlay open) movement output is zeroed but keys + one-shots keep working. */
  suppressed = false
  /** When false, losing pointer lock (intentional release for map UI) does not fire the pause one-shot. */
  pauseOnUnlock = true
  pointerLocked = false
  sensitivity = 1
  invertY = false
  onOneShot: ((a: OneShot) => void) | null = null
  // touch joystick (set by React components)
  touchMove = { x: 0, y: 0 }
  touchActive = false
  touchButtons = { sprint: false, jump: false, slide: false, interact: false, throw: false }
  private el: HTMLElement
  private handlers: [string, EventListener, EventTarget][] = []

  constructor(el: HTMLElement) {
    this.el = el
    const add = (target: EventTarget, type: string, fn: EventListener) => {
      target.addEventListener(type, fn, type === 'keydown' || type === 'keyup' ? { capture: true } : undefined)
      this.handlers.push([type, fn, target])
    }
    add(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true))
    add(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false))
    add(document, 'pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.el
      if (!this.pointerLocked && this.enabled && this.pauseOnUnlock) this.onOneShot?.('pause')
    })
    add(el, 'mousemove', (e) => {
      if (!this.pointerLocked || !this.enabled) return
      const me = e as MouseEvent
      this.state.lookDx += me.movementX * 0.0022 * this.sensitivity
      this.state.lookDy += me.movementY * 0.0022 * this.sensitivity * (this.invertY ? -1 : 1)
    })
    add(el, 'click', () => {
      if (this.enabled && !this.pointerLocked) this.requestLock()
    })
    add(window, 'blur', () => { this.keys.clear(); this.sync() })
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (!this.enabled) return
    // Normalize: some environments (automation, IMEs) send empty `code`
    const code = normalizeKeyCode(e)
    // Prevent browser scrolling etc for game keys
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code) || Object.values(this.keybinds).includes(code)) {
      e.preventDefault()
    }
    if (down && this.keys.has(code)) return // ignore auto-repeat for one-shots
    if (down) this.keys.add(code)
    else this.keys.delete(code)

    const bind = (action: string) => this.keybinds[action] === code
    if (down) {
      if (bind('jump')) this.onOneShot?.('jump')
      if (bind('slide')) this.onOneShot?.('slide')
      if (bind('throw')) this.onOneShot?.('throw')
      if (bind('emote')) this.onOneShot?.('emote')
      if (bind('map')) this.onOneShot?.('map')
      if (bind('squad')) this.onOneShot?.('squad')
      if (bind('pause')) this.onOneShot?.('pause')
      if (bind('gift')) this.onOneShot?.('gift')
    }
    this.sync()
  }

  /** Recompute derived input state (called after any input source changes).
   *  While suppressed (map open) movement output is zeroed but key tracking + one-shots stay live,
   *  so M/Escape can still close the overlay. */
  sync() {
    const k = this.keys, b = this.keybinds
    let f = 0, s = 0
    if (!this.suppressed) {
      if (k.has(b.forward) || k.has('ArrowUp')) f += 1
      if (k.has(b.back) || k.has('ArrowDown')) f -= 1
      if (k.has(b.left) || k.has('ArrowLeft')) s -= 1
      if (k.has(b.right) || k.has('ArrowRight')) s += 1
      if (this.touchActive) { f += -this.touchMove.y; s += this.touchMove.x }
    }
    const clamp = (v: number) => Math.max(-1, Math.min(1, v))
    this.state.forward = clamp(f)
    this.state.strafe = clamp(s)
    this.state.jump = !this.suppressed && (k.has(b.jump) || this.touchButtons.jump)
    this.state.sprint = !this.suppressed && (k.has(b.sprint) || this.touchButtons.sprint)
    this.state.slide = !this.suppressed && (k.has(b.slide) || this.touchButtons.slide)
    this.state.interact = !this.suppressed && (k.has(b.interact) || this.touchButtons.interact)
  }

  consumeLook(): [number, number] {
    const dx = this.state.lookDx, dy = this.state.lookDy
    this.state.lookDx = 0; this.state.lookDy = 0
    return [dx, dy]
  }

  /** Feed raw look deltas (touch drag-to-look). Applies sensitivity + invertY like mouse. */
  addLook(dx: number, dy: number) {
    if (!this.enabled) return
    this.state.lookDx += dx * 0.0022 * this.sensitivity
    this.state.lookDy += dy * 0.0022 * this.sensitivity * (this.invertY ? -1 : 1)
  }

  setEnabled(v: boolean) {
    this.enabled = v
    if (!v) { this.keys.clear(); this.sync() }
    else if (!this.pointerLocked && matchMedia('(pointer: fine)').matches) this.requestLock()
  }

  /** Drop every held key (used when an overlay opens so the protester stops mid-stride). */
  clearKeys() {
    this.keys.clear()
    this.sync()
  }

  /** Release pointer lock WITHOUT triggering the pause one-shot (used when the map opens). */
  releasePointer() {
    this.pauseOnUnlock = false
    if (this.pointerLocked) document.exitPointerLock?.()
  }

  /** requestPointerLock that swallows cooldown/gesture rejections (Chrome rate-limits re-locks). */
  requestLock() {
    try {
      const r = this.el.requestPointerLock?.() as unknown
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => { /* cooldown — canvas click re-locks */ })
    } catch { /* pointer lock unavailable */ }
  }

  dispose() {
    for (const [type, fn, target] of this.handlers) target.removeEventListener(type, fn)
    this.handlers = []
  }
}

/** Map a KeyboardEvent to a stable code, tolerating empty `code` fields. */
function normalizeKeyCode(e: KeyboardEvent): string {
  if (e.code) return e.code
  const k = e.key ?? ''
  if (!k) return ''
  if (k === ' ') return 'Space'
  if (k === 'Shift') return 'ShiftLeft'
  if (k === 'Control') return 'ControlLeft'
  if (k === 'Alt') return 'AltLeft'
  if (k === 'Meta') return 'MetaLeft'
  if (k.length === 1) return 'Key' + k.toUpperCase()
  return k // ArrowUp, Tab, Escape, Enter…
}
