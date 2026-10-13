'use client'

import { useEffect } from 'react'
import { useGameStore, uiActions } from '@/lib/game-store'
import { motion } from 'framer-motion'

// Local copies — never import '@/game/game' statically (it pulls three.js into SSR)
const EMOTES: { id: string; label: string; emoji: string }[] = [
  { id: 'wave', label: 'Wave', emoji: '👋' },
  { id: 'salute', label: 'Salute', emoji: '🫡' },
  { id: 'dance', label: 'Dance', emoji: '💃' },
  { id: 'facepalm', label: 'Facepalm', emoji: '🤦' },
  { id: 'flex', label: 'Flex', emoji: '💪' },
  { id: 'cry', label: 'Cry', emoji: '😭' },
]

export default function EmoteWheel() {
  const open = useGameStore((s) => s.emoteWheelOpen)
  const toggle = useGameStore((s) => s.toggleEmoteWheel)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyG') {
        e.preventDefault()
        toggle(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, toggle])

  if (!open) return null

  const send = (id: string) => {
    uiActions().sendEmote(id)
    toggle(false)
  }

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-[#1c1a17]/45 backdrop-blur-[2px]"
      onClick={() => toggle(false)}
    >
      <div className="relative h-72 w-72" onClick={(e) => e.stopPropagation()}>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <div className="rounded-xl border-2 border-[#f2c14e] bg-[#1c1a17] px-3 py-1.5 shadow-[3px_3px_0_rgba(28,26,23,0.8)]">
            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#f2a541]">Emote Wheel</div>
            <div className="text-[9px] font-bold text-[#f5efdc]/60">G / Esc to close</div>
          </div>
        </div>
        {EMOTES.map((e, i) => {
          const angle = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2
          const x = Math.cos(angle) * 104
          const y = Math.sin(angle) * 104
          return (
            <motion.button
              key={e.id}
              initial={{ opacity: 0, scale: 0.4, x: 0, y: 0 }}
              animate={{ opacity: 1, scale: 1, x, y }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={{ delay: i * 0.03, type: 'spring', stiffness: 260, damping: 18 }}
              onClick={() => send(e.id)}
              className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc] shadow-[3px_3px_0_#1c1a17] transition-colors hover:bg-[#f2c14e]"
              title={`Emote: ${e.label}`}
            >
              <span className="text-2xl leading-none">{e.emoji}</span>
              <span className="mt-0.5 text-[8px] font-black uppercase tracking-wider text-[#1c1a17]/70">{e.label}</span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
