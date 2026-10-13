'use client'

import { useEffect, useState } from 'react'
import { useGameStore } from '@/lib/game-store'
import { ACHIEVEMENTS } from '@/game/shared/constants'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import {
  Medal, Lock, Footprints, Fence, Coffee, KeyRound, HeartPulse, Shield, Route, Vote, Crown, Landmark, Cone, Target,
} from 'lucide-react'
import { motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  footprints: Footprints, fence: Fence, coffee: Coffee, 'key-round': KeyRound,
  'heart-pulse': HeartPulse, shield: Shield, route: Route, vote: Vote,
  crown: Crown, landmark: Landmark, cone: Cone, target: Target,
}

interface AchDef { id: string; name: string; description: string; icon: string; xpReward: number }

export default function AchievementsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const notify = useGameStore((s) => s.notify)
  const [all, setAll] = useState<AchDef[]>(ACHIEVEMENTS as AchDef[])
  const [unlocked, setUnlocked] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const token = (() => {
          try {
            const raw = localStorage.getItem('votechor_profile')
            return raw ? (JSON.parse(raw) as { token?: string }).token ?? '' : ''
          } catch {
            return ''
          }
        })()
        const res = await fetch('/api/achievements', { headers: { 'x-vc-token': token } })
        if (!res.ok) throw new Error(`status ${res.status}`)
        const data = (await res.json()) as { all?: AchDef[]; unlocked?: string[] }
        if (cancelled) return
        if (Array.isArray(data.all) && data.all.length > 0) setAll(data.all)
        if (Array.isArray(data.unlocked)) setUnlocked(data.unlocked)
      } catch {
        if (!cancelled) notify('Medal cabinet locked. Showing the local collection instead.', 'warning')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, notify])

  const unlockedCount = all.filter((a) => unlocked.includes(a.id)).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="vc-scroll vc-paper max-h-[88vh] overflow-y-auto rounded-2xl border-2 border-[#1c1a17]/80 p-5 shadow-[7px_7px_0_#1c1a17] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl font-black uppercase tracking-tight text-[#1c1a17]">
            <Medal className="h-6 w-6 text-[#8c1f28]" /> Medal Cabinet
          </DialogTitle>
          <DialogDescription className="text-xs font-semibold text-[#1c1a17]/60">
            {unlockedCount}/{all.length} unlocked — the rest are for your grandchildren.
          </DialogDescription>
        </DialogHeader>

        {/* progress */}
        <div className="h-2.5 overflow-hidden rounded-full border-2 border-[#1c1a17]/70 bg-[#e8e0c8]">
          <motion.div
            className="h-full bg-gradient-to-r from-[#b07d1e] to-[#f2c14e]"
            initial={{ width: 0 }}
            animate={{ width: `${(unlockedCount / Math.max(1, all.length)) * 100}%` }}
            transition={{ duration: 0.7 }}
          />
        </div>

        {loading && <p className="animate-pulse text-center text-[10px] font-black uppercase tracking-widest text-[#1c1a17]/50">Polishing medals…</p>}

        <div className="grid gap-2 sm:grid-cols-2">
          {all.map((a, i) => {
            const isUnlocked = unlocked.includes(a.id)
            const Icon = ICONS[a.icon] ?? Medal
            return (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.035 }}
                className={`flex items-start gap-2.5 rounded-2xl border-2 p-3 ${
                  isUnlocked
                    ? 'border-[#b07d1e] bg-[#f2c14e]/35 shadow-[3px_3px_0_#b07d1e]'
                    : 'border-[#1c1a17]/40 bg-[#f5efdc] grayscale'
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 ${
                    isUnlocked ? 'border-[#1c1a17]/70 bg-[#1c1a17] text-[#f2c14e]' : 'border-[#1c1a17]/30 bg-[#e8e0c8] text-[#1c1a17]/40'
                  }`}
                >
                  {isUnlocked ? <Icon className="h-4.5 w-4.5" /> : <Lock className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`truncate text-xs font-black uppercase tracking-tight ${isUnlocked ? 'text-[#1c1a17]' : 'text-[#1c1a17]/55'}`}>
                      {a.name}
                    </span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-black ${isUnlocked ? 'bg-[#2e6e4e] text-[#f5efdc]' : 'bg-[#1c1a17]/10 text-[#1c1a17]/50'}`}>
                      +{a.xpReward} XP
                    </span>
                  </div>
                  <p className={`mt-0.5 text-[10px] font-semibold leading-snug ${isUnlocked ? 'text-[#1c1a17]/75' : 'text-[#1c1a17]/45'}`}>
                    {a.description}
                  </p>
                </div>
              </motion.div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
