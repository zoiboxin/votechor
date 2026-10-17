'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronUp, Wind, ChevronsDown, Hand, Crosshair, Eye, Megaphone, HeartPulse, Siren, Pause, MessageSquare, Smile, Users } from 'lucide-react'
import { useGameStore } from '@/lib/game-store'
import { vcIsTouchDevice } from '@/lib/touch'

type Bridge = {
  move: (x: number, y: number) => void
  end: () => void
  look: (dx: number, dy: number) => void
  btn: (name: 'sprint' | 'jump' | 'slide' | 'interact' | 'throw' | 'shout' | 'heal' | 'strike', down: boolean) => void
  oneShot: (name: 'pause' | 'squad' | 'emote') => void
}

// Loaded lazily — never statically import '@/game/game' (it drags three.js into SSR)
let cachedBridge: Bridge | null = null
let bridgePromise: Promise<Bridge | null> | null = null
function loadBridge(): Promise<Bridge | null> {
  if (cachedBridge) return Promise.resolve(cachedBridge)
  if (!bridgePromise) {
    bridgePromise = import('@/game/game')
      .then((m) => {
        cachedBridge = m.touchBridge() as Bridge
        return cachedBridge
      })
      .catch(() => null)
  }
  return bridgePromise
}

const JOY_SIZE = 124
const JOY_RADIUS = 62
const KNOB_MAX = 40

