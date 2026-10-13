'use client'

import { useEffect, useRef } from 'react'
import { useGameStore } from '@/lib/game-store'
import { X, MapPin, Crown, Flag, Vote, Circle } from 'lucide-react'
import { motion } from 'framer-motion'

// Hardcoded from world-def: world z range 10 → -572 mapped onto 0..100% of the strip height.
// toY(z) = ((10 - z) / 582) * 100
const ZONES = [
  { name: 'Protest Plaza', top: 1.03, height: 14.43, tone: 'bg-[#c96f4a]/25' },
  { name: 'Chowk Market', top: 15.46, height: 20.62, tone: 'bg-[#b85c3e]/25' },
  { name: 'Security Checkpoint', top: 36.08, height: 13.75, tone: 'bg-[#7f9a8c]/25' },
  { name: 'Grand Avenue', top: 49.83, height: 24.06, tone: 'bg-[#c9a86a]/25' },
  { name: 'Government District', top: 73.88, height: 26.12, tone: 'bg-[#9a7b5f]/30' },
]

const CHECKPOINTS = [
  { name: 'Plaza Gate', z: -78 },
  { name: 'Market Exit', z: -198 },
  { name: 'Security Gate', z: -278 },
  { name: 'Avenue Junction', z: -418 },
]

const yFor = (z: number) => ((10 - z) / 582) * 100

export default function BigMap({ minimapBuffer }: { minimapBuffer: React.RefObject<HTMLCanvasElement | null> }) {
  const open = useGameStore((s) => s.mapOpen)
  const toggleMap = useGameStore((s) => s.toggleMap)
  const zoneName = useGameStore((s) => s.hud.zoneName)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!open) return
    let raf = 0
    const draw = () => {
      const buf = minimapBuffer.current
      const vis = canvasRef.current
      if (buf && vis) {
        const ctx = vis.getContext('2d')
        if (ctx) {
          ctx.imageSmoothingEnabled = false
          ctx.clearRect(0, 0, vis.width, vis.height)
          ctx.drawImage(buf, 0, 0, vis.width, vis.height)
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [open, minimapBuffer])

  if (!open) return null

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-[#1c1a17]/70 backdrop-blur-sm" onClick={() => toggleMap(false)}>
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22 }}
        className="vc-paper relative flex max-h-[92vh] gap-3 overflow-hidden rounded-3xl border-2 border-[#1c1a17]/80 p-4 shadow-[8px_8px_0_rgba(28,26,23,0.85)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* map column */}
        <div className="flex min-h-0 flex-col">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-lg font-black uppercase tracking-tight text-[#1c1a17]">
              City Map <span className="text-[#8c1f28]">— The Long Walk</span>
            </h3>
            <button
              onClick={() => toggleMap(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border-2 border-[#1c1a17]/70 bg-[#f5efdc] text-[#1c1a17] shadow-[2px_2px_0_#1c1a17] transition-all hover:bg-[#f2c14e] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_#1c1a17]"
              aria-label="Close map"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div
            className="relative overflow-hidden rounded-2xl border-2 border-[#1c1a17]/80 bg-[#1c1a17]"
            style={{ height: 'min(70vh, 640px)', aspectRatio: '320 / 700' }}
          >
            <canvas ref={canvasRef} width={320} height={700} className="absolute inset-0 h-full w-full" />

            {/* zone overlays */}
            {ZONES.map((z) => (
              <div
                key={z.name}
                className={`absolute inset-x-0 border-y border-dashed border-[#f5efdc]/25 ${z.tone}`}
                style={{ top: `${z.top}%`, height: `${z.height}%` }}
              >
                <span className={`absolute left-1.5 top-0.5 text-[9px] font-black uppercase tracking-wider sm:text-[11px] ${zoneName === z.name ? 'text-[#f2c14e]' : 'text-[#f5efdc]/70'}`}>
                  {z.name}
                </span>
              </div>
            ))}

            {/* checkpoint markers */}
            {CHECKPOINTS.map((c) => (
              <div
                key={c.name}
                className="absolute flex items-center gap-1"
                style={{ top: `${yFor(c.z)}%`, left: '56%' }}
              >
                <Flag className="h-3 w-3 text-[#c9482e]" />
                <span className="whitespace-nowrap text-[8px] font-black uppercase tracking-wide text-[#f5efdc]/80 sm:text-[9px]">
                  {c.name}
                </span>
              </div>
            ))}

            {/* boss arena marker */}
            <div className="absolute flex items-center gap-1" style={{ top: `${yFor(-520)}%`, left: '56%' }}>
              <Crown className="h-3.5 w-3.5 text-[#8c1f28]" />
              <span className="whitespace-nowrap text-[8px] font-black uppercase tracking-wide text-[#f2a541] sm:text-[9px]">
                Vote Collector Arena
              </span>
            </div>

            {/* compass */}
            <span className="absolute right-1.5 top-1 rounded bg-[#1c1a17]/70 px-1 text-[8px] font-black uppercase tracking-widest text-[#f5efdc]/70">
              ▲ North (Plaza)
            </span>
          </div>
        </div>

        {/* legend column */}
        <div className="vc-scroll hidden w-44 shrink-0 overflow-y-auto sm:block">
          <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-[#8c1f28]">Legend</div>
          <ul className="space-y-1.5 text-[10px] font-bold text-[#1c1a17]/80">
            <li className="flex items-center gap-2"><Circle className="h-3 w-3 fill-[#c9482e] text-[#c9482e]" /> Checkpoint (red = locked)</li>
            <li className="flex items-center gap-2"><Circle className="h-3 w-3 fill-[#4e9b6e] text-[#4e9b6e]" /> Checkpoint (green = yours)</li>
            <li className="flex items-center gap-2"><Vote className="h-3 w-3 text-[#e0a63a]" /> Stolen vote token</li>
            <li className="flex items-center gap-2"><Circle className="h-3 w-3 fill-[#3a6ea5] text-[#3a6ea5]" /> Patrol</li>
            <li className="flex items-center gap-2"><Circle className="h-3 w-3 fill-[#ff3b30] text-[#ff3b30]" /> Patrol chasing someone</li>
            <li className="flex items-center gap-2"><Circle className="h-3 w-3 fill-[#4ecdc4] text-[#4ecdc4]" /> Squadmate</li>
            <li className="flex items-center gap-2"><Circle className="h-3 w-3 fill-white text-[#1c1a17]" /> You, brave arrow</li>
            <li className="flex items-center gap-2"><Crown className="h-3 w-3 text-[#8c1f28]" /> Boss gate + arena</li>
          </ul>
          <div className="mt-3 rounded-xl border-2 border-dashed border-[#8c1f28]/50 bg-[#f2c14e]/25 p-2">
            <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[#8c1f28]">
              <MapPin className="h-3 w-3" /> Current zone
            </div>
            <p className="mt-0.5 text-xs font-black uppercase tracking-tight text-[#1c1a17]">{zoneName}</p>
          </div>
          <p className="mt-3 text-[9px] font-semibold leading-relaxed text-[#1c1a17]/55">
            The map is drawn live by the engine. Tokens you have already grabbed will not appear — they are safely
            in your pockets, where votes belong.
          </p>
          <p className="mt-2 text-center text-[9px] font-bold uppercase tracking-widest text-[#1c1a17]/40">M to close</p>
        </div>
      </motion.div>
    </div>
  )
}
