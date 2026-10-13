'use client'

import { useEffect, useState } from 'react'
import { useGameStore, uiActions } from '@/lib/game-store'
import { archetypeById } from '@/game/shared/constants'
import { KeyRound, HeartPulse, ShieldAlert, X, Route, Users, Copy, Check, LogOut, Flag, Ticket, Megaphone, Gift } from 'lucide-react'
import { motion } from 'framer-motion'

const TIPS = [
  'Hold E next to a DETAINED teammate to bail them out. No bribe required — the paperwork is free today.',
  'Squadmates get green name tags in the world. Spot your cell instantly in a stampede.',
  'Press RALLY to teleport to the nearest free cellmate — 45s cooldown between rallies.',
  'Press F (or the GIFT button) to hand your best item to the nearest teammate. Support points included.',
  'Press G for the emote wheel. Morale is a legitimate tactic.',
  'Press M for the big map — checkpoints, tokens and chasers, beautifully framed.',
  'The journalist archetype spots police on the minimap from farther away. Bring one. Or become one.',
]

export default function SquadPanel() {
  const squadOpen = useGameStore((s) => s.squadOpen)
  const toggleSquad = useGameStore((s) => s.toggleSquad)
  const hud = useGameStore((s) => s.hud)
  const squad = useGameStore((s) => s.squad)
  const matchMode = useGameStore((s) => s.matchMode)
  const [joinCode, setJoinCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(Date.now())

  // cheap ticker for the rally cooldown countdown
  useEffect(() => {
    if (!squadOpen) return
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [squadOpen])

  if (!squadOpen) return null

  const copyCode = async () => {
    if (!squad?.code) return
    try {
      await navigator.clipboard.writeText(squad.code)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = squad.code
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const squadById = new Map((squad?.members ?? []).map((m) => [m.id, m]))

  return (
    <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="vc-paper pointer-events-auto max-h-[86vh] w-[min(430px,92vw)] overflow-y-auto vc-scroll rounded-2xl border-2 border-[#1c1a17]/80 p-4 shadow-[6px_6px_0_rgba(28,26,23,0.85)]"
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

        {/* ---------- squad cell management (multiplayer only) ---------- */}
        {matchMode === 'multiplayer' && (
          <div className="mb-3 rounded-xl border-2 border-[#1c1a17]/70 bg-[#efe6cd] p-2.5">
            {squad ? (
              <>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg border-2 border-[#1c1a17]/70 bg-[#f2c14e]">
                      <Users className="h-3.5 w-3.5 text-[#1c1a17]" />
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#1c1a17]/70">Protest cell</span>
                  </div>
                  {/* dashed protest-ticket code chip + copy */}
                  <button
                    onClick={copyCode}
                    aria-label={`Copy squad code ${squad.code}`}
                    className="group flex items-center gap-1.5 rounded-lg border-2 border-dashed border-[#8c1f28] bg-[#f5efdc] px-2.5 py-1 shadow-[2px_2px_0_rgba(28,26,23,0.6)] transition-transform hover:-rotate-1 hover:scale-[1.03] active:rotate-0"
                  >
                    <span className="font-mono text-sm font-black tracking-[0.25em] text-[#8c1f28]">{squad.code}</span>
                    {copied ? <Check className="h-3.5 w-3.5 text-[#2e6e4e]" /> : <Copy className="h-3.5 w-3.5 text-[#1c1a17]/50 group-hover:text-[#1c1a17]" />}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-[#1c1a17]/50">
                    {squad.members.length}/4 members · share the code
                  </span>
                  <div className="flex items-center gap-1.5">
                    {/* gifting perk — hand an item to the nearest live teammate (§11) */}
                    <button
                      onClick={() => uiActions().giftNearest()}
                      disabled={hud.detained || hud.inventory.length === 0}
                      title={
                        hud.detained
                          ? 'Cannot gift while detained'
                          : hud.inventory.length === 0
                            ? 'Pockets are empty — nothing to gift'
                            : 'Gift your best item to the nearest teammate (F)'
                      }
                      className={`flex items-center gap-1 rounded-lg border-2 px-2 py-1 text-[9px] font-black uppercase tracking-widest shadow-[2px_2px_0_rgba(28,26,23,0.5)] transition-all ${
                        hud.detained || hud.inventory.length === 0
                          ? 'cursor-not-allowed border-[#1c1a17]/40 bg-[#e7dfc9] text-[#1c1a17]/40'
                          : 'border-[#1c1a17]/70 bg-[#7de3a8] text-[#1c1a17] hover:-translate-y-0.5 hover:bg-[#a7efc3]'
                      }`}
                    >
                      <Gift className="h-3 w-3" /> Gift
                    </button>
                    {/* rally perk — teleport to nearest free cellmate, 45s cooldown */}
                    {(() => {
                      const remainMs = hud.rallyReadyAt - now
                      const cooling = remainMs > 0
                      const cellmatesFree = squad.members.length > 1 && !hud.detained
                      return (
                        <button
                          onClick={() => uiActions().rallyToCell()}
                          disabled={cooling || !cellmatesFree}
                          title={
                            hud.detained
                              ? 'Cannot rally while detained'
                              : cooling
                                ? `Rally recharging — ${Math.ceil(remainMs / 1000)}s`
                                : 'Teleport to the nearest free cellmate'
                          }
                          className={`flex items-center gap-1 rounded-lg border-2 px-2 py-1 text-[9px] font-black uppercase tracking-widest shadow-[2px_2px_0_rgba(28,26,23,0.5)] transition-all ${
                            cooling || !cellmatesFree
                              ? 'cursor-not-allowed border-[#1c1a17]/40 bg-[#e7dfc9] text-[#1c1a17]/40'
                              : 'border-[#1c1a17]/70 bg-[#f2c14e] text-[#1c1a17] hover:-translate-y-0.5 hover:bg-[#f2a541]'
                          }`}
                        >
                          <Megaphone className="h-3 w-3" />
                          {cooling ? `${Math.ceil(remainMs / 1000)}s` : hud.detained ? 'Rally' : 'Rally!'}
                        </button>
                      )
                    })()}
                    <button
                      onClick={() => { setJoinCode(''); uiActions().squadLeave() }}
                      className="flex items-center gap-1 rounded-lg border-2 border-[#1c1a17]/60 bg-[#e7dfc9] px-2 py-1 text-[9px] font-black uppercase tracking-widest text-[#1c1a17]/80 shadow-[2px_2px_0_rgba(28,26,23,0.5)] transition-colors hover:bg-[#f2c14e]"
                    >
                      <LogOut className="h-3 w-3" /> Leave squad
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="mb-1.5 flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.2em] text-[#1c1a17]/70">
                  <Flag className="h-3.5 w-3.5 text-[#2e6e4e]" /> Form a protest cell (max 4)
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => uiActions().squadCreate()}
                    className="flex items-center gap-1 rounded-lg border-2 border-[#1c1a17]/70 bg-[#2e6e4e] px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-[#f5efdc] shadow-[2px_2px_0_rgba(28,26,23,0.7)] transition-transform hover:-translate-y-0.5"
                  >
                    <Users className="h-3 w-3" /> Create squad
                  </button>
                  <div className="flex items-center gap-1 rounded-lg border-2 border-dashed border-[#1c1a17]/50 bg-[#f5efdc] px-1.5 py-0.5">
                    <Ticket className="h-3.5 w-3.5 text-[#1c1a17]/50" />
                    <input
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && joinCode.length === 4) uiActions().squadJoin(joinCode)
                      }}
                      placeholder="CODE"
                      aria-label="Squad join code"
                      maxLength={4}
                      className="w-16 bg-transparent text-center font-mono text-sm font-black tracking-[0.2em] text-[#8c1f28] outline-none placeholder:text-[#1c1a17]/30"
                    />
                    <button
                      onClick={() => { if (joinCode.length === 4) uiActions().squadJoin(joinCode) }}
                      disabled={joinCode.length !== 4}
                      className="rounded border-2 border-[#1c1a17]/60 bg-[#f2c14e] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-[#1c1a17] disabled:opacity-40"
                    >
                      Join
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-[9px] font-semibold text-[#1c1a17]/50">
                  Squadmates get green name tags and squad toasts. Create one, share the 4-letter code, cause chaos together.
                </p>
              </>
            )}
          </div>
        )}
        {matchMode !== 'multiplayer' && (
          <p className="mb-3 rounded-xl border-2 border-dashed border-[#1c1a17]/40 bg-[#efe6cd]/60 px-3 py-2 text-center text-[10px] font-bold uppercase tracking-widest text-[#1c1a17]/55">
            Squads are a multiplayer feature — rally in a room first
          </p>
        )}

        {hud.squad.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-[#1c1a17]/40 px-3 py-4 text-center text-xs font-bold text-[#1c1a17]/60">
            You are protest-soloing right now. Join a multiplayer room to get squadmates — and witnesses.
          </p>
        ) : (
          <div className="space-y-1.5">
            {hud.squad.map((m) => {
              const arch = archetypeById(m.archetype || 'student')
              const inCell = squadById.has(m.id)
              return (
                <div
                  key={m.id}
                  className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-1.5 transition-colors ${
                    inCell ? 'border-[#2e6e4e] bg-[#2e6e4e]/10' : 'border-[#1c1a17]/60 bg-[#f5efdc]'
                  }`}
                >
                  <span
                    className="h-6 w-6 shrink-0 rounded-full border-2"
                    style={{ background: arch.colors.shirt, borderColor: inCell ? '#2e6e4e' : 'rgba(28,26,23,0.6)' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-black uppercase tracking-tight text-[#1c1a17]">{m.name}</span>
                      {inCell && (
                        <span className="rounded border border-[#2e6e4e] bg-[#2e6e4e] px-1 text-[8px] font-black uppercase text-[#f5efdc]">
                          Cell
                        </span>
                      )}
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
