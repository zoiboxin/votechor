'use client'

// v44 — the T comms panel: quick shouts (1–0), free-text chat and one-tap
// coordinate sharing. Open state lives in the store (chatOpen) so the engine can
// release pointer lock + suppress movement while the panel is up, and Escape
// closes the panel instead of pausing the game.
import { useEffect, useRef, useState } from 'react'
import { useGameStore, uiActions, parseCoords } from '@/lib/game-store'
import { MessageSquare, X, Send, MapPin, RotateCcw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import CoordChip from './CoordChip'
import { vcIsTouchDevice } from '@/lib/touch'

// Local copy of the engine's QUICK_MESSAGES (10 strings) — no static import of '@/game/game'
const QUICK_MESSAGES = [
  'Chai break, anyone?', 'Follow me!', 'POLICE! Scatter!', 'Nice one!', 'Help! Detained!',
  'To the flyover!', 'Uncle Ji approves.', 'Form a squad!', 'The gate needs votes!', 'Boss time!',
]

export default function QuickMessages() {
  const open = useGameStore((s) => s.chatOpen)
  const chatLog = useGameStore((s) => s.chat.log)
  const mapX = useGameStore((s) => s.hud.mapX)
  const mapZ = useGameStore((s) => s.hud.mapZ)
  // v46 — on touch devices the floating T button sat inside the minimap circle
  // (it is anchored to screen-center + offset, the radar is bottom-right) — and
  // touch players now have a dedicated chat button in the touch utility row.
  const [isTouch] = useState(() => vcIsTouchDevice())
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const setOpen = (v: boolean) => {
    useGameStore.getState().toggleChat(v)
    if (!v) setDraft('') // drop half-typed lines on close (open path resets below)
  }

  const send = (i: number) => {
    uiActions().sendQuickMessage(i)
    setOpen(false)
  }

  const sendDraft = () => {
    const text = draft.trim()
    if (!text) return
    uiActions().sendChatMessage(text)
    setDraft('')
    inputRef.current?.focus()
  }

  const shareLocation = () => {
    uiActions().sendChatMessage(`📍 Meet me at X ${mapX} · Z ${mapZ} — follow the radar pin!`)
    // keep the panel open so the sender sees their own pin line land in the log
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyT' && !e.repeat && e.type === 'keydown') {
        // avoid toggling while typing in an input
        const el = e.target as HTMLElement | null
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
        setOpen(!open)
        return
      }
      if (e.code === 'Escape') { setOpen(false); return }
      // while the panel is open, 1..9 / 0 send that message instantly
      if (!open) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      const m = /^Digit([0-9])$/.exec(e.code)
      if (m) {
        const idx = m[1] === '0' ? 9 : Number(m[1]) - 1
        if (idx < QUICK_MESSAGES.length) {
          e.preventDefault()
          send(idx)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // auto-focus the text box whenever the panel opens (pointer lock is released by
  // the engine subscription, so keyboard input lands straight in the field)
  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 30)
      return () => window.clearTimeout(t)
    }
  }, [open])

  const recent = chatLog.slice(-8)

  return (
    <>
      {/* toggle button — desktop only (touch uses the utility-row chat button) */}
      {!isTouch && (
        <button
          onClick={() => setOpen(!open)}
          title="Comms: chat + share location (T)"
          aria-expanded={open}
          className="pointer-events-auto fixed bottom-3 left-1/2 z-30 ml-36 flex h-10 w-10 translate-x-[-50%] items-center justify-center rounded-xl border-2 border-[#1c1a17]/80 bg-[#f5efdc]/92 shadow-[3px_3px_0_rgba(28,26,23,0.8)] backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:bg-[#f2c14e] sm:ml-44"
        >
          <MessageSquare className="h-5 w-5 text-[#1c1a17]" />
          <span className="absolute -right-1 -top-1.5 flex h-4 w-4 items-center justify-center rounded-md border border-[#1c1a17]/80 bg-[#1c1a17] text-[9px] font-black text-[#f2c14e]">
            T
          </span>
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="vc-paper pointer-events-auto fixed bottom-16 left-1/2 z-40 flex max-h-[calc(100dvh-5.5rem)] w-[min(360px,92vw)] -translate-x-1/2 flex-col overflow-y-auto vc-scroll rounded-2xl border-2 border-[#1c1a17]/80 p-2.5 shadow-[5px_5px_0_#1c1a17]"
          >
            <div className="mb-1.5 flex items-center justify-between px-1">
              <div>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8c1f28]">Protest Comms</span>
                <span className="ml-2 text-[8px] font-bold uppercase tracking-widest text-[#1c1a17]/45">shout 1–0 · Esc closes</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-[#1c1a17]/50 hover:text-[#8c1f28]" aria-label="Close comms">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* free-text chat + coordinate share */}
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 90))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); sendDraft() }
                }}
                placeholder="Type to the plaza… or share your location"
                maxLength={90}
                aria-label="Chat message"
                className="min-w-0 flex-1 rounded-xl border-2 border-[#1c1a17]/70 bg-white/80 px-2.5 py-1.5 text-xs font-semibold text-[#1c1a17] outline-none placeholder:text-[#1c1a17]/35 focus:border-[#8c1f28]"
              />
              <button
                onClick={sendDraft}
                disabled={!draft.trim()}
                title="Send chat"
                aria-label="Send chat"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border-2 border-[#1c1a17]/80 bg-[#2e6e4e] text-[#f5efdc] shadow-[2px_2px_0_#1c1a17] transition-all hover:-translate-y-0.5 disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
              <button
                onClick={shareLocation}
                title={`Share your coordinates (X ${mapX} · Z ${mapZ}) — teammates can click the pin to route there`}
                className="flex h-8 shrink-0 items-center gap-1 rounded-xl border-2 border-[#1c1a17]/80 bg-[#f2c14e] px-2 text-[10px] font-black uppercase tracking-wide text-[#1c1a17] shadow-[2px_2px_0_#1c1a17] transition-all hover:-translate-y-0.5 hover:bg-[#ffdf7e]"
              >
                <MapPin className="h-3.5 w-3.5" /> Share
              </button>
            </div>

            {/* recent chat log — coordinate lines grow a gold pin chip */}
            {recent.length > 0 && (
              <div className="vc-scroll mt-2 max-h-28 space-y-1 overflow-y-auto rounded-xl border border-dashed border-[#1c1a17]/30 bg-[#1c1a17]/[0.04] p-1.5">
                {recent.map((c) => {
                  const coords = parseCoords(c.text)
                  return (
                    <div key={c.id} className="flex items-start gap-1.5 text-[10px] leading-snug">
                      <span className={`shrink-0 font-black uppercase tracking-tight ${c.mine ? 'text-[#2e6e4e]' : c.bot ? 'text-[#1c1a17]/40' : 'text-[#8c1f28]'}`}>
                        {c.mine ? 'You' : c.name}
                      </span>
                      <span className="min-w-0 flex-1 break-words font-semibold text-[#1c1a17]/85">
                        {c.text}
                        {coords && (
                          <span className="ml-1 inline-flex">
                            <CoordChip text={c.text} who={c.mine ? undefined : c.name} />
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-1">
              {QUICK_MESSAGES.map((msg, i) => (
                <button
                  key={i}
                  onClick={() => send(i)}
                  className="flex items-center gap-1.5 rounded-xl border border-[#1c1a17]/50 bg-[#f5efdc] px-2 py-1.5 text-left text-[11px] font-bold text-[#1c1a17] transition-colors hover:border-[#8c1f28] hover:bg-[#f2c14e] sm:gap-2 sm:px-2.5 sm:text-xs"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[#1c1a17]/60 bg-[#1c1a17] text-[9px] font-black text-[#f2c14e]">
                    {i + 1}
                  </span>
                  <span className="min-w-0 truncate">{msg}</span>
                </button>
              ))}
            </div>

            {/* waypoint hint + clear */}
            <WaypointHint />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/** Shows the active radar pin (with a clear button) while the comms panel is up. */
function WaypointHint() {
  const waypoint = useGameStore((s) => s.hud.waypoint)
  if (!waypoint) return null
  return (
    <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-dashed border-[#b07d1e] bg-[#f2c14e]/25 px-2 py-1">
      <span className="flex items-center gap-1 truncate text-[9px] font-black uppercase tracking-wider text-[#1c1a17]/70">
        <MapPin className="h-3 w-3 text-[#b07d1e]" /> Radar pin: X {waypoint.x} · Z {waypoint.z}
      </span>
      <button
        onClick={() => useGameStore.getState().patchHud({ waypoint: null })}
        title="Clear the waypoint"
        aria-label="Clear waypoint"
        className="flex shrink-0 items-center gap-1 rounded-md border border-[#1c1a17]/50 bg-[#f5efdc] px-1.5 py-px text-[8px] font-black uppercase text-[#1c1a17]/70 hover:bg-[#f2c14e]"
      >
        <RotateCcw className="h-2.5 w-2.5" /> Clear
      </button>
    </div>
  )
}
