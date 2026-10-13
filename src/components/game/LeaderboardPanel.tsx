'use client'

import { useCallback, useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Trophy, RefreshCw, WifiOff, Vote, Route, Flag, Crown } from 'lucide-react'

interface Entry { name: string; level: number; xp: number; value: number }
type SortKey = 'xp' | 'distance' | 'wins'

const TABS: { key: SortKey; label: string; icon: typeof Vote; fmt: (v: number) => string }[] = [
  { key: 'xp', label: 'XP', icon: Vote, fmt: (v) => `${v} XP` },
  { key: 'distance', label: 'Distance', icon: Route, fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${v} m`) },
  { key: 'wins', label: 'Wins', icon: Flag, fmt: (v) => `${v} wins` },
]

const MEDALS = ['🥇', '🥈', '🥉']

export default function LeaderboardPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [sort, setSort] = useState<SortKey>('xp')
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (which: SortKey) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leaderboard?sort=${which}`)
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = (await res.json()) as { entries?: Entry[] }
      setEntries(Array.isArray(data.entries) ? data.entries : [])
    } catch {
      setError('The leaderboard office is on strike. Classic.')
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void load(sort)
  }, [open, sort, load])

  const renderRows = (which: SortKey) => {
    const fmt = TABS.find((t) => t.key === which)!.fmt
    if (loading) {
      return (
        <div className="space-y-1.5 py-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-xl border border-[#1c1a17]/30 bg-[#e8e0c8]" style={{ opacity: 1 - i * 0.12 }} />
          ))}
        </div>
      )
    }
    if (error) {
      return (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <WifiOff className="h-8 w-8 text-[#8c1f28]" />
          <p className="text-xs font-bold text-[#1c1a17]/70">{error}</p>
        </div>
      )
    }
    if (entries.length === 0) {
      return (
        <p className="py-6 text-center text-xs font-bold text-[#1c1a17]/60">
          No entries yet. History is written by those who press PLAY.
        </p>
      )
    }
    return (
      <div className="space-y-1.5">
        {entries.map((e, i) => (
          <div
            key={`${e.name}-${i}`}
            className={`flex items-center gap-2.5 rounded-xl border-2 px-3 py-2 ${
              i === 0
                ? 'border-[#b07d1e] bg-[#f2c14e] shadow-[3px_3px_0_#b07d1e]'
                : 'border-[#1c1a17]/50 bg-[#f5efdc]'
            }`}
          >
            <span className="flex w-8 shrink-0 items-center justify-center text-sm font-black tabular-nums text-[#1c1a17]">
              {i < 3 ? <span className="text-lg leading-none">{MEDALS[i]}</span> : `#${i + 1}`}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-black uppercase tracking-tight text-[#1c1a17]">
              {e.name}
            </span>
            <span className="shrink-0 rounded-full border border-[#1c1a17]/50 bg-[#1c1a17] px-1.5 py-0.5 text-[9px] font-black text-[#f2c14e]">
              LV {e.level}
            </span>
            <span className={`w-20 shrink-0 text-right text-xs font-black tabular-nums ${i === 0 ? 'text-[#8c1f28]' : 'text-[#2e6e4e]'}`}>
              {fmt(which === 'xp' ? e.xp : e.value)}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="vc-scroll vc-paper max-h-[88vh] overflow-y-auto rounded-2xl border-2 border-[#1c1a17]/80 p-5 shadow-[7px_7px_0_#1c1a17] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl font-black uppercase tracking-tight text-[#1c1a17]">
            <Trophy className="h-6 w-6 text-[#b07d1e]" /> Hall of Protest
          </DialogTitle>
          <DialogDescription className="text-xs font-semibold text-[#1c1a17]/60">
            Ranked by deeds, not by donations. Refresh responsibly.
          </DialogDescription>
        </DialogHeader>

        <button
          onClick={() => void load(sort)}
          disabled={loading}
          className="absolute right-4 top-4 flex items-center gap-1.5 rounded-lg border-2 border-[#1c1a17]/60 bg-[#f5efdc] px-2 py-1 text-[10px] font-black uppercase tracking-tight text-[#1c1a17] transition-colors hover:bg-[#f2c14e] disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>

        <Tabs value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <TabsList className="w-full rounded-xl border-2 border-[#1c1a17]/70 bg-[#e8e0c8]">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.key}
                value={t.key}
                className="flex-1 gap-1 rounded-lg font-black uppercase tracking-tight data-[state=active]:bg-[#8c1f28] data-[state=active]:text-[#f5efdc]"
              >
                <t.icon className="h-3.5 w-3.5" /> {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {TABS.map((t) => (
            <TabsContent key={t.key} value={t.key} className="mt-3">
              {renderRows(t.key)}
            </TabsContent>
          ))}
        </Tabs>

        <div className="flex items-center justify-center gap-1.5 border-t-2 border-dashed border-[#1c1a17]/30 pt-2 text-[9px] font-bold uppercase tracking-widest text-[#1c1a17]/40">
          <Crown className="h-3 w-3" /> Bribing the returning officer is technically not implemented
        </div>
      </DialogContent>
    </Dialog>
  )
}
