'use client'

import { useEffect, useState } from 'react'
import { useGameStore } from '@/lib/game-store'
import { uiActions } from '@/lib/game-store'
import { ARCHETYPES, archetypeById, xpForLevel, levelFromXp, RANDOM_NOTIFICATIONS } from '@/game/shared/constants'
import {
  Play, Users, PersonStanding, BookOpen, Settings, Trophy, Medal, BarChart3,
  Pencil, Check, Vote, Megaphone, Wifi, WifiOff, CalendarDays,
} from 'lucide-react'
import { motion } from 'framer-motion'
import CharacterSelect from './CharacterSelect'
import PlayScreen from './PlayScreen'
import SettingsPanel from './SettingsPanel'
import HowToPlay from './HowToPlay'
import LeaderboardPanel from './LeaderboardPanel'
import AchievementsPanel from './AchievementsPanel'
import StatsPanel from './StatsPanel'

function Marquee() {
  // doubled list so the -50% translate loops seamlessly
  const line = [...RANDOM_NOTIFICATIONS, ...RANDOM_NOTIFICATIONS]
  return (
    <div className="relative overflow-hidden border-y-2 border-[#1c1a17]/80 bg-[#1c1a17] py-1.5">
      <div className="flex w-max animate-[vc-marquee_36s_linear_infinite] gap-10 whitespace-nowrap px-4">
        {line.map((t, i) => (
          <span key={i} className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#f2c14e] sm:text-xs">
            <Megaphone className="h-3.5 w-3.5 shrink-0 text-[#f2a541]" />
            {t}
          </span>
        ))}
      </div>
    </div>
  )
}

function MenuButton({
  icon: Icon, label, sub, onClick, tone = 'paper', disabled,
}: {
  icon: typeof Play
  label: string
  sub?: string
  onClick: () => void
  tone?: 'paper' | 'chili' | 'leaf'
  disabled?: boolean
}) {
  const tones = {
    paper: 'bg-[#f5efdc] text-[#1c1a17] hover:bg-[#efe6c8]',
    chili: 'bg-[#8c1f28] text-[#f5efdc] hover:bg-[#a02530]',
    leaf: 'bg-[#2e6e4e] text-[#f5efdc] hover:bg-[#3a8560]',
  } as const
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group flex w-full items-center gap-3 rounded-2xl border-2 border-[#1c1a17]/80 px-4 py-3 text-left shadow-[4px_4px_0_#1c1a17] transition-all duration-150 hover:-translate-y-0.5 hover:translate-x-[-1px] hover:shadow-[6px_7px_0_#1c1a17] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_#1c1a17] disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]}`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border-2 border-[#1c1a17]/60 bg-[#f2c14e] text-[#1c1a17] sm:h-9 sm:w-9">
        <Icon className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2.4} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-black uppercase tracking-tight sm:text-base">{label}</span>
        {sub && <span className="block truncate text-[11px] font-semibold opacity-70">{sub}</span>}
      </span>
    </button>
  )
}

// drifting protest flyers
const MOTE_COLORS = ['#f2c14e', '#e8e0c8', '#b54a32', '#8c9b6e', '#f5efdc']
const MOTES = Array.from({ length: 14 }, (_, i) => ({
  x: (i * 7.3 + 4) % 100,
  x2: -40 + ((i * 37) % 80),
  s: 5 + ((i * 13) % 7),
  d: 16 + ((i * 7) % 14),
  delay: -(i * 2.7),
  o: 0.25 + ((i * 17) % 30) / 100,
  c: MOTE_COLORS[i % MOTE_COLORS.length],
}))

