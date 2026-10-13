'use client'

import { useEffect, useState } from 'react'
import { useGameStore } from '@/lib/game-store'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import {
  BarChart3, RefreshCw, WifiOff, Vote, Footprints, Flag, KeyRound, HeartPulse, Package,
  Skull, Trophy, Users, Swords, Crown,
} from 'lucide-react'
import { motion } from 'framer-motion'

const CARDS = [
  { key: 'matches', label: 'Protests Joined', icon: Users },
  { key: 'wins', label: 'Victories', icon: Crown },
  { key: 'tokens', label: 'Votes Recovered', icon: Vote },
  { key: 'distance', label: 'Distance Run', icon: Footprints, fmt: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${v} m`) },
  { key: 'checkpoints', label: 'Checkpoints', icon: Flag },
  { key: 'rescues', label: 'Rescues', icon: KeyRound },
  { key: 'revives', label: 'Revives', icon: HeartPulse },
  { key: 'itemsCollected', label: 'Items Looted', icon: Package },
  { key: 'bossHits', label: 'Boss Hits Landed', icon: Swords },
  { key: 'detentions', label: 'Times Detained', icon: Skull },
] as const

export default function StatsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const profile = useGameStore((s) => s.profile)
  const notify = useGameStore((s) => s.notify)
  const [stats, setStats] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(false)
      try {
        const token = (() => {
          try {
            const raw = localStorage.getItem('votechor_profile')
            return raw ? (JSON.parse(raw) as { token?: string }).token ?? '' : ''
          } catch {
            return ''
          }
        })()
        const res = await fetch('/api/stats', { headers: { 'x-vc-token': token } })
        if (!res.ok) throw new Error(`status ${res.status}`)
        const data = (await res.json()) as { stats?: Record<string, number> }
        if (cancelled) return
        setStats(data.stats ?? {})
      } catch {
        if (!cancelled) {
          setError(true)
          notify('The statistics bureau has misfiled your file. Typical.', 'warning')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, notify])

  const fmt = (k: string, raw: number | undefined) => {
    const card = CARDS.find((c) => c.key === k)
    const v = raw ?? 0
    return card && 'fmt' in card && card.fmt ? card.fmt(v) : `${v}`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="vc-scroll vc-paper max-h-[88vh] overflow-y-auto rounded-2xl border-2 border-[#1c1a17]/80 p-5 shadow-[7px_7px_0_#1c1a17] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl font-black uppercase tracking-tight text-[#1c1a17]">
            <BarChart3 className="h-6 w-6 text-[#2e6e4e]" /> Lifetime Protest Record
          </DialogTitle>
          <DialogDescription className="text-xs font-semibold text-[#1c1a17]/60">
            Official file for <b className="font-black">{profile?.name ?? 'Unregistered Protester'}</b> — kept in triplicate, obviously.
          </DialogDescription>
        </DialogHeader>

        <button
          onClick={() => {
            // re-trigger by remounting state via a manual refresh
            setLoading(true)
            void (async () => {
              try {
                const raw = localStorage.getItem('votechor_profile')
                const token = raw ? (JSON.parse(raw) as { token?: string }).token ?? '' : ''
                const res = await fetch('/api/stats', { headers: { 'x-vc-token': token } })
                if (res.ok) {
                  const data = (await res.json()) as { stats?: Record<string, number> }
                  setStats(data.stats ?? {})
                  setError(false)
                }
              } finally {
                setLoading(false)
              }
            })()
          }}
          disabled={loading}
          className="absolute right-4 top-4 flex items-center gap-1.5 rounded-lg border-2 border-[#1c1a17]/60 bg-[#f5efdc] px-2 py-1 text-[10px] font-black uppercase tracking-tight text-[#1c1a17] transition-colors hover:bg-[#f2c14e] disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>

        {error ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <WifiOff className="h-8 w-8 text-[#8c1f28]" />
            <p className="text-xs font-bold text-[#1c1a17]/70">
              Stats unavailable. Your legendary runs remain legendary but unverified.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CARDS.map((c, i) => (
              <motion.div
                key={c.key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="rounded-2xl border-2 border-[#1c1a17]/70 bg-[#f5efdc] p-3 text-center shadow-[3px_3px_0_#1c1a17]"
              >
                <c.icon className={`mx-auto h-4 w-4 ${loading ? 'animate-pulse' : ''} text-[#8c1f28]`} />
                <div className={`mt-1 truncate text-lg font-black tabular-nums leading-none text-[#1c1a17] ${loading ? 'opacity-40' : ''}`}>
                  {fmt(c.key, stats[c.key])}
                </div>
                <div className="mt-0.5 text-[8px] font-black uppercase tracking-wider text-[#1c1a17]/55">{c.label}</div>
              </motion.div>
            ))}
            <div className="col-span-2 rounded-2xl border-2 border-dashed border-[#2e6e4e]/50 bg-[#dcebe0] p-2.5 text-center sm:col-span-3">
              <span className="flex items-center justify-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[#2e6e4e]">
                <Trophy className="h-3.5 w-3.5" />
                Total XP: {stats.xp ?? stats.totalXp ?? 0}
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
