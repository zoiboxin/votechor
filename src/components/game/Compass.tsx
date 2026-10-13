'use client'
// Compass strip — cardinal directions + objective markers, relative to camera yaw.
import { useGameStore, type CompassMarker } from '@/lib/game-store'
import { Vote, Flag, Crown, User, Cross, Coffee } from 'lucide-react'

const MARKER_STYLE: Record<CompassMarker['kind'], { icon: typeof Vote; cls: string; label: string }> = {
  token: { icon: Vote, cls: 'bg-[#f2c14e] text-[#1c1a17] border-[#1c1a17]', label: 'token' },
  checkpoint: { icon: Flag, cls: 'bg-[#c9482e] text-[#f5efdc] border-[#1c1a17]', label: 'checkpoint' },
  boss: { icon: Crown, cls: 'bg-[#8c1f28] text-[#f2c14e] border-[#1c1a17]', label: 'boss' },
  chai: { icon: Coffee, cls: 'bg-[#d9822b] text-[#f5efdc] border-[#1c1a17]', label: 'chai — stamina low!' },
  firstaid: { icon: Cross, cls: 'bg-[#ff8fa3] text-[#1c1a17] border-[#1c1a17]', label: 'first-aid — you are hurt!' },
  squad: { icon: User, cls: 'bg-[#4ecdc4] text-[#1c1a17] border-[#1c1a17]', label: 'squad' },
}

const WORLD_TICKS = Array.from({ length: 24 }, (_, i) => i * 15)

export default function Compass() {
  const compass = useGameStore((s) => s.hud.compass)
  const cinematic = useGameStore((s) => s.hud.cinematic)
  const detained = useGameStore((s) => s.hud.detained)
  if (cinematic || detained) return null

  // yawDeg: 0 = looking down -z (north). Cardinal label positions:
  const yaw = compass.yawDeg
  const cardinal = (worldDeg: number) => {
    // world 0 = N, 90 = E; relative = worldDeg - yaw
    let rel = ((worldDeg - yaw + 540) % 360) - 180
    if (Math.abs(rel) > 75) return null
    return rel
  }
  const cardinals: { deg: number; label: string; main: boolean }[] = [
    { worldDeg: 0, label: 'N', main: true },
    { worldDeg: 90, label: 'E', main: false },
    { worldDeg: 180, label: 'S', main: false },
    { worldDeg: 270, label: 'W', main: false },
  ].flatMap((c) => {
    const rel = cardinal(c.worldDeg)
    return rel === null ? [] : [{ deg: rel, label: c.label, main: c.main }]
  })

  const pos = (deg: number) => `calc(50% + ${(Math.max(-72, Math.min(72, deg)) / 72) * 50}%)`

  return (
    <div className="pointer-events-none absolute left-1/2 top-1.5 z-10 w-[240px] -translate-x-1/2 sm:top-2 sm:w-[320px]">
      <div className="relative h-8 overflow-hidden rounded-full border-2 border-[#1c1a17]/80 bg-[#1c1a17]/72 shadow-[3px_3px_0_rgba(28,26,23,0.8)] backdrop-blur-sm">
        {/* tick marks */}
        {WORLD_TICKS.map((wd) => {
          const rel = cardinal(wd)
          if (rel === null) return null
          const major = wd % 90 === 0
          return (
            <span
              key={wd}
              className={`absolute top-1/2 -translate-y-1/2 ${major ? 'h-2.5 w-px bg-[#f5efdc]/35' : 'h-1.5 w-px bg-[#f5efdc]/20'}`}
              style={{ left: pos(rel) }}
            />
          )
        })}
        {/* center needle */}
        <span className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-[#f2a541]/90" />
        {/* cardinals */}
        {cardinals.map((c) => (
          <span
            key={c.label}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] font-black tracking-widest ${c.main ? 'text-[#ff6b5e]' : 'text-[#f5efdc]/75'}`}
            style={{ left: pos(c.deg) }}
          >
            {c.label}
          </span>
        ))}
        {/* objective markers */}
        {compass.markers.map((m, i) => {
          if (Math.abs(m.deg) > 75) return null
          const st = MARKER_STYLE[m.kind]
          const Icon = st.icon
          return (
            <span
              key={`${m.kind}-${i}`}
              className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
              style={{ left: pos(m.deg) }}
              title={`${st.label} — ${m.dist}m`}
            >
              <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${st.cls}`}>
                <Icon className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
              <span className="text-[7px] font-black tabular-nums leading-none text-[#f5efdc]/85">{m.dist}m</span>
            </span>
          )
        })}
      </div>
      {/* under-clip arrows for off-screen markers */}
      <div className="relative mx-auto h-0 w-full">
        {compass.markers.filter((m) => Math.abs(m.deg) > 75).slice(0, 2).map((m, i) => {
          const st = MARKER_STYLE[m.kind]
          const Icon = st.icon
          return (
            <span
              key={`edge-${m.kind}-${i}`}
              className="absolute -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[#1c1a17] shadow-[2px_2px_0_rgba(28,26,23,0.6)]"
              style={{
                left: m.deg < 0 ? '2px' : undefined,
                right: m.deg >= 0 ? '2px' : undefined,
                backgroundColor: m.kind === 'token' ? '#f2c14e' : m.kind === 'boss' ? '#8c1f28' : m.kind === 'squad' ? '#4ecdc4' : m.kind === 'firstaid' ? '#ff8fa3' : m.kind === 'chai' ? '#d9822b' : '#c9482e',
              }}
            >
              <Icon className="h-2 w-2 text-[#1c1a17]" strokeWidth={3} />
            </span>
          )
        })}
      </div>
    </div>
  )
}