export default function TouchControls() {
  // ssr:false wrapper guarantees window exists when this mounts
  const [isTouch] = useState(() => vcIsTouchDevice())
  const [joyActive, setJoyActive] = useState(false)
  const role = useGameStore((s) => s.hud.role)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const [lookUsed, setLookUsed] = useState(false)
  const joyRef = useRef<HTMLDivElement>(null)
  const pointerId = useRef<number | null>(null)
  const lookId = useRef<number | null>(null)
  const lookLast = useRef<{ x: number; y: number } | null>(null)

  // v46 — overlay yielding lives in GameRoot (it unmounts this component while
  // chat / big map / emote wheel / squad manager is open). The unmount cleanup
  // below is what actually matters: it releases every EXTERNAL hold (joystick
  // vector, sprint, interact) so the engine never keeps driving the player
  // underneath a modal or after a pause. Deliberately setState-free — the
  // component's own visual state dies with the unmount.
  function releaseHolds() {
    const b = cachedBridge
    if (b) {
      b.end()
      b.btn('sprint', false)
      b.btn('interact', false)
    }
    pointerId.current = null
    lookId.current = null
    lookLast.current = null
  }

  useEffect(() => {
    if (isTouch) void loadBridge()
  }, [isTouch])

  useEffect(() => () => releaseHolds(), [])

  if (!isTouch) return null

  const bridge = () => cachedBridge

  const onJoyDown = (e: React.PointerEvent) => {
    pointerId.current = e.pointerId
    joyRef.current?.setPointerCapture(e.pointerId)
    setJoyActive(true)
    onJoyMove(e)
  }

  const onJoyMove = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId || !joyRef.current) return
    const rect = joyRef.current.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    let dx = (e.clientX - cx) / JOY_RADIUS
    let dy = (e.clientY - cy) / JOY_RADIUS
    const mag = Math.hypot(dx, dy)
    if (mag > 1) {
      dx /= mag
      dy /= mag
    }
    setKnob({ x: dx * KNOB_MAX, y: dy * KNOB_MAX })
    bridge()?.move(dx, dy)
  }

  const onJoyUp = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId) return
    pointerId.current = null
    setJoyActive(false)
    setKnob({ x: 0, y: 0 })
    bridge()?.end()
  }

  // ---- right-side drag-to-look (camera orbit) ----
  const LOOK_GAIN = 2.6
  const onLookDown = (e: React.PointerEvent) => {
    if (lookId.current !== null) return
    lookId.current = e.pointerId
    lookLast.current = { x: e.clientX, y: e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onLookMove = (e: React.PointerEvent) => {
    if (lookId.current !== e.pointerId || !lookLast.current) return
    const dx = e.clientX - lookLast.current.x
    const dy = e.clientY - lookLast.current.y
    lookLast.current = { x: e.clientX, y: e.clientY }
    if (dx || dy) {
      bridge()?.look(dx * LOOK_GAIN, dy * LOOK_GAIN)
      if (!lookUsed) setLookUsed(true)
    }
  }
  const onLookUp = (e: React.PointerEvent) => {
    if (lookId.current !== e.pointerId) return
    lookId.current = null
    lookLast.current = null
  }

  const holdBtn = (name: 'sprint' | 'interact') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      bridge()?.btn(name, true)
    },
    onPointerUp: () => bridge()?.btn(name, false),
    onPointerCancel: () => bridge()?.btn(name, false),
    onPointerLeave: () => bridge()?.btn(name, false),
  })

  const tapBtn = (name: 'jump' | 'slide' | 'throw' | 'shout' | 'heal' | 'strike') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      bridge()?.btn(name, true)
      setTimeout(() => bridge()?.btn(name, false), 120)
    },
  })

  // v46 — btnBase carries NO bg-color: per-button themes (throw red, interact green,
  // …) used to lose to the base paper bg in Tailwind v4's arbitrary-value cascade,
  // washing every colored pad button back to beige. Each button now declares its
  // own bg explicitly; `paperBtn` is the neutral default.
  const btnBase =
    'pointer-events-auto flex h-14 w-14 select-none items-center justify-center rounded-full border-2 border-[#1c1a17]/80 shadow-[3px_3px_0_rgba(28,26,23,0.8)] backdrop-blur-sm transition-transform active:scale-95 active:bg-[#f2c14e] touch-none'
  const paperBtn = `${btnBase} bg-[#f5efdc]/92 text-[#1c1a17]`

  // v46 — compact utility chip for the bottom-center system row (36px, paper style)
  const utilBtn =
    'pointer-events-auto flex h-9 w-9 select-none items-center justify-center rounded-xl border-2 border-[#1c1a17]/80 bg-[#f5efdc]/92 text-[#1c1a17] shadow-[2px_2px_0_rgba(28,26,23,0.7)] backdrop-blur-sm transition-transform active:scale-90 active:bg-[#f2c14e] touch-none'

  return (
    <div className="pointer-events-none fixed inset-0 z-30 select-none touch-none">
      {/* drag-to-look layer — right half, sits UNDER the action buttons */}
      <div
        onPointerDown={onLookDown}
        onPointerMove={onLookMove}
        onPointerUp={onLookUp}
        onPointerCancel={onLookUp}
        className="pointer-events-auto absolute inset-y-0 right-0 w-1/2 touch-none"
        aria-label="Camera look area — drag to orbit the camera"
      />
      {/* look affordance hint — fades out after first use */}
      <div
        className={`pointer-events-none absolute right-8 top-[30%] flex items-center gap-1.5 rounded-full border border-[#f5efdc]/40 bg-[#1c1a17]/55 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-[#f5efdc]/85 backdrop-blur-sm transition-opacity duration-700 ${lookUsed ? 'opacity-0' : 'opacity-100 animate-pulse'}`}
      >
        <Eye className="h-3 w-3" /> drag to look
      </div>

      {/* joystick */}
      <div
        ref={joyRef}
        onPointerDown={onJoyDown}
        onPointerMove={onJoyMove}
        onPointerUp={onJoyUp}
        onPointerCancel={onJoyUp}
        className={`pointer-events-auto absolute bottom-40 left-4 flex items-center justify-center rounded-full border-2 bg-[#1c1a17]/25 backdrop-blur-sm transition-colors touch-none ${
          joyActive ? 'border-[#f2c14e]' : 'border-[#1c1a17]/60'
        }`}
        style={{ width: JOY_SIZE, height: JOY_SIZE }}
      >
        <div
          className={`h-12 w-12 rounded-full border-2 border-[#1c1a17]/80 shadow-[2px_2px_0_rgba(28,26,23,0.7)] transition-colors ${
            joyActive ? 'bg-[#f2c14e]' : 'bg-[#f5efdc]/85'
          }`}
          style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
        />
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] font-black uppercase tracking-widest text-[#f5efdc]/70">
          Move
        </span>
      </div>

      {/* v46 — system utility row, bottom-center (portrait + landscape safe):
          sprint-hold plus the four system surfaces touch players had NO access to
          before (pause / chat / emote / squad manager were keyboard-only). */}
      <div className="absolute bottom-12 left-1/2 flex -translate-x-1/2 items-center gap-1.5">
        <button
          className={`${utilBtn} h-10 w-10 bg-[#f2a541]/90`}
          title="Sprint (hold)"
          aria-label="Sprint — hold"
          {...holdBtn('sprint')}
        >
          <Wind className="h-4.5 w-4.5" />
        </button>
        <button className={utilBtn} title="Pause menu" aria-label="Pause menu" onClick={() => bridge()?.oneShot('pause')}>
          <Pause className="h-4 w-4" />
        </button>
        <button
          className={utilBtn}
          title="Protest comms — chat + share location"
          aria-label="Open chat and location share"
          onClick={() => useGameStore.getState().toggleChat()}
        >
          <MessageSquare className="h-4 w-4" />
        </button>
        <button className={utilBtn} title="Emote wheel (G)" aria-label="Open emote wheel" onClick={() => bridge()?.oneShot('emote')}>
          <Smile className="h-4 w-4" />
        </button>
        <button className={utilBtn} title="Squad manager (Tab)" aria-label="Open squad manager" onClick={() => bridge()?.oneShot('squad')}>
          <Users className="h-4 w-4" />
        </button>
      </div>

      {/* action buttons — 3-col pad, 2 rows for protesters (+1 wide baton row for police).
          bottom-46 (184px) keeps the pad clear of the 172px sm-size radar; in landscape
          the pad shifts left of the right-edge chip column so chips, radar and pad
          never share a column (phones are only ~390px tall). */}
      <div className="absolute bottom-46 right-4 grid grid-cols-3 gap-2 landscape:right-[200px]">
        <button className={paperBtn} title="Jump" {...tapBtn('jump')}>
          <span className="flex flex-col items-center leading-none">
            <ChevronUp className="h-5 w-5" />
            <span className="mt-0.5 text-[8px] font-black">JUMP</span>
          </span>
        </button>
        <button className={`${btnBase} bg-[#8c1f28]/90 text-[#f5efdc] active:bg-[#a52631]`} title="Throw" {...tapBtn('throw')}>
          <span className="flex flex-col items-center leading-none">
            <Crosshair className="h-5 w-5" />
            <span className="mt-0.5 text-[8px] font-black">Q</span>
          </span>
        </button>
        <button className={`${btnBase} bg-[#2e6e4e]/90 text-[#f5efdc] active:bg-[#3a8560]`} title="Interact (hold)" {...holdBtn('interact')}>
          <span className="flex flex-col items-center leading-none">
            <Hand className="h-5 w-5" />
            <span className="mt-0.5 text-[8px] font-black">E</span>
          </span>
        </button>
        <button className={paperBtn} title="Slide" {...tapBtn('slide')}>
          <span className="flex flex-col items-center leading-none">
            <ChevronsDown className="h-5 w-5" />
            <span className="mt-0.5 text-[8px] font-black">SLIDE</span>
          </span>
        </button>
        <button className={`${btnBase} bg-[#f2c14e]/90`} title="Shout / Whistle — attracts police (V)" {...tapBtn('shout')}>
          <span className="flex flex-col items-center leading-none">
            <Megaphone className="h-5 w-5" />
            <span className="mt-0.5 text-[8px] font-black">SHOUT</span>
          </span>
        </button>
        <button className={`${btnBase} bg-[#ff8fa3]/90`} title="Quick Heal — eat best food (H)" {...tapBtn('heal')}>
          <span className="flex flex-col items-center leading-none">
            <HeartPulse className="h-5 w-5" />
            <span className="mt-0.5 text-[8px] font-black">HEAL</span>
          </span>
        </button>
        {role === 'police' && (
          <button className={`${btnBase} col-span-3 w-full rounded-2xl bg-[#3d5a80]/90 text-[#f5efdc]`} title="Baton strike (F) — hit rowdy protesters" {...tapBtn('strike')}>
            <span className="flex items-center gap-1.5 leading-none">
              <Siren className="h-4 w-4" />
              <span className="text-[8px] font-black">BATON</span>
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
