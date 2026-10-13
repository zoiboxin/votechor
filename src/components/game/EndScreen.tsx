'use client'

import { useEffect, useState } from 'react'
import { useGameStore, uiActions } from '@/lib/game-store'
import { xpForLevel, levelFromXp } from '@/game/shared/constants'
import {
  Vote, Crown, Skull, Trophy, Footprints, Flag, KeyRound, HeartPulse, Package, Zap,
  Timer, Users, Play, Home, Medal, X, CalendarCheck, CalendarRange, Handshake, Gift,
} from 'lucide-react'
import { motion } from 'framer-motion'

const AUTO_RETURN_SECONDS = 14

export default function EndScreen() {
  const summary = useGameStore((s) => s.matchSummary)
  const profile = useGameStore((s) => s.profile)
  const [countdown, setCountdown] = useState(AUTO_RETURN_SECONDS)
  const [autoReturn, setAutoReturn] = useState(true)

  const toMenu = () => {
    setAutoReturn(false)
    useGameStore.getState().setMatchSummary(null)
    useGameStore.getState().setUIMode('menu')
  }
  const playAgain = () => {
    setAutoReturn(false)
    uiActions().startSolo()
  }

  useEffect(() => {
    if (!autoReturn) return
    if (countdown <= 0) {
      // navigate on the next tick — keeps the effect body free of state writes
      const t = setTimeout(() => toMenu(), 0)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [autoReturn, countdown])

  if (!summary) {
    return (
      <div className="vc-paper pointer-events-auto fixed inset-0 z-40 flex flex-col items-center justify-center gap-3">
        <Crown className="h-10 w-10 animate-pulse text-[#8c1f28]" />
        <p className="text-sm font-black uppercase tracking-widest text-[#1c1a17]">Tallying the votes…</p>
      </div>
    )
  }

  const victory = summary.victory
  const level = summary.newLevel || profile?.level || levelFromXp(profile?.xp ?? 0)
  const base = xpForLevel(level)
  const next = xpForLevel(level + 1)
  const xpIntoLevel = Math.max(0, (profile?.xp ?? base) - base)
  const pct = Math.min(100, (xpIntoLevel / Math.max(1, next - base)) * 100)

  const stats = [
    { icon: Vote, label: 'Vote Tokens', value: summary.tokens },
    { icon: Footprints, label: 'Distance', value: `${summary.distance} m` },
    { icon: Flag, label: 'Checkpoints', value: summary.checkpoints },
    { icon: KeyRound, label: 'Rescues', value: summary.rescues },
    { icon: HeartPulse, label: 'Revives', value: summary.revives },
    { icon: Package, label: 'Items Grabbed', value: summary.itemsCollected },
    { icon: Gift, label: 'Gifts Given', value: summary.gifts ?? 0 },
    { icon: Zap, label: 'Boss Hits', value: summary.bossContribution },
    { icon: Skull, label: 'Detentions', value: summary.detentions },
    { icon: Timer, label: 'Duration', value: `${Math.floor(summary.duration / 60)}m ${Math.floor(summary.duration % 60)}s` },
    { icon: Users, label: 'Protesters Online', value: summary.playersOnline },
  ]

  return (
    <div className="vc-paper pointer-events-auto fixed inset-0 z-40 overflow-y-auto vc-scroll">
      <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background:repeating-linear-gradient(-35deg,#2e6e4e_0_18px,transparent_18px_36px,#8c1f28_36px_54px,transparent_54px_72px)]" />

      <div className="relative mx-auto flex min-h-full w-full max-w-3xl flex-col gap-4 px-4 py-6">
        {/* Banner */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0, rotate: victory ? -3 : 3 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 180, damping: 14 }}
          className={`rounded-3xl border-2 border-[#1c1a17]/80 p-6 text-center shadow-[7px_7px_0_#1c1a17] ${
            victory ? 'bg-[#2e6e4e]' : 'bg-[#8c1f28]'
          }`}
        >
          {victory ? (
            <Crown className="mx-auto h-12 w-12 text-[#f2c14e]" />
          ) : (
            <Skull className="mx-auto h-12 w-12 text-[#f5efdc]" />
          )}
          <h1 className={`mt-2 text-4xl font-black uppercase tracking-tight sm:text-5xl ${victory ? 'text-[#f5efdc]' : 'text-[#f5efdc]'}`}>
            {victory ? 'Democracy Restored!' : 'The Committee Prevails'}
          </h1>
          <p className={`mt-1 text-xs font-bold uppercase tracking-widest ${victory ? 'text-[#dcebe0]' : 'text-[#f5d9d4]'}`}>
            {victory
              ? 'The stolen votes are home. The pigeons salute you.'
              : 'Another meeting has been scheduled. Bring snacks next time.'}
          </p>
        </motion.div>

        {/* Funny title stamp */}
        <div className="flex justify-center">
          <motion.div
            initial={{ scale: 2.1, opacity: 0, rotate: -8 }}
            animate={{ scale: 1, opacity: 1, rotate: -8 }}
            transition={{ delay: 0.35, type: 'spring', stiffness: 200, damping: 13 }}
            className="vc-stamp-texture rounded-lg border-4 border-[#8c1f28] bg-[#8c1f28]/10 px-5 py-1.5"
          >
            <span className="text-sm font-black uppercase tracking-[0.12em] text-[#8c1f28] sm:text-base">
              {summary.funnyTitle}
            </span>
          </motion.div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.04 }}
              className="rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc] p-2.5 text-center shadow-[3px_3px_0_#1c1a17]"
            >
              <s.icon className="mx-auto h-4 w-4 text-[#8c1f28]" />
              <div className="mt-1 text-lg font-black tabular-nums leading-none text-[#1c1a17]">{s.value}</div>
              <div className="mt-0.5 text-[8px] font-black uppercase tracking-wider text-[#1c1a17]/55">{s.label}</div>
            </motion.div>
          ))}
        </div>

        {/* XP earned + level bar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc] p-4 shadow-[4px_4px_0_#1c1a17]"
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[#1c1a17]">
              <Trophy className="h-4 w-4 text-[#b07d1e]" /> XP Earned
            </span>
            <span className="text-xl font-black tabular-nums text-[#2e6e4e]">+{summary.xpEarned}</span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 border-[#1c1a17]/80 bg-[#f2c14e] text-sm font-black text-[#1c1a17]">
              {level}
            </span>
            <div className="flex-1">
              <div className="mb-1 flex justify-between text-[9px] font-black uppercase tracking-wider text-[#1c1a17]/55">
                <span>Level {level}</span>
                <span>{xpIntoLevel}/{next - base} XP</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full border-2 border-[#1c1a17]/70 bg-[#e8e0c8]">
                <motion.div
                  className="h-full bg-gradient-to-r from-[#2e6e4e] to-[#4e9b6e]"
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ delay: 0.6, duration: 1.1, ease: 'easeOut' }}
                />
              </div>
            </div>
          </div>
          {summary.dailyJustCompleted && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, rotate: -1 }}
              animate={{ opacity: 1, scale: 1, rotate: -1 }}
              transition={{ delay: 0.8 }}
              className="mt-2 flex items-center justify-between rounded-xl border-2 border-dashed border-[#8c1f28] bg-[#f2c14e]/40 px-3 py-1.5"
            >
              <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[#8c1f28]">
                <CalendarCheck className="h-3.5 w-3.5" /> Daily challenge complete
              </span>
              <span className="text-xs font-black tabular-nums text-[#8c1f28]">+{summary.dailyBonus ?? 0} bonus</span>
            </motion.div>
          )}
          {summary.weeklyJustCompleted && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, rotate: 1 }}
              animate={{ opacity: 1, scale: 1, rotate: 1 }}
              transition={{ delay: 0.95 }}
              className="mt-2 flex items-center justify-between rounded-xl border-2 border-dashed border-[#2e6e4e] bg-[#dcebe0] px-3 py-1.5"
            >
              <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[#2e6e4e]">
                <CalendarRange className="h-3.5 w-3.5" /> Weekly challenge complete
              </span>
              <span className="text-xs font-black tabular-nums text-[#2e6e4e]">+{summary.weeklyBonus ?? 0} bonus</span>
            </motion.div>
          )}
          {summary.streakUp && (summary.streak ?? 0) > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, rotate: -1 }}
              animate={{ opacity: 1, scale: 1, rotate: -1 }}
              transition={{ delay: 1.05 }}
              className="mt-2 flex items-center justify-between rounded-xl border-2 border-[#b07d1e] bg-gradient-to-r from-[#f2c14e]/45 to-[#f2c14e]/15 px-3 py-1.5"
            >
              <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[#1c1a17]">
                <motion.span
                  animate={{ scale: [1, 1.25, 1], rotate: [0, -8, 8, 0] }}
                  transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 2.5 }}
                  className="text-sm leading-none"
                  aria-hidden
                >
                  🔥
                </motion.span>
                {summary.streak === 1 ? 'Streak started — come back tomorrow!' : `Streak day ${summary.streak} — chain unbroken`}
              </span>
              <span className="text-[9px] font-black uppercase tracking-widest text-[#8c1f28]">
                {summary.streak === 1 ? 'Day 1' : `×${summary.streak}`}
              </span>
            </motion.div>
          )}
          {(summary.solidarityBonus ?? 0) > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, rotate: 1 }}
              animate={{ opacity: 1, scale: 1, rotate: 1 }}
              transition={{ delay: 1.15 }}
              className="mt-2 flex items-center justify-between rounded-xl border-2 border-[#2e6e4e] bg-gradient-to-r from-[#2e6e4e]/20 to-[#2e6e4e]/5 px-3 py-1.5"
            >
              <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[#2e6e4e]">
                <Handshake className="h-3.5 w-3.5" />
                Solidarity bonus — marched with {(summary.squadSize ?? 2) - 1} cellmate{(summary.squadSize ?? 2) === 2 ? '' : 's'}
              </span>
              <span className="text-xs font-black tabular-nums text-[#2e6e4e]">+{summary.solidarityBonus}</span>
            </motion.div>
          )}
          {summary.leveledUp && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: [0, 1, 0.6, 1] }}
              transition={{ delay: 1, duration: 0.8 }}
              className="mt-2 rounded-xl border-2 border-[#b07d1e] bg-[#f2c14e] py-1.5 text-center text-xs font-black uppercase tracking-[0.2em] text-[#1c1a17]"
            >
              ⭐ Level Up! You are now Level {summary.newLevel} — the aunty has noticed ⭐
            </motion.div>
          )}
        </motion.div>

        {/* New achievements */}
        {summary.newAchievements.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc] p-4 shadow-[4px_4px_0_#1c1a17]"
          >
            <div className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[#1c1a17]">
              <Medal className="h-4 w-4 text-[#8c1f28]" /> Medals Unlocked
            </div>
            <div className="flex flex-wrap gap-2">
              {summary.newAchievements.map((a) => (
                <span
                  key={a.id}
                  className="flex items-center gap-1.5 rounded-full border-2 border-[#b07d1e] bg-[#f2c14e] px-3 py-1 text-[11px] font-black uppercase tracking-tight text-[#1c1a17] shadow-[2px_2px_0_#b07d1e]"
                >
                  <Medal className="h-3.5 w-3.5" /> {a.name}
                </span>
              ))}
            </div>
          </motion.div>
        )}

        {/* Actions */}
        <div className="mt-auto grid gap-2.5 pt-2 sm:grid-cols-2">
          <button
            onClick={playAgain}
            className="flex items-center justify-center gap-2 rounded-2xl border-2 border-[#1c1a17]/80 bg-[#8c1f28] px-4 py-3.5 text-sm font-black uppercase tracking-tight text-[#f5efdc] shadow-[5px_5px_0_#1c1a17] transition-all hover:-translate-y-0.5 hover:shadow-[6px_7px_0_#1c1a17] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_#1c1a17]"
          >
            <Play className="h-5 w-5" strokeWidth={2.6} /> Run It Again
          </button>
          <button
            onClick={toMenu}
            className="flex items-center justify-center gap-2 rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc] px-4 py-3.5 text-sm font-black uppercase tracking-tight text-[#1c1a17] shadow-[5px_5px_0_#1c1a17] transition-all hover:-translate-y-0.5 hover:shadow-[6px_7px_0_#1c1a17] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_#1c1a17]"
          >
            <Home className="h-5 w-5" strokeWidth={2.6} /> Back to Menu
          </button>
        </div>

        {autoReturn && (
          <div className="flex items-center justify-center gap-2 pb-2 text-[10px] font-black uppercase tracking-widest text-[#1c1a17]/50">
            <span>Menu in {countdown}s</span>
            <button
              onClick={() => setAutoReturn(false)}
              className="flex items-center gap-1 rounded-full border border-[#1c1a17]/40 px-2 py-0.5 hover:border-[#8c1f28] hover:text-[#8c1f28]"
            >
              <X className="h-3 w-3" /> Stay
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
