'use client'

// Full-screen reconnecting overlay — shown when a multiplayer match loses its
// server connection. Auto-hides when the socket reconnects (game.ts auto-rejoins).
import { useEffect, useState } from 'react'
import { useGameStore, uiActions } from '@/lib/game-store'
import { motion, AnimatePresence } from 'framer-motion'
import { WifiOff, Play, LogOut, Loader2 } from 'lucide-react'

export default function ReconnectOverlay() {
  const uiMode = useGameStore((s) => s.uiMode)
  const matchMode = useGameStore((s) => s.matchMode)
  const connection = useGameStore((s) => s.hud.connection)
  const [dismissed, setDismissed] = useState(false)

  // re-arm whenever we get back into a fresh playing match
  useEffect(() => {
    if (connection !== 'connected') return
    const t = setTimeout(() => setDismissed(false), 0)
    return () => clearTimeout(t)
  }, [connection])

  const visible = uiMode === 'playing' && matchMode === 'multiplayer' && connection === 'offline' && !dismissed

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="reconnect-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="pointer-events-auto fixed inset-0 z-[70] flex items-center justify-center bg-[#1c1a17]/80 backdrop-blur-[3px]"
          role="alertdialog"
          aria-label="Connection lost"
        >
          <motion.div
            initial={{ scale: 0.9, y: 18, rotate: -1 }}
            animate={{ scale: 1, y: 0, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 220, damping: 20 }}
            className="vc-paper relative mx-4 w-full max-w-md rounded-3xl border-2 border-[#1c1a17]/90 p-6 text-center shadow-[8px_10px_0_#1c1a17]"
          >
            {/* rubber stamp */}
            <motion.div
              initial={{ scale: 2.2, opacity: 0, rotate: -18 }}
              animate={{ scale: 1, opacity: 1, rotate: -8 }}
              transition={{ delay: 0.15, type: 'spring', stiffness: 260, damping: 14 }}
              className="vc-stamp-texture absolute -top-4 left-1/2 -translate-x-1/2 rounded-lg border-4 border-[#8c1f28] bg-[#8c1f28]/10 px-4 py-1 text-lg font-black uppercase tracking-[0.15em] text-[#8c1f28]"
            >
              Signal Lost
            </motion.div>

            <div className="mx-auto mt-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#1c1a17]/80 bg-[#f2c14e] shadow-[4px_4px_0_#1c1a17]">
              <WifiOff className="h-8 w-8 text-[#1c1a17]" strokeWidth={2.5} />
            </div>

            <h2 className="mt-4 text-2xl font-black uppercase tracking-tight text-[#1c1a17]">
              The Committee Cut Our Line
            </h2>
            <p className="mt-2 text-sm font-semibold leading-snug text-[#1c1a17]/75">
              Connection to the server dropped mid-protest. Retrying automatically — your protester keeps running offline in the meantime.
            </p>

            <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#2e6e4e]/50 bg-[#2e6e4e]/10 px-3 py-2 text-xs font-black uppercase tracking-wide text-[#2e6e4e]">
              <Loader2 className="h-4 w-4 animate-spin" /> Attempting to reconnect…
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => setDismissed(true)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-[#1c1a17]/80 bg-[#2e6e4e] px-4 py-2.5 text-xs font-black uppercase tracking-tight text-[#f5efdc] shadow-[3px_3px_0_#1c1a17] transition-all hover:-translate-y-0.5 hover:shadow-[4px_5px_0_#1c1a17] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_#1c1a17]"
              >
                <Play className="h-4 w-4" /> Keep playing offline
              </button>
              <button
                onClick={() => { setDismissed(true); uiActions().leaveMatch() }}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-[#1c1a17]/80 bg-[#f5efdc] px-4 py-2.5 text-xs font-black uppercase tracking-tight text-[#8c1f28] shadow-[3px_3px_0_#1c1a17] transition-all hover:-translate-y-0.5 hover:shadow-[4px_5px_0_#1c1a17] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_#1c1a17]"
              >
                <LogOut className="h-4 w-4" /> Quit to menu
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
