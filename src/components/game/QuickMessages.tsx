'use client'

import { useEffect, useState } from 'react'
import { useGameStore, uiActions } from '@/lib/game-store'
import { MessageSquare, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

// Local copy of the engine's QUICK_MESSAGES (10 strings) — no static import of '@/game/game'
const QUICK_MESSAGES = [
  'Chai break, anyone?', 'Follow me!', 'POLICE! Scatter!', 'Nice one!', 'Help! Detained!',
  'To the flyover!', 'Uncle Ji approves.', 'Form a squad!', 'The gate needs votes!', 'Boss time!',
]

export default function QuickMessages() {
  const [open, setOpen] = useState(false)
  const notify = useGameStore((s) => s.notify)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyT' && !e.repeat && e.type === 'keydown') {
        // avoid toggling while typing in an input
        const el = e.target as HTMLElement | null
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
        setOpen((o) => !o)
      }
      if (e.code === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const send = (i: number) => {
    uiActions().sendQuickMessage(i)
    notify(`You: ${QUICK_MESSAGES[i]}`, 'squad')
    setOpen(false)
  }

  return (
    <>
      {/* toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Quick messages (T)"
        className="pointer-events-auto fixed bottom-3 left-1/2 z-30 ml-36 flex h-10 w-10 translate-x-[-50%] items-center justify-center rounded-xl border-2 border-[#1c1a17]/80 bg-[#f5efdc]/92 shadow-[3px_3px_0_rgba(28,26,23,0.8)] backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:bg-[#f2c14e] sm:ml-44"
      >
        <MessageSquare className="h-5 w-5 text-[#1c1a17]" />
        <span className="absolute -right-1 -top-1.5 flex h-4 w-4 items-center justify-center rounded-md border border-[#1c1a17]/80 bg-[#1c1a17] text-[9px] font-black text-[#f2c14e]">
          T
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="vc-paper pointer-events-auto fixed bottom-16 left-1/2 z-40 w-[min(340px,90vw)] -translate-x-1/2 rounded-2xl border-2 border-[#1c1a17]/80 p-2.5 shadow-[5px_5px_0_#1c1a17]"
          >
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8c1f28]">Shout Across The Plaza</span>
              <button onClick={() => setOpen(false)} className="text-[#1c1a17]/50 hover:text-[#8c1f28]" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-1">
              {QUICK_MESSAGES.map((msg, i) => (
                <button
                  key={i}
                  onClick={() => send(i)}
                  className="flex items-center gap-2 rounded-xl border border-[#1c1a17]/50 bg-[#f5efdc] px-2.5 py-1.5 text-left text-xs font-bold text-[#1c1a17] transition-colors hover:border-[#8c1f28] hover:bg-[#f2c14e]"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[#1c1a17]/60 bg-[#1c1a17] text-[9px] font-black text-[#f2c14e]">
                    {i + 1}
                  </span>
                  {msg}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
