'use client'

import { useEffect, useState } from 'react'
import { useGameStore, uiActions } from '@/lib/game-store'
import { Play, Settings, BookOpen, LogOut, Vote, Camera } from 'lucide-react'
import { motion } from 'framer-motion'
import SettingsPanel from './SettingsPanel'
import HowToPlay from './HowToPlay'

const resume = () => useGameStore.getState().setUIMode('playing')

export default function PauseMenu() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [howtoOpen, setHowtoOpen] = useState(false)
  const matchTime = useGameStore((s) => s.hud.matchTime)
  const tokens = useGameStore((s) => s.hud.tokens)

  // v35 — ESC resumes. While paused the engine input is DISABLED (so its own
  // toggle can never fire), which meant the modal could only ever be dismissed
  // with the Resume button — a second ESC looked like "nothing happened".
  // Capture-phase so it wins over page listeners; gated while a nested dialog
  // (Settings / How to Play) is open, since those consume ESC themselves.
  // v36 — timeStamp guard: when the pointer was never locked (headless / some
  // embeds), a single Escape keydown pauses the game AND React synchronously
  // mounts this menu mid-dispatch, so this listener used to receive the SAME
  // keydown and instantly resume — ESC looked dead. The opening keydown's
  // timeStamp always predates this effect, so ignore anything not strictly
  // newer; a genuine later Escape (timeStamp > armedAt) still resumes.
  useEffect(() => {
    const armedAt = performance.now()
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || settingsOpen || howtoOpen) return
      if (e.timeStamp && e.timeStamp <= armedAt) return
      e.preventDefault()
      e.stopPropagation()
      resume()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [settingsOpen, howtoOpen])

  const btn =
    'flex w-full items-center gap-3 rounded-2xl border-2 border-[#1c1a17]/80 px-4 py-3 text-left text-sm font-black uppercase tracking-tight shadow-[4px_4px_0_#1c1a17] transition-all hover:-translate-y-0.5 hover:shadow-[5px_6px_0_#1c1a17] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_#1c1a17]'

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-[#1c1a17]/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.92, rotate: -1 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 20 }}
        className="vc-paper w-[min(380px,92vw)] rounded-3xl border-2 border-[#1c1a17]/80 p-5 shadow-[7px_7px_0_#1c1a17]"
      >
        <div className="mb-1 flex items-center justify-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-[#1c1a17]/80 bg-[#f2a541]">
            <Vote className="h-5 w-5 text-[#1c1a17]" />
          </span>
          <h2 className="text-3xl font-black uppercase tracking-tight text-[#1c1a17]">Paused</h2>
        </div>
        <p className="mb-4 text-center text-[11px] font-bold uppercase tracking-wider text-[#8c1f28]">
          The committee waits for no one (it waits for committees)
        </p>

        <div className="mb-4 flex justify-center gap-2">
          <span className="rounded-full border border-[#1c1a17]/50 bg-[#1c1a17] px-2.5 py-0.5 text-[10px] font-black tabular-nums text-[#f2c14e]">
            ⏱ {Math.floor(matchTime / 60)}:{Math.floor(matchTime % 60).toString().padStart(2, '0')}
          </span>
          <span className="rounded-full border border-[#1c1a17]/50 bg-[#f2c14e] px-2.5 py-0.5 text-[10px] font-black tabular-nums text-[#1c1a17]">
            🗳️ {tokens}
          </span>
        </div>

        <div className="space-y-2.5">
          <button onClick={resume} className={`${btn} bg-[#2e6e4e] text-[#f5efdc]`}>
            <Play className="h-5 w-5 shrink-0" strokeWidth={2.6} /> Resume Protest
          </button>
          <button
            onClick={() => {
              resume()
              // defer so photo mode engages after the mode is back to 'playing'
              setTimeout(() => uiActions().photoToggle(), 60)
            }}
            className={`${btn} bg-[#f2c14e] text-[#1c1a17] hover:bg-[#eab940]`}
          >
            <Camera className="h-5 w-5 shrink-0" strokeWidth={2.6} /> Photo Mode
          </button>
          <button onClick={() => setSettingsOpen(true)} className={`${btn} bg-[#f5efdc] text-[#1c1a17] hover:bg-[#efe6c8]`}>
            <Settings className="h-5 w-5 shrink-0" strokeWidth={2.6} /> Settings
          </button>
          <button onClick={() => setHowtoOpen(true)} className={`${btn} bg-[#f5efdc] text-[#1c1a17] hover:bg-[#efe6c8]`}>
            <BookOpen className="h-5 w-5 shrink-0" strokeWidth={2.6} /> How to Play
          </button>
          <button
            onClick={() => uiActions().leaveMatch()}
            className={`${btn} bg-[#8c1f28] text-[#f5efdc]`}
          >
            <LogOut className="h-5 w-5 shrink-0" strokeWidth={2.6} /> Quit to Menu
          </button>
        </div>

        <p className="mt-3 text-center text-[9px] font-bold uppercase tracking-widest text-[#1c1a17]/40">
          Pausing does not pause the police. This is a documentary.
        </p>
      </motion.div>

      <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />
      <HowToPlay open={howtoOpen} onOpenChange={setHowtoOpen} />
    </div>
  )
}
