'use client'

import { useEffect, useMemo, useState } from 'react'
import { useGameStore, uiActions } from '@/lib/game-store'
import { EMOTE_CATALOG, unlockedEmoteIds } from '@/lib/cosmetics'
import { motion } from 'framer-motion'
import { Lock, ShieldX } from 'lucide-react'

interface AchRes { all?: { id: string }[]; unlocked?: string[] }

function readToken(): string | null {
  try {
    const raw = localStorage.getItem('votechor_profile')
    return raw ? (JSON.parse(raw) as { token?: string }).token ?? null : null
  } catch { return null }
}

export default function EmoteWheel() {
  const open = useGameStore((s) => s.emoteWheelOpen)
  const toggle = useGameStore((s) => s.toggleEmoteWheel)
  const level = useGameStore((s) => s.profile?.level ?? 1)
  const [codes, setCodes] = useState<string[]>([])
  const [shakeId, setShakeId] = useState<string | null>(null)

  // live-refresh unlocks (mount + focus + interval — mirrors CharacterSelect pattern)
  useEffect(() => {
    if (!open) return
    let alive = true
    const load = () => {
      const token = readToken()
      fetch('/api/achievements', { headers: token ? { 'x-vc-token': token } : {} })
        .then((r) => (r.ok ? (r.json() as Promise<AchRes>) : null))
        .then((d) => { if (alive && d?.unlocked) setCodes(d.unlocked) })
        .catch(() => {})
    }
    load()
    const iv = window.setInterval(load, 15000)
    window.addEventListener('focus', load)
    return () => { alive = false; window.clearInterval(iv); window.removeEventListener('focus', load) }
  }, [open])

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

  const unlocked = useMemo(() => unlockedEmoteIds(level, codes), [level, codes])

  if (!open) return null

  const send = (id: string) => {
    if (!unlocked.has(id)) {
      const item = EMOTE_CATALOG.find((e) => e.id === id)
      if (item) {
        const why = item.unlock.type === 'level'
          ? `Reach level ${item.unlock.level}`
          : item.unlock.type === 'achievement'
            ? `Earn medal: ${item.unlock.code.replaceAll('_', ' ').toUpperCase()}`
            : 'Already unlocked'
        useGameStore.getState().notify(`Emote locked — ${why}`, 'warning')
      }
      setShakeId(id)
      window.setTimeout(() => setShakeId(null), 420)
      return
    }
    uiActions().sendEmote(id)
    toggle(false)
  }

  // ring layout: 8 slots, gentle protest-poster look
  const RADIUS = 108

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-[#1c1a17]/45 backdrop-blur-[2px]"
      onClick={() => toggle(false)}
    >
      <div className="relative h-[300px] w-[300px]" onClick={(e) => e.stopPropagation()}>
        {/* header chip */}
        <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-center">
          <div className="vc-paper rounded-xl border-2 border-[#1c1a17] px-3 py-1.5 shadow-[3px_3px_0_rgba(28,26,23,0.8)]">
            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#8c1f28]">Emote Wheel</div>
            <div className="text-[9px] font-bold text-[#1c1a17]/60">G / Esc to close</div>
            <div className="mt-0.5 border-t border-dashed border-[#1c1a17]/30 pt-0.5 text-[8px] font-black uppercase tracking-widest text-[#2e6e4e]">
              {unlocked.size}/{EMOTE_CATALOG.length} unlocked
            </div>
          </div>
        </div>
        {EMOTE_CATALOG.map((e, i) => {
          const angle = (i / EMOTE_CATALOG.length) * Math.PI * 2 - Math.PI / 2
          const x = Math.cos(angle) * RADIUS
          const y = Math.sin(angle) * RADIUS
          const isUnlocked = unlocked.has(e.id)
          return (
            <motion.button
              key={e.id}
              initial={{ opacity: 0, scale: 0.4, x: 0, y: 0 }}
              animate={{ opacity: 1, scale: 1, x, y }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={{ delay: i * 0.03, type: 'spring', stiffness: 260, damping: 18 }}
              onClick={() => send(e.id)}
              aria-label={isUnlocked ? `Emote: ${e.label}` : `${e.label} locked`}
              className={`absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-2xl border-2 shadow-[3px_3px_0_#1c1a17] transition-colors ${
                isUnlocked
                  ? 'border-[#1c1a17]/80 bg-[#f5efdc] hover:bg-[#f2c14e]'
                  : 'border-[#1c1a17]/40 bg-[#e7dfc9] opacity-90 hover:opacity-100'
              }`}
              style={isUnlocked ? undefined : { filter: 'grayscale(1)' }}
            >
              <span className={`flex flex-col items-center ${shakeId === e.id ? 'vc-emote-shake' : ''}`}>
                <span className="text-2xl leading-none">{e.emoji}</span>
                <span className={`mt-0.5 text-[8px] font-black uppercase tracking-wider ${isUnlocked ? 'text-[#1c1a17]/70' : 'text-[#1c1a17]/45'}`}>
                  {e.label}
                </span>
              </span>
              {!isUnlocked && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 items-center gap-0.5 rounded-full border-2 border-[#1c1a17] bg-[#8c1f28] px-1 text-[8px] font-black text-[#f5efdc]">
                  {e.unlock.type === 'level' ? (
                    <>LV {e.unlock.level}</>
                  ) : (
                    <Lock className="h-2.5 w-2.5" />
                  )}
                </span>
              )}
            </motion.button>
          )
        })}
        {/* unlock hint footer */}
        <div className="absolute -bottom-1 left-1/2 z-10 flex w-max -translate-x-1/2 items-center gap-1.5 rounded-full border-2 border-dashed border-[#1c1a17]/50 bg-[#f2c14e]/90 px-3 py-1 shadow-[2px_2px_0_rgba(28,26,23,0.7)]">
          <ShieldX className="h-3 w-3 text-[#8c1f28]" />
          <span className="text-[8px] font-black uppercase tracking-[0.18em] text-[#1c1a17]">
            Level up & earn medals to unlock more chants
          </span>
        </div>
      </div>
    </div>
  )
}
