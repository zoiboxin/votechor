'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronUp, Wind, ChevronsDown, Hand, Crosshair, Eye } from 'lucide-react'

type Bridge = {
  move: (x: number, y: number) => void
  end: () => void
  look: (dx: number, dy: number) => void
  btn: (name: 'sprint' | 'jump' | 'slide' | 'interact' | 'throw', down: boolean) => void
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
  const [isTouch] = useState(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0)
  const [joyActive, setJoyActive] = useState(false)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const [lookUsed, setLookUsed] = useState(false)
  const joyRef = useRef<HTMLDivElement>(null)
  const pointerId = useRef<number | null>(null)
  const lookId = useRef<number | null>(null)
  const lookLast = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (isTouch) void loadBridge()
  }, [isTouch])

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

  const tapBtn = (name: 'jump' | 'slide' | 'throw') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      bridge()?.btn(name, true)
      setTimeout(() => bridge()?.btn(name, false), 120)
    },
  })

  const btnBase =
    'pointer-events-auto flex h-14 w-14 select-none items-center justify-center rounded-full border-2 border-[#1c1a17]/80 bg-[#f5efdc]/92 text-[#1c1a17] shadow-[3px_3px_0_rgba(28,26,23,0.8)] backdrop-blur-sm transition-transform active:scale-95 active:bg-[#f2c14e] touch-none'

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
        className={`pointer-events-none absolute right-8 top-[42%] flex items-center gap-1.5 rounded-full border border-[#f5efdc]/40 bg-[#1c1a17]/55 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-[#f5efdc]/85 backdrop-blur-sm transition-opacity duration-700 ${lookUsed ? 'opacity-0' : 'opacity-100 animate-pulse'}`}
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

      {/* action buttons */}
      <div className="absolute bottom-44 right-4 grid grid-cols-2 gap-2.5">
        <button className={`${btnBase} bg-[#2e6e4e]/90 text-[#f5efdc]`} title="Interact (hold)" {...holdBtn('interact')}>
          <span className="flex flex-col items-center leading-none">
            <Hand className="h-5 w-5" />
            <span className="mt-0.5 text-[8px] font-black">E</span>
          </span>
        </button>
        <button className={`${btnBase} bg-[#8c1f28]/90 text-[#f5efdc]`} title="Throw" {...tapBtn('throw')}>
          <span className="flex flex-col items-center leading-none">
            <Crosshair className="h-5 w-5" />
            <span className="mt-0.5 text-[8px] font-black">Q</span>
          </span>
        </button>
        <button className={btnBase} title="Jump" {...tapBtn('jump')}>
          <span className="flex flex-col items-center leading-none">
            <ChevronUp className="h-5 w-5" />
            <span className="mt-0.5 text-[8px] font-black">JUMP</span>
          </span>
        </button>
        <button className={btnBase} title="Slide" {...tapBtn('slide')}>
          <span className="flex flex-col items-center leading-none">
            <ChevronsDown className="h-5 w-5" />
            <span className="mt-0.5 text-[8px] font-black">SLIDE</span>
          </span>
        </button>
      </div>

      {/* sprint — big hold button below the grid */}
      <button
        className={`${btnBase} absolute bottom-44 right-20 h-14 w-14 bg-[#f2a541]/90`}
        title="Sprint (hold)"
        {...holdBtn('sprint')}
      >
        <span className="flex flex-col items-center leading-none">
          <Wind className="h-5 w-5" />
          <span className="mt-0.5 text-[8px] font-black">RUN</span>
        </span>
      </button>
    </div>
  )
}
