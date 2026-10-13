'use client'
// PhotoHud — minimal viewfinder UI shown while photo mode is active.
// All real HUD is hidden; only a frame border, film info strip, and three controls remain.
import { useGameStore, uiActions } from '@/lib/game-store'
import { Camera, Aperture, Download, X, ZoomIn, ZoomOut } from 'lucide-react'
import { motion } from 'framer-motion'

const FILTER_NAMES = ['Natural', 'Poster Punch', 'Vintage Press', 'Committee Noir']

export default function PhotoHud() {
  const photoFilter = useGameStore((s) => s.photoFilter)

  return (
    <div className="pointer-events-none fixed inset-0 z-30 select-none">
      {/* viewfinder frame */}
      <div className="absolute inset-2 rounded-2xl border-2 border-[#f5efdc]/35 sm:inset-4" />
      <div className="absolute left-3 top-3 flex items-center gap-2 sm:left-5 sm:top-5">
        <span className="flex items-center gap-1.5 rounded-full border border-[#f5efdc]/40 bg-[#1c1a17]/70 px-3 py-1 text-[10px] font-black uppercase tracking-[0.25em] text-[#f5efdc] backdrop-blur-sm">
          <Camera className="h-3.5 w-3.5 text-[#f2a541]" /> Protest Press Camera
        </span>
        <span className="hidden rounded-full border border-[#f5efdc]/25 bg-[#1c1a17]/60 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-[#f2c14e] backdrop-blur-sm sm:block">
          {FILTER_NAMES[photoFilter]}
        </span>
      </div>
      {/* corner ticks */}
      {['left-3 top-3 border-l-2 border-t-2 sm:left-5 sm:top-5', 'right-3 top-3 border-r-2 border-t-2 sm:right-5 sm:top-5', 'bottom-3 left-3 border-b-2 border-l-2 sm:bottom-5 sm:left-5', 'bottom-3 right-3 border-b-2 border-r-2 sm:bottom-5 sm:right-5'].map((cls) => (
        <span key={cls} className={`absolute h-6 w-6 border-[#f2a541]/80 ${cls}`} />
      ))}

      {/* control strip */}
      <div className="pointer-events-auto absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc]/92 p-1.5 shadow-[4px_4px_0_rgba(28,26,23,0.8)] backdrop-blur-sm">
        <button
          onClick={() => uiActions().photoToggle()}
          title="Exit photo mode (P)"
          className="flex items-center gap-1.5 rounded-xl border-2 border-[#1c1a17]/70 bg-[#c9482e] px-3 py-2 text-[10px] font-black uppercase tracking-wide text-[#f5efdc] transition-all hover:-translate-y-0.5 active:translate-y-0"
        >
          <X className="h-3.5 w-3.5" strokeWidth={3} /> Exit
        </button>
        <div className="flex items-center overflow-hidden rounded-xl border-2 border-[#1c1a17]/70 bg-[#f5efdc]">
          <button
            onClick={() => uiActions().photoZoom(-1)}
            title="Zoom out (mouse wheel)"
            className="flex h-8 w-8 items-center justify-center text-[#1c1a17] transition-colors hover:bg-[#f2c14e] active:bg-[#e0a63a]"
          >
            <ZoomOut className="h-4 w-4" strokeWidth={3} />
          </button>
          <span className="h-5 w-px bg-[#1c1a17]/25" />
          <button
            onClick={() => uiActions().photoZoom(1)}
            title="Zoom in (mouse wheel)"
            className="flex h-8 w-8 items-center justify-center text-[#1c1a17] transition-colors hover:bg-[#f2c14e] active:bg-[#e0a63a]"
          >
            <ZoomIn className="h-4 w-4" strokeWidth={3} />
          </button>
        </div>
        <button
          onClick={() => uiActions().photoFilter()}
          title="Cycle filter (O)"
          className="flex items-center gap-1.5 rounded-xl border-2 border-[#1c1a17]/70 bg-[#f5efdc] px-3 py-2 text-[10px] font-black uppercase tracking-wide text-[#1c1a17] transition-all hover:-translate-y-0.5 hover:bg-[#f2c14e] active:translate-y-0"
        >
          <Aperture className="h-3.5 w-3.5" strokeWidth={3} /> {FILTER_NAMES[photoFilter]}
        </button>
        <button
          onClick={() => uiActions().photoSnapshot()}
          title="Save snapshot (K)"
          className="flex items-center gap-1.5 rounded-xl border-2 border-[#1c1a17]/70 bg-[#1c1a17] px-3.5 py-2 text-[10px] font-black uppercase tracking-wide text-[#f2c14e] transition-all hover:-translate-y-0.5 active:translate-y-0"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={3} /> Snapshot
        </button>
      </div>

      {/* key hints (desktop) */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="absolute right-3 top-3 hidden rounded-xl border border-[#f5efdc]/30 bg-[#1c1a17]/65 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-[#f5efdc]/80 backdrop-blur-sm sm:right-5 sm:top-5 sm:block"
      >
        P exit · O filter · K snapshot · wheel zoom
      </motion.div>
    </div>
  )
}