function DailyCard() {
  const daily = useGameStore((s) => s.daily)
  if (!daily) return null
  const pct = Math.min(100, (daily.progress / Math.max(1, daily.target)) * 100)
  return (
    <div className="rounded-2xl border-2 border-[#1c1a17]/80 bg-gradient-to-b from-[#f2c14e]/45 to-[#f5efdc] p-3 shadow-[4px_4px_0_#1c1a17]">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-[#8c1f28]">
          <CalendarDays className="h-3.5 w-3.5" /> Daily Challenge
        </span>
        {daily.claimed ? (
          <span className="flex items-center gap-1 rounded-full border border-[#2e6e4e] bg-[#2e6e4e] px-2 py-0.5 text-[9px] font-black uppercase text-[#f5efdc]">
            <Check className="h-3 w-3" /> Done
          </span>
        ) : (
          <span className="rounded-full border border-[#1c1a17] bg-[#1c1a17] px-2 py-0.5 text-[9px] font-black uppercase text-[#f2c14e]">
            +{daily.reward} XP
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[11px] font-bold leading-snug text-[#1c1a17]/85">{daily.desc}</p>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full border border-[#1c1a17]/40 bg-[#f5efdc]">
          <div
            className={`h-full transition-[width] duration-700 ${daily.claimed ? 'bg-[#2e6e4e]' : 'bg-[#f2a541]'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[9px] font-black tabular-nums text-[#1c1a17]/60">
          {Math.floor(daily.progress)}/{daily.target}
        </span>
      </div>
      <p className="mt-1 text-[9px] font-semibold uppercase tracking-wider text-[#1c1a17]/45">
        {daily.claimed ? 'Collected. The committee is jealous.' : 'Progress saves after every match.'}
      </p>
    </div>
  )
}

function PlayerCard() {
  const profile = useGameStore((s) => s.profile)
  const profileLoading = useGameStore((s) => s.profileLoading)
  const setProfile = useGameStore((s) => s.setProfile)
  const notify = useGameStore((s) => s.notify)
  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const level = profile ? levelFromXp(profile.xp) : 1
  const base = xpForLevel(level)
  const next = xpForLevel(level + 1)
  const pct = profile ? Math.min(100, Math.max(0, ((profile.xp - base) / Math.max(1, next - base)) * 100)) : 0
  const arch = archetypeById(profile?.archetype ?? 'student')

  const saveName = async () => {
    const clean = nameDraft.trim().slice(0, 20)
    if (!clean || !profile) return
    setSaving(true)
    try {
      const saved = localStorage.getItem('votechor_profile')
      const token = saved ? (JSON.parse(saved) as { token?: string }).token : null
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'x-vc-token': token } : {}) },
        body: JSON.stringify({ name: clean }),
      })
      if (res.ok) {
        const data = (await res.json()) as { profile: typeof profile }
        const updated = { ...profile, ...data.profile }
        setProfile(updated)
        localStorage.setItem('votechor_name', updated.name)
        const stored = localStorage.getItem('votechor_profile')
        if (stored) {
          const parsed = JSON.parse(stored) as { token: string }
          localStorage.setItem('votechor_profile', JSON.stringify({ token: parsed.token, profile: updated }))
        }
        notify(`Name officially changed to ${updated.name}. The committee has been informed.`, 'info')
        setEditing(false)
      } else {
        notify('Rename rejected. Your old name was fine anyway.', 'warning')
      }
    } catch {
      notify('Rename office unreachable. Try again after chai.', 'warning')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="vc-paper w-full max-w-xs rounded-2xl border-2 border-[#1c1a17]/80 p-4 shadow-[5px_5px_0_#1c1a17]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8c1f28]">Protester Card</span>
        <span className="flex items-center gap-1 rounded-full border border-[#1c1a17]/50 bg-[#f2c14e] px-2 py-0.5 text-[10px] font-black uppercase text-[#1c1a17]">
          <Vote className="h-3 w-3" /> Lv {level}
        </span>
      </div>

      {editing ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={nameDraft}
            maxLength={20}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void saveName()}
            placeholder="New name"
            className="w-full rounded-lg border-2 border-[#1c1a17]/70 bg-white/70 px-2 py-1 text-sm font-bold text-[#1c1a17] outline-none focus:border-[#8c1f28]"
          />
          <button
            onClick={() => void saveName()}
            disabled={saving || !nameDraft.trim()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-[#1c1a17]/70 bg-[#2e6e4e] text-[#f5efdc] disabled:opacity-40"
            aria-label="Save name"
          >
            <Check className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => { setNameDraft(profile?.name ?? ''); setEditing(true) }}
          className="group flex w-full items-center gap-1.5 text-left"
          title="Click to rename"
        >
          <span className="truncate text-lg font-black tracking-tight text-[#1c1a17]">
            {profileLoading ? '…' : profile?.name ?? 'Unregistered Protester'}
          </span>
          <Pencil className="h-3.5 w-3.5 shrink-0 text-[#1c1a17]/40 group-hover:text-[#8c1f28]" />
        </button>
      )}

      <div className="mt-2">
        <div className="mb-1 flex justify-between text-[10px] font-bold uppercase tracking-wider text-[#1c1a17]/60">
          <span>XP</span>
          <span>{profile ? `${profile.xp} / ${next}` : '— / —'}</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full border border-[#1c1a17]/60 bg-[#e8e0c8]">
          <motion.div
            className="h-full bg-[#2e6e4e]"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span
          className="h-6 w-6 shrink-0 rounded-full border-2 border-[#1c1a17]/70"
          style={{ background: arch.colors.shirt }}
          title={arch.name}
        />
        <div className="min-w-0">
          <div className="truncate text-xs font-black uppercase tracking-tight text-[#1c1a17]">{arch.name}</div>
          <div className="truncate text-[10px] font-semibold text-[#1c1a17]/60">{arch.perk}</div>
        </div>
      </div>
    </div>
  )
}

function ConnectionChip() {
  const connection = useGameStore((s) => s.hud.connection)
  const map = {
    connected: { icon: Wifi, text: 'Server ok', cls: 'text-[#2e6e4e]' },
    connecting: { icon: Settings, text: 'Waking server…', cls: 'text-[#b07d1e]' },
    offline: { icon: WifiOff, text: 'Offline mode', cls: 'text-[#8c1f28]' },
  } as const
  const M = map[connection]
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${M.cls}`}>
      <M.icon className="h-3 w-3" /> {M.text}
    </span>
  )
}

export default function MainMenu() {
  const menuScreen = useGameStore((s) => s.menuScreen)
  const setMenuScreen = useGameStore((s) => s.setMenuScreen)
  const profileLoading = useGameStore((s) => s.profileLoading)

  const back = () => setMenuScreen('main')

  if (menuScreen === 'customize') return <CharacterSelect onBack={back} />
  if (menuScreen === 'play') return <PlayScreen onBack={back} />

  return (
    <div className="vc-paper pointer-events-auto fixed inset-0 z-30 flex min-h-0 flex-col overflow-hidden">
      {/* subtle protest-poster stripes */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background:repeating-linear-gradient(-35deg,#8c1f28_0_18px,transparent_18px_36px,#2e6e4e_36px_54px,transparent_54px_72px)]" />
      {/* drifting paper motes */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {MOTES.map((m, i) => (
          <span
            key={i}
            className="absolute rounded-[2px]"
            style={{
              left: `${m.x}%`,
              top: '104vh',
              width: m.s,
              height: m.s * 0.72,
              backgroundColor: m.c,
              animation: `vc-mote ${m.d}s linear ${m.delay}s infinite`,
              ['--mote-x' as string]: `${m.x2}px`,
              ['--mote-o' as string]: String(m.o),
            }}
          />
        ))}
      </div>

      {/* Hero */}
      <header className="relative shrink-0 border-b-2 border-[#1c1a17]/80">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 pb-4 pt-6 sm:pt-8">
          <motion.div
            initial={{ y: -24, opacity: 0, rotate: -4 }}
            animate={{ y: 0, opacity: 1, rotate: -3 }}
            transition={{ type: 'spring', stiffness: 160, damping: 14 }}
            className="vc-stamp-texture rounded-lg border-4 border-[#8c1f28] px-3 py-1 sm:px-4"
          >
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#8c1f28] sm:text-xs sm:tracking-[0.25em]">
              The Great Parliament Run
            </span>
          </motion.div>

          <motion.h1
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.08, type: 'spring', stiffness: 140, damping: 12 }}
            className="animate-[vc-wobble_5s_ease-in-out_infinite] text-center text-6xl font-black uppercase leading-none tracking-tight text-[#1c1a17] drop-shadow-[3px_3px_0_#f2c14e] sm:text-8xl"
          >
            Vote<span className="text-[#8c1f28]">Chor</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
            className="max-w-xl text-center text-xs font-bold uppercase tracking-wide text-[#1c1a17]/70 sm:text-sm"
          >
            The votes are missing. The protest is on. Everybody run!
          </motion.p>
        </div>
        <Marquee />
      </header>

      {/* Body */}
      <div className="vc-scroll relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-5xl gap-5 px-4 py-5 sm:py-7 lg:grid-cols-[1fr_300px]">
          {/* Menu grid */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <MenuButton
                icon={Play}
                label="Play Solo"
                sub="One protester vs. the whole committee"
                tone="chili"
                disabled={profileLoading}
                onClick={() => uiActions().startSolo()}
              />
              <MenuButton
                icon={Users}
                label="Play Multiplayer"
                sub="Room codes, squads, shared chaos"
                tone="leaf"
                disabled={profileLoading}
                onClick={() => setMenuScreen('play')}
              />
              <MenuButton
                icon={PersonStanding}
                label="Customize"
                sub="Archetypes, hats, protest signs"
                onClick={() => setMenuScreen('customize')}
              />
              <MenuButton
                icon={BookOpen}
                label="How to Play"
                sub="Controls + mission briefing"
                onClick={() => setMenuScreen('howto')}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MenuButton icon={Trophy} label="Ranks" onClick={() => setMenuScreen('leaderboard')} />
              <MenuButton icon={Medal} label="Medals" onClick={() => setMenuScreen('achievements')} />
              <MenuButton icon={BarChart3} label="Stats" onClick={() => setMenuScreen('stats')} />
              <MenuButton icon={Settings} label="Options" onClick={() => setMenuScreen('settings')} />
            </div>

            <div className="rounded-2xl border-2 border-dashed border-[#1c1a17]/40 bg-[#f2c14e]/30 p-3 text-[11px] font-semibold leading-relaxed text-[#1c1a17]/80 sm:text-xs">
              <span className="font-black uppercase text-[#8c1f28]">Tonight&apos;s mission: </span>
              Someone stole 12 vote tokens and locked them across the city. Sneak past patrols, dodge searchlights,
              raid the Government District and return democracy to its rightful owners — the pigeons get a say too.
            </div>
          </motion.div>

          {/* Player card column */}
          <motion.aside
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.16 }}
            className="space-y-3 lg:justify-self-end"
          >
            <PlayerCard />
            <DailyCard />
            <div className="vc-paper rounded-2xl border-2 border-[#1c1a17]/80 p-3 shadow-[4px_4px_0_#1c1a17]">
              <ConnectionChip />
              <p className="mt-1 text-[10px] font-semibold leading-relaxed text-[#1c1a17]/60">
                Solo runs work fully offline. Multiplayer needs the game server awake — it naps sometimes.
              </p>
            </div>
          </motion.aside>
        </div>
      </div>

      {/* Footer satire disclaimer — mt-auto keeps it pinned on short viewports */}
      <footer className="relative shrink-0 border-t-2 border-[#1c1a17]/80 bg-[#1c1a17] px-4 py-2">
        <p className="mx-auto max-w-5xl text-center text-[10px] font-bold uppercase tracking-wider text-[#f5efdc]/70 sm:text-[11px]">
          VoteChor is a work of satire. All politicians, committees and samosas are fictional.
        </p>
      </footer>

      {/* Sub-screens rendered as dialogs over the menu shell */}
      {menuScreen === 'settings' && <SettingsPanel open onOpenChange={(o) => !o && back()} />}
      {menuScreen === 'howto' && <HowToPlay open onOpenChange={(o) => !o && back()} />}
      {menuScreen === 'leaderboard' && <LeaderboardPanel open onOpenChange={(o) => !o && back()} />}
      {menuScreen === 'achievements' && <AchievementsPanel open onOpenChange={(o) => !o && back()} />}
      {menuScreen === 'stats' && <StatsPanel open onOpenChange={(o) => !o && back()} />}
    </div>
  )
}
