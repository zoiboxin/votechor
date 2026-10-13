'use client'

import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '@/lib/game-store'
import { uiActions } from '@/lib/game-store'
import { archetypeById } from '@/game/shared/constants'
import { ArrowLeft, Users, Zap, Shuffle, KeyRound, Server, Loader2, AlertTriangle } from 'lucide-react'
import { motion } from 'framer-motion'

export default function PlayScreen({ onBack }: { onBack: () => void }) {
  const joining = useGameStore((s) => s.joining)
  const joinError = useGameStore((s) => s.joinError)
  const profile = useGameStore((s) => s.profile)
  const [roomCode, setRoomCode] = useState('')
  const soloStarted = useRef(false)

  // reset join state when arriving on this screen
  useEffect(() => {
    useGameStore.getState().setJoining(false, null)
  }, [])

  const cleanCode = roomCode.trim().toUpperCase().slice(0, 6)

  const join = (code: string | null) => {
    if (joining || soloStarted.current) return
    if (code) useGameStore.getState().setRoomCode(code)
    uiActions().joinMultiplayer(code)
  }

  const startSolo = () => {
    if (joining || soloStarted.current) return
    soloStarted.current = true
    useGameStore.getState().setJoining(true)
    uiActions().startSolo()
  }

  const arch = archetypeById(profile?.archetype ?? 'student')

  return (
    <div className="vc-paper pointer-events-auto fixed inset-0 z-30 flex flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background:repeating-linear-gradient(-35deg,#8c1f28_0_18px,transparent_18px_36px)]" />

      <header className="relative flex shrink-0 items-center gap-3 border-b-2 border-[#1c1a17]/80 bg-[#f2a541]/60 px-4 py-3">
        <button
          onClick={onBack}
          disabled={joining}
          className="flex items-center gap-1.5 rounded-xl border-2 border-[#1c1a17]/80 bg-[#f5efdc] px-3 py-1.5 text-xs font-black uppercase tracking-tight text-[#1c1a17] shadow-[3px_3px_0_#1c1a17] transition-all hover:-translate-y-0.5 hover:shadow-[4px_5px_0_#1c1a17] disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="text-xl font-black uppercase tracking-tight text-[#1c1a17] sm:text-2xl">Assemble the Protest</h2>
      </header>

      <div className="vc-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-3xl gap-5 px-4 py-6 md:grid-cols-2">
          {/* Solo */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc] p-5 shadow-[5px_5px_0_#1c1a17]"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-[#1c1a17]/70 bg-[#f2c14e]">
                <Zap className="h-5 w-5 text-[#1c1a17]" />
              </span>
              <h3 className="text-lg font-black uppercase tracking-tight text-[#1c1a17]">Solo Run</h3>
            </div>
            <p className="mt-2 flex-1 text-xs font-semibold leading-relaxed text-[#1c1a17]/70">
              The whole city to yourself. Police, searchlights, one cow of mass destruction and the Great Vote Collector —
              all offline, all personal. Perfect for practicing your slide (C).
            </p>
            <button
              onClick={startSolo}
              disabled={joining}
              className="mt-4 rounded-2xl border-2 border-[#1c1a17]/80 bg-[#8c1f28] px-4 py-3 text-sm font-black uppercase tracking-tight text-[#f5efdc] shadow-[4px_4px_0_#1c1a17] transition-all hover:-translate-y-0.5 hover:shadow-[5px_6px_0_#1c1a17] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_#1c1a17] disabled:opacity-50"
            >
              Start Solo Protest
            </button>
          </motion.section>

          {/* Multiplayer */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="flex flex-col rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc] p-5 shadow-[5px_5px_0_#1c1a17]"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-[#1c1a17]/70 bg-[#2e6e4e] text-[#f5efdc]">
                <Users className="h-5 w-5" />
              </span>
              <h3 className="text-lg font-black uppercase tracking-tight text-[#1c1a17]">Multiplayer</h3>
            </div>

            <label className="mt-3 block text-[10px] font-black uppercase tracking-[0.2em] text-[#8c1f28]">
              Room code (optional)
            </label>
            <div className="mt-1 flex items-center gap-2">
              <KeyRound className="h-4 w-4 shrink-0 text-[#1c1a17]/50" />
              <input
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
                placeholder="e.g. CHAI42"
                maxLength={6}
                disabled={joining}
                className="w-full rounded-xl border-2 border-[#1c1a17]/70 bg-white/70 px-3 py-2 text-center text-lg font-black uppercase tracking-[0.3em] text-[#1c1a17] outline-none placeholder:tracking-normal placeholder:text-[#1c1a17]/30 focus:border-[#8c1f28]"
              />
            </div>
            <p className="mt-1 text-[10px] font-semibold text-[#1c1a17]/50">
              6 characters. Leave empty for a public protest — anyone may join the chaos.
            </p>

            <div className="mt-3 space-y-2">
              <button
                onClick={() => join(cleanCode || null)}
                disabled={joining}
                className="w-full rounded-2xl border-2 border-[#1c1a17]/80 bg-[#2e6e4e] px-4 py-3 text-sm font-black uppercase tracking-tight text-[#f5efdc] shadow-[4px_4px_0_#1c1a17] transition-all hover:-translate-y-0.5 hover:shadow-[5px_6px_0_#1c1a17] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_#1c1a17] disabled:opacity-50"
              >
                {cleanCode ? `Join Room ${cleanCode}` : 'Join Public Protest'}
              </button>
              <button
                onClick={() => join(null)}
                disabled={joining}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f2c14e] px-4 py-2.5 text-sm font-black uppercase tracking-tight text-[#1c1a17] shadow-[4px_4px_0_#1c1a17] transition-all hover:-translate-y-0.5 hover:shadow-[5px_6px_0_#1c1a17] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_#1c1a17] disabled:opacity-50"
              >
                <Shuffle className="h-4 w-4" /> Quick Match
              </button>
            </div>
          </motion.section>

          {/* Status strip */}
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.16 }}
            className="md:col-span-2"
          >
            {joining && (
              <div className="flex items-center gap-3 rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f2c14e]/50 px-4 py-3 shadow-[4px_4px_0_#1c1a17]">
                <Loader2 className="h-5 w-5 animate-spin text-[#8c1f28]" />
                <div>
                  <div className="text-sm font-black uppercase tracking-tight text-[#1c1a17]">Filing protest paperwork…</div>
                  <div className="text-[11px] font-semibold text-[#1c1a17]/60">
                    Negotiating with the server committee. Stamp incoming.
                  </div>
                </div>
              </div>
            )}
            {joinError && (
              <div className="flex items-start gap-3 rounded-2xl border-2 border-[#8c1f28] bg-[#8c1f28]/10 px-4 py-3 shadow-[4px_4px_0_#8c1f28]">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#8c1f28]" />
                <div>
                  <div className="text-sm font-black uppercase tracking-tight text-[#8c1f28]">Join failed</div>
                  <div className="text-[11px] font-semibold text-[#1c1a17]/70">{joinError}</div>
                </div>
              </div>
            )}
            {!joining && !joinError && (
              <div className="flex flex-wrap items-center gap-4 rounded-2xl border-2 border-dashed border-[#1c1a17]/40 bg-[#efe6c8] px-4 py-3 text-[11px] font-semibold text-[#1c1a17]/70">
                <span className="flex items-center gap-1.5"><Server className="h-4 w-4 text-[#2e6e4e]" /> Server: game port 3002</span>
                <span className="flex items-center gap-1.5">
                  <span className="h-4 w-4 rounded-full border-2 border-[#1c1a17]/60" style={{ background: arch.colors.shirt }} />
                  Joining as {profile?.name ?? 'Protester'} — {arch.name}
                </span>
                <span>Room code is shared by telling friends. Very secure. Like democracy.</span>
              </div>
            )}
          </motion.section>
        </div>
      </div>
    </div>
  )
}
