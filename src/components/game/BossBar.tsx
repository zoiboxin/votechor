'use client'

import { useGameStore } from '@/lib/game-store'
import { BOSS_NAME, BOSS_PHASE_NAMES } from '@/game/shared/constants'
import { Vote, Crown, Zap, ScrollText, AlertTriangle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

const PHASE_ICONS = [Crown, ScrollText, ScrollText, Zap, Vote, Vote]

export default function BossBar() {
  const boss = useGameStore((s) => s.boss)
  const healthPct = Math.max(0, Math.min(100, (boss.health / Math.max(1, boss.maxHealth)) * 100))
  const progressPct = Math.max(0, Math.min(100, boss.progress * 100))
  const phaseName = boss.phaseName || BOSS_PHASE_NAMES[boss.phase] || 'Committee In Session'
  const PhaseIcon = PHASE_ICONS[boss.phase] ?? Crown

  return (
    <AnimatePresence>
      {boss.active && (
        <motion.div
          key="bossbar"
          initial={{ opacity: 0, y: -30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ type: 'spring', stiffness: 160, damping: 16 }}
          className="pointer-events-none absolute left-1/2 top-12 z-20 w-[min(560px,92vw)] -translate-x-1/2 scale-95 sm:top-3 sm:scale-100"
        >
          <div className="rounded-2xl border-2 border-[#1c1a17]/90 bg-[#1c1a17]/92 p-2.5 shadow-[5px_5px_0_rgba(28,26,23,0.7)] backdrop-blur-sm">
            {/* header row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border-2 border-[#f2c14e] bg-[#8c1f28]">
                  <Crown className="h-4 w-4 text-[#f2c14e]" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-black uppercase tracking-tight text-[#f5efdc] sm:text-base">
                    THE GREAT VOTE COLLECTOR
                  </div>
                  <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-[#f2a541]">
                    <PhaseIcon className="h-3 w-3" />
                    Phase {Math.max(1, boss.phase)}: {phaseName}
                  </div>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#f5efdc]/60">Health</div>
                <div className="text-sm font-black tabular-nums text-[#c9482e]">{Math.round(boss.health)}<span className="text-[#f5efdc]/50">/{boss.maxHealth}</span></div>
              </div>
            </div>

            {/* shield bar with 5 phase segments */}
            <div className="mt-2 flex gap-1">
              {[1, 2, 3, 4, 5].map((p) => (
                <div key={p} className="h-3 flex-1 overflow-hidden rounded-md border border-[#f5efdc]/25 bg-[#f5efdc]/10">
                  <div
                    className={`h-full transition-[width] duration-300 ${
                      boss.phase > p ? 'bg-[#2e6e4e]' : boss.phase === p ? 'bg-gradient-to-r from-[#f2a541] to-[#8c1f28]' : ''
                    }`}
                    style={{ width: boss.phase > p ? '100%' : boss.phase === p ? `${healthPct}%` : '0%' }}
                  />
                </div>
              ))}
            </div>

            {/* objective + progress */}
            <div className="mt-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[10px] font-bold uppercase tracking-wide text-[#f5efdc]/80">
                  {boss.objectiveText || 'Disrupt the committee'}
                </span>
                {boss.phase === 5 && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full border border-[#f2c14e] bg-[#f2c14e]/15 px-2 py-0.5 text-[10px] font-black tabular-nums text-[#f2c14e]">
                    <Vote className="h-3 w-3" /> {boss.votes ?? 0}/{boss.votesNeeded ?? 10} votes
                  </span>
                )}
              </div>
              <div className="mt-1 h-2.5 overflow-hidden rounded-full border border-[#f5efdc]/25 bg-[#f5efdc]/10">
                <div
                  className="h-full bg-gradient-to-r from-[#f2a541] to-[#f2c14e] transition-[width] duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* dizzy flash */}
            <AnimatePresence>
              {boss.dizzy && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 1, 0.3, 1] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.9, repeat: Infinity }}
                  className="mt-2 flex items-center justify-center gap-2 rounded-xl border-2 border-[#f2c14e] bg-[#f2c14e]/20 py-1.5"
                >
                  <AlertTriangle className="h-4 w-4 text-[#f2c14e]" />
                  <span className="text-sm font-black uppercase tracking-widest text-[#f2c14e]">
                    DIZZY! Hit the committee with everything!
                  </span>
                  <AlertTriangle className="h-4 w-4 text-[#f2c14e]" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
