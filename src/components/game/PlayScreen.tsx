'use client'

import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '@/lib/game-store'
import { uiActions } from '@/lib/game-store'
import { archetypeById } from '@/game/shared/constants'
import { ArrowLeft, Users, Zap, Shuffle, KeyRound, Server, Loader2, AlertTriangle, Ticket, Copy, Check, Link2 } from 'lucide-react'
import { motion } from 'framer-motion'

/** Unambiguous room-code alphabet (no I/L/O/0/1 — the committee gave up on fonts). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function generateRoomCode(): string {
  let code = ''
  const rnd = new Uint32Array(6)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(rnd)
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[(rnd[i] ?? Math.floor(Math.random() * 1e9)) % CODE_ALPHABET.length]
  return code
}

/** Harvest ?squad=CODE from the URL into sessionStorage (consumed on join-ack). */
function harvestSquadDeepLink(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = (params.get('squad') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
    if (raw.length === 4) {
      sessionStorage.setItem('vc_squad_deeplink', raw)
      params.delete('squad')
      const qs = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
      return raw
    }
    // honor a pending link even if the page was refreshed after harvest
    const pending = sessionStorage.getItem('vc_squad_deeplink')
    return pending && /^[A-Z0-9]{4}$/.test(pending) ? pending : null
  } catch {
    return null
  }
}

export default function PlayScreen({ onBack }: { onBack: () => void }) {
  const joining = useGameStore((s) => s.joining)
  const joinError = useGameStore((s) => s.joinError)
  const profile = useGameStore((s) => s.profile)
  const [roomCode, setRoomCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [deepCell, setDeepCell] = useState<string | null>(null)
  const soloStarted = useRef(false)

  // reset join state when arriving on this screen + harvest ?squad= deep links
  useEffect(() => {
    useGameStore.getState().setJoining(false, null)
    const cell = harvestSquadDeepLink()
    const t = window.setTimeout(() => setDeepCell(cell), 0)
    return () => window.clearTimeout(t)
  }, [])

  const clearDeepCell = () => {
    setDeepCell(null)
    try { sessionStorage.removeItem('vc_squad_deeplink') } catch { /* ignore */ }
  }

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

  const createPrivate = () => {
    if (joining || soloStarted.current) return
    const code = generateRoomCode()
    setRoomCode(code)
    setCopied(false)
    useGameStore.getState().setRoomCode(code)
    uiActions().joinMultiplayer(code)
  }

  const copyCode = async () => {
    const code = cleanCode || (joining ? useGameStore.getState().roomCode ?? '' : '')
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = code
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      } catch { /* clipboard unavailable */ }
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
          {/* Invite deep-link banner (§15) */}
          {deepCell && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="md:col-span-2 flex items-center gap-3 rounded-2xl border-2 border-dashed border-[#8c1f28] bg-[#f2c14e]/40 px-4 py-3 shadow-[4px_4px_0_rgba(140,31,40,0.7)]"
              role="status"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 border-[#1c1a17]/70 bg-[#f2c14e]">
                <Link2 className="h-5 w-5 text-[#8c1f28]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black uppercase tracking-tight text-[#1c1a17]">Cell invite detected</div>
                <div className="text-[11px] font-semibold text-[#1c1a17]/70">
                  Join any multiplayer room and you will auto-connect to cell{' '}
                  <span className="font-mono font-black tracking-[0.2em] text-[#8c1f28]">{deepCell}</span>
                </div>
              </div>
              <button
                onClick={clearDeepCell}
                className="shrink-0 rounded-lg border-2 border-[#1c1a17]/50 bg-[#f5efdc] px-2 py-1 text-[9px] font-black uppercase tracking-widest text-[#1c1a17]/70 transition-colors hover:bg-[#f2c14e]"
                aria-label="Dismiss cell invite link"
              >
                Dismiss
              </button>
            </motion.div>
          )}

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
              <h3 className="text-lg font-black uppercase tracking-tight text-[#1c1a17]">Solo · Season Queue</h3>
            </div>
            <p className="mt-2 flex-1 text-xs font-semibold leading-relaxed text-[#1c1a17]/70">
              Drop into a live SEASON — a persistent city of 100 protesters. Bots fill every empty slot (and they wander,
              chat, flee police and march on checkpoints). When a real player joins, a bot steps aside. Leave and come back:
              your season keeps breathing.
            </p>
            <button
              onClick={startSolo}
              disabled={joining}
              className="mt-4 rounded-2xl border-2 border-[#1c1a17]/80 bg-[#8c1f28] px-4 py-3 text-sm font-black uppercase tracking-tight text-[#f5efdc] shadow-[4px_4px_0_#1c1a17] transition-all hover:-translate-y-0.5 hover:shadow-[5px_6px_0_#1c1a17] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_#1c1a17] disabled:opacity-50"
            >
              Start Solo · Join Season
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
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => join(null)}
                  disabled={joining}
                  className="flex items-center justify-center gap-2 rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f2c14e] px-4 py-2.5 text-sm font-black uppercase tracking-tight text-[#1c1a17] shadow-[4px_4px_0_#1c1a17] transition-all hover:-translate-y-0.5 hover:shadow-[5px_6px_0_#1c1a17] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_#1c1a17] disabled:opacity-50"
                >
                  <Shuffle className="h-4 w-4" /> Quick Match
                </button>
                <button
                  onClick={createPrivate}
                  disabled={joining}
                  className="flex items-center justify-center gap-2 rounded-2xl border-2 border-[#1c1a17]/80 bg-[#8c1f28] px-4 py-2.5 text-sm font-black uppercase tracking-tight text-[#f5efdc] shadow-[4px_4px_0_#1c1a17] transition-all hover:-translate-y-0.5 hover:shadow-[5px_6px_0_#1c1a17] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_#1c1a17] disabled:opacity-50"
                >
                  <Ticket className="h-4 w-4" /> Private Room
                </button>
              </div>
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
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black uppercase tracking-tight text-[#1c1a17]">Filing protest paperwork…</div>
                  <div className="text-[11px] font-semibold text-[#1c1a17]/60">
                    Negotiating with the server committee. Stamp incoming.
                  </div>
                </div>
                {cleanCode && (
                  <button
                    onClick={copyCode}
                    className="flex shrink-0 items-center gap-1.5 rounded-xl border-2 border-dashed border-[#8c1f28] bg-[#f5efdc] px-3 py-1.5 transition-colors hover:bg-[#f2c14e]"
                    aria-label={`Copy room code ${cleanCode}`}
                  >
                    <span className="text-base font-black tracking-[0.2em] text-[#8c1f28]">{cleanCode}</span>
                    {copied ? <Check className="h-4 w-4 text-[#2e6e4e]" /> : <Copy className="h-4 w-4 text-[#8c1f28]" />}
                  </button>
                )}
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
