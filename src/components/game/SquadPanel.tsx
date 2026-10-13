'use client'

import { useGameStore } from '@/lib/game-store'
import { archetypeById } from '@/game/shared/constants'
import { KeyRound, HeartPulse, ShieldAlert, X, Route } from 'lucide-react'
import { motion } from 'framer-motion'

const TIPS = [
  'Hold E next to a DETAINED teammate to bail them out. No bribe required — the paperwork is free today.',
  'Detained squadmates can see the map. Ask them (politely) for patrol positions.',
  'Press G for the emote wheel. Morale is a legitimate tactic.',
  'Press M for the big map — checkpoints, tokens and chasers, beautifully framed.',
  'The journalist archetype spots police on the minimap from farther away. Bring one. Or become one.',
]

export default function SquadPanel() {
  const squadOpen = useGameStore((s) => s.squadOpen)
  const toggleSquad = useGameStore((s) => s.toggleSquad)
  const hud = useGameStore((s) => s.hud)

  if (!squadOpen) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="vc-paper pointer-events-auto w-[min(420px,92vw)] rounded-2xl border-2 border-[#1c1a17]/80 p-4 shadow-[6px_6px_0_rgba(28,26,23,0.85)]"
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-black uppercase tracking-tight text-[#1c1a17]">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border-2 border-[#1c1a17]/70 bg-[#2e6e4e] text-[#f5efdc]">
              <HeartPulse className="h-4 w-4" />
            </span>
            Squad Status
          </h3>
          <button onClick={() => toggleSquad(false)} className="text-[#1c1a17]/50 hover:text-[#8c1f28]" aria-label="Close squad panel">
            <X className="h-4 w-4" />
          </button>
        </div>

        {hud.squad.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-[#1c1a17]/40 px-3 py-4 text-center text-xs font-bold text-[#1c1a17]/60">
            You are protest-soloing right now. Join a multiplayer room to get squadmates — and witnesses.
          </p>
        ) : (
          <div className="space-y-1.5">
            {hud.squad.map((m) => {
              const arch = archetypeById(m.archetype || 'student')
              return (
                <div key={m.id} className="flex items-center gap-2.5 rounded-xl border border-[#1c1a17]/60 bg-[#f5efdc] px-2.5 py-1.5">
                  <span className="h-6 w-6 shrink-0 rounded-full border-2 border-[#1c1a17]/60" style={{ background: arch.colors.shirt }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-black uppercase tracking-tight text-[#1c1a17]">{m.name}</span>
                      {m.detained && (
                        <span className="flex items-center gap-0.5 rounded border border-[#8c1f28] bg-[#8c1f28] px-1 text-[8px] font-black uppercase text-[#f5efdc]">
                          <ShieldAlert className="h-2.5 w-2.5" /> Detained
                        </span>
                      )}
                      {m.dazed && !m.detained && (
                        <span className="rounded border border-[#b07d1e] bg-[#f2c14e] px-1 text-[8px] font-black uppercase text-[#1c1a17]">Dazed</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full border border-[#1c1a17]/50 bg-[#1c1a17]/15">
                        <div className="h-full bg-[#4e9b6e]" style={{ width: `${Math.max(0, Math.min(100, m.health))}%` }} />
                      </div>
                      <span className="flex items-center gap-0.5 text-[9px] font-bold tabular-nums text-[#1c1a17]/60">
                        <Route className="h-2.5 w-2.5" /> {Math.round(m.distance)}m
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-3 space-y-1 rounded-xl border-2 border-dashed border-[#8c1f28]/40 bg-[#f2c14e]/25 p-2.5">
          <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.2em] text-[#8c1f28]">
            <KeyRound className="h-3 w-3" /> Squad field manual
          </div>
          {TIPS.map((t, i) => (
            <p key={i} className="text-[10px] font-semibold leading-snug text-[#1c1a17]/75">• {t}</p>
          ))}
        </div>
        <p className="mt-1.5 text-center text-[9px] font-bold uppercase tracking-widest text-[#1c1a17]/40">Tab to close</p>
      </motion.div>
    </div>
  )
}
