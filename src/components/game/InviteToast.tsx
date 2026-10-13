'use client'

/**
 * Interactive squad-invite flyer (§15) — rendered top-center above the toast stack.
 * Auto-expires after 20s (client + server agree on the TTL); Accept joins the cell,
 * Decline sends the inviter a polite refusal. Styled as a hand-passed protest flyer.
 */
import { useEffect, useState } from 'react'
import { useGameStore, uiActions } from '@/lib/game-store'
import { Users, Check, X, Mail } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

const TTL_MS = 20000

export default function InviteToast() {
  const invite = useGameStore((s) => s.pendingInvite)
  const setPendingInvite = useGameStore((s) => s.setPendingInvite)
  const [now, setNow] = useState(Date.now())
  const [answered, setAnswered] = useState<'accepted' | 'declined' | null>(null)

  // countdown ticker while a flyer is up
  useEffect(() => {
    if (!invite) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [invite])

  // reset answered state whenever a NEW invite arrives
  useEffect(() => {
    setAnswered(null)
  }, [invite?.fromId, invite?.at])

  if (!invite) return null

  const remain = Math.max(0, TTL_MS - (now - invite.at))
  const expired = remain <= 0

  const answer = (kind: 'accepted' | 'declined') => {
    if (answered || expired) return
    setAnswered(kind)
    if (kind === 'accepted') uiActions().squadInviteAccept(invite.fromId)
    else uiActions().squadInviteDecline(invite.fromId)
    window.setTimeout(() => setPendingInvite(null), 650)
  }

  return (
    <div className="pointer-events-none fixed left-1/2 top-1.5 z-[60] flex -translate-x-1/2 justify-center">
      <AnimatePresence>
        <motion.div
          key={`${invite.fromId}:${invite.at}`}
          initial={{ opacity: 0, y: -26, scale: 0.9, rotate: -2.5 }}
          animate={{ opacity: 1, y: 0, scale: 1, rotate: answered ? (answered === 'accepted' ? 1 : -1) : 0 }}
          exit={{ opacity: 0, y: -20, scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 300, damping: 22 }}
          className="vc-paper pointer-events-auto w-[min(400px,94vw)] rounded-2xl border-2 border-[#8c1f28] p-0 shadow-[6px_6px_0_rgba(28,26,23,0.85)]"
          role="alertdialog"
          aria-label={`Squad invite from ${invite.fromName}`}
        >
          {/* header strip */}
          <div className="flex items-center justify-between gap-2 rounded-t-[13px] border-b-2 border-dashed border-[#8c1f28]/50 bg-[#8c1f28] px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-[#f5efdc]">
              <Mail className="h-3.5 w-3.5" /> Protest Cell Invite
            </span>
            <span className="rounded border border-[#f5efdc]/40 bg-[#1c1a17]/30 px-1.5 py-0.5 font-mono text-[11px] font-black tracking-[0.25em] text-[#f2c14e]">
              {invite.code}
            </span>
          </div>

          <div className="px-3 pb-2.5 pt-2">
            <p className="text-xs font-bold leading-snug text-[#1c1a17]">
              <span className="font-black uppercase text-[#8c1f28]">{invite.fromName}</span>
              {' '}wants you in their protest cell. Green tags, rally teleports, shared chai.
            </p>

            {/* expiry meter */}
            <div className="mt-2 h-1.5 overflow-hidden rounded-full border border-[#1c1a17]/40 bg-[#1c1a17]/10">
              <div
                className={`h-full transition-[width] duration-200 ${remain < 5000 ? 'bg-[#8c1f28]' : 'bg-[#2e6e4e]'}`}
                style={{ width: `${(remain / TTL_MS) * 100}%` }}
              />
            </div>

            {answered ? (
              <div
                className={`mt-2 rounded-lg border-2 px-2 py-1.5 text-center text-[10px] font-black uppercase tracking-widest ${
                  answered === 'accepted'
                    ? 'border-[#2e6e4e] bg-[#dcebe0] text-[#2e6e4e]'
                    : 'border-[#8c1f28] bg-[#f5d9d4] text-[#8c1f28]'
                }`}
              >
                {answered === 'accepted' ? '✓ Joining the cell…' : '✗ Invite declined'}
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() => answer('accepted')}
                  disabled={expired}
                  className="flex items-center justify-center gap-1 rounded-lg border-2 border-[#1c1a17]/80 bg-[#2e6e4e] px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-[#f5efdc] shadow-[3px_3px_0_rgba(28,26,23,0.7)] transition-transform hover:-translate-y-0.5 hover:bg-[#3d8a62] active:translate-y-0 disabled:opacity-40"
                >
                  <Check className="h-3.5 w-3.5" /> Join cell
                </button>
                <button
                  onClick={() => answer('declined')}
                  disabled={expired}
                  className="flex items-center justify-center gap-1 rounded-lg border-2 border-[#1c1a17]/70 bg-[#f5d9d4] px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-[#8c1f28] shadow-[3px_3px_0_rgba(28,26,23,0.5)] transition-transform hover:-translate-y-0.5 hover:bg-[#efc4bc] active:translate-y-0 disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" /> Decline
                </button>
              </div>
            )}

            <p className="mt-1.5 flex items-center justify-center gap-1 text-center text-[8px] font-bold uppercase tracking-widest text-[#1c1a17]/45">
              <Users className="h-2.5 w-2.5" /> expires in {Math.ceil(remain / 1000)}s — the committee is timing you
            </p>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
