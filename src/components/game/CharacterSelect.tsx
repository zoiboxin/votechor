'use client'

import { useEffect, useState } from 'react'
import { useGameStore, uiActions } from '@/lib/game-store'
import { ARCHETYPES, ACHIEVEMENTS } from '@/game/shared/constants'
import { HAT_CATALOG, unlockLabel, type CosmeticItem } from '@/lib/cosmetics'
import { ArrowLeft, Check, Glasses, Gem, Save, Signpost, Lock, Unlock } from 'lucide-react'
import { motion } from 'framer-motion'
import type { Archetype } from '@/game/shared/types'

const HATS = HAT_CATALOG

function cssPreview(a: Archetype, hat: string, glasses: boolean) {
  return (
    <div className="relative mx-auto flex h-24 w-24 items-end justify-center overflow-hidden rounded-xl border-2 border-[#1c1a17]/60"
      style={{ background: `linear-gradient(180deg, ${a.colors.accent}55 0%, ${a.colors.shirt}33 100%)` }}>
      {/* legs */}
      <div className="absolute bottom-0 flex gap-1.5">
        <div className="h-5 w-3.5 rounded-b-md" style={{ background: a.colors.pants }} />
        <div className="h-5 w-3.5 rounded-b-md" style={{ background: a.colors.pants }} />
      </div>
      {/* torso */}
      <div className="absolute bottom-4 h-10 w-11 rounded-t-lg border border-[#1c1a17]/40" style={{ background: a.colors.shirt }}>
        <div className="absolute left-1/2 top-1.5 h-4 w-1.5 -translate-x-1/2 rounded" style={{ background: a.colors.accent }} />
      </div>
      {/* garland (around neck) */}
      {hat === 'garland' && (
        <>
          <div className="absolute bottom-[4.1rem] left-1/2 h-4 w-12 -translate-x-1/2 rounded-full border-[3px] border-[#f2a541] bg-transparent" style={{ transform: 'translateX(-50%) rotate(8deg)' }} />
          <div className="absolute bottom-[4.35rem] left-1/2 flex -translate-x-1/2 gap-0.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-1.5 w-1.5 rounded-full" style={{ background: i % 2 ? '#e8912c' : '#f2a541' }} />
            ))}
          </div>
        </>
      )}
      {/* head */}
      <div className="absolute bottom-[3.75rem] h-9 w-9 rounded-full border-2 border-[#1c1a17]/50" style={{ background: a.colors.skin }}>
        <div className="absolute inset-x-0 top-0 h-2.5 rounded-t-full" style={{ background: a.colors.hair }} />
        {glasses && (
          <div className="absolute left-1/2 top-2.5 flex -translate-x-1/2 gap-0.5">
            <div className="h-2 w-2.5 rounded-sm border border-[#1c1a17] bg-black/20" />
            <div className="h-2 w-2.5 rounded-sm border border-[#1c1a17] bg-black/20" />
          </div>
        )}
        {hat === 'cap' && <div className="absolute -top-1.5 left-0 h-2 w-6 rounded-t-md" style={{ background: a.colors.accent }} />}
        {hat === 'topi' && <div className="absolute -top-3 left-1/2 h-4 w-6 -translate-x-1/2 rounded-t-full" style={{ background: '#f5efdc' }} />}
        {hat === 'cone' && (
          <div className="absolute -top-7 left-1/2 flex -translate-x-1/2 flex-col items-center">
            <div className="h-0 w-0 border-x-[7px] border-b-[14px] border-x-transparent border-b-[#e8641c]" />
            <div className="absolute top-1.5 h-1 w-2.5 bg-[#f5efdc]" />
            <div className="h-1 w-5 rounded-sm bg-[#c8500f]" />
          </div>
        )}
        {hat === 'crown' && (
          <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
            <div className="flex items-end gap-px">
              {[5, 7, 9, 7, 5].map((h, i) => (
                <div key={i} className="w-1 rounded-t-sm bg-[#d4a017]" style={{ height: h }} />
              ))}
            </div>
            <div className="h-1.5 w-6 rounded-b-sm bg-[#d4a017]">
              <div className="mx-auto mt-px h-1 w-1 rounded-full bg-[#8c1f28]" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function CharacterSelect({ onBack }: { onBack: () => void }) {
  const profile = useGameStore((s) => s.profile)
  const setProfile = useGameStore((s) => s.setProfile)
  const notify = useGameStore((s) => s.notify)

  const [selected, setSelected] = useState(profile?.archetype ?? 'student')
  const [hat, setHat] = useState(profile?.cosmetics?.hat ?? 'none')
  const [glasses, setGlasses] = useState(profile?.cosmetics?.glasses ?? false)
  const [signText, setSignText] = useState(profile?.cosmetics?.signText ?? '')
  const [saving, setSaving] = useState(false)
  const [unlockedCodes, setUnlockedCodes] = useState<Set<string>>(new Set())
  const [hoveredHat, setHoveredHat] = useState<string | null>(null)

  // fetch granted achievements → cosmetic unlocks (server remains authoritative on save)
  // re-fetches on mount, on window focus, and every 15s so mid-session unlocks appear live
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const raw = localStorage.getItem('votechor_profile')
        const token = raw ? (JSON.parse(raw) as { token?: string }).token : undefined
        if (!token) return
        const res = await fetch('/api/achievements', { headers: { 'x-vc-token': token } })
        if (!res.ok) return
        const data = (await res.json()) as { unlocked?: string[] }
        if (!cancelled && Array.isArray(data.unlocked)) setUnlockedCodes(new Set(data.unlocked))
      } catch { /* offline — defaults stay unlocked */ }
    }
    void load()
    window.addEventListener('focus', load)
    const iv = setInterval(load, 15000)
    return () => {
      cancelled = true
      window.removeEventListener('focus', load)
      clearInterval(iv)
    }
  }, [])

  const level = profile?.level ?? 1
  const isHatUnlocked = (item: CosmeticItem) => {
    if (item.unlock.type === 'free') return true
    if (item.unlock.type === 'level') return level >= item.unlock.level
    return unlockedCodes.has(item.unlock.code)
  }
  const achName = (code: string) => ACHIEVEMENTS.find((a) => a.id === code)?.name ?? code.replaceAll('_', ' ')

  const token = () => {
    try {
      const raw = localStorage.getItem('votechor_profile')
      return raw ? (JSON.parse(raw) as { token?: string }).token ?? null : null
    } catch {
      return null
    }
  }

  const persist = async (patch: { archetype?: string; cosmetics?: { hat?: string; glasses?: boolean; signText?: string } }) => {
    setSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-vc-token': token() ?? '' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) notify('Wardrobe department did not answer. Changes kept locally.', 'warning')
    } catch {
      notify('Saved locally. The server will hear about this later.', 'warning')
    } finally {
      setSaving(false)
    }
  }

  const chooseArchetype = (id: string) => {
    setSelected(id)
    uiActions().selectArchetype(id)
    setProfile(profile ? { ...profile, archetype: id } : profile)
    void persist({ archetype: id })
  }

  const chooseHat = (id: string) => {
    const item = HAT_CATALOG.find((h) => h.id === id)
    if (item && !isHatUnlocked(item)) {
      notify(`Locked: ${item.label} — ${unlockLabel(item)}`, 'warning')
      return
    }
    setHat(id)
    uiActions().updateCosmetics({ hat: id })
    if (profile) setProfile({ ...profile, cosmetics: { ...profile.cosmetics, hat: id } })
    void persist({ cosmetics: { hat: id } })
  }

  const toggleGlasses = () => {
    const next = !glasses
    setGlasses(next)
    uiActions().updateCosmetics({ glasses: next })
    if (profile) setProfile({ ...profile, cosmetics: { ...profile.cosmetics, glasses: next } })
    void persist({ cosmetics: { glasses: next } })
  }

  const saveSign = () => {
    const text = signText.slice(0, 24)
    setSignText(text)
    uiActions().updateCosmetics({ signText: text })
    if (profile) setProfile({ ...profile, cosmetics: { ...profile.cosmetics, signText: text } })
    void persist({ cosmetics: { signText: text } })
  }

  const sel = ARCHETYPES.find((a) => a.id === selected) ?? ARCHETYPES[0]

  return (
    <div className="vc-paper pointer-events-auto fixed inset-0 z-30 flex flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background:repeating-linear-gradient(-35deg,#2e6e4e_0_18px,transparent_18px_36px)]" />

      <header className="relative flex shrink-0 items-center gap-3 border-b-2 border-[#1c1a17]/80 bg-[#f2a541]/60 px-4 py-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-xl border-2 border-[#1c1a17]/80 bg-[#f5efdc] px-3 py-1.5 text-xs font-black uppercase tracking-tight text-[#1c1a17] shadow-[3px_3px_0_#1c1a17] transition-all hover:-translate-y-0.5 hover:shadow-[4px_5px_0_#1c1a17] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_#1c1a17]"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h2 className="text-xl font-black uppercase tracking-tight text-[#1c1a17] sm:text-2xl">Pick Your Protester</h2>
        {saving && <Save className="h-4 w-4 animate-pulse text-[#8c1f28]" />}
      </header>

      <div className="vc-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-5 px-4 py-5">
          {/* Archetype grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ARCHETYPES.map((a, i) => {
              const active = a.id === selected
              return (
                <motion.button
                  key={a.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => chooseArchetype(a.id)}
                  className={`relative rounded-2xl border-2 p-3 text-left transition-all duration-150 ${
                    active
                      ? 'border-[#8c1f28] bg-[#f2c14e]/40 shadow-[5px_5px_0_#8c1f28]'
                      : 'border-[#1c1a17]/70 bg-[#f5efdc] shadow-[4px_4px_0_#1c1a17] hover:-translate-y-0.5 hover:shadow-[5px_6px_0_#1c1a17]'
                  }`}
                >
                  {active && (
                    <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#1c1a17] bg-[#2e6e4e] text-[#f5efdc]">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                  )}
                  {cssPreview(a, a.id === selected ? hat : 'none', a.id === selected && glasses)}
                  <div className="mt-2 text-sm font-black uppercase tracking-tight text-[#1c1a17]">{a.name}</div>
                  <div className="mt-0.5 text-[11px] font-semibold leading-snug text-[#1c1a17]/70">{a.desc}</div>
                  <div className="mt-2 flex items-start gap-1 rounded-lg bg-[#2e6e4e]/15 px-2 py-1 text-[10px] font-bold text-[#2e6e4e]">
                    <Gem className="mt-0.5 h-3 w-3 shrink-0" /> {a.perk}
                  </div>
                  <div className="mt-2 flex gap-1">
                    {(['shirt', 'pants', 'skin', 'hair', 'accent'] as const).map((k) => (
                      <span key={k} className="h-3.5 w-3.5 rounded-full border border-[#1c1a17]/50" style={{ background: a.colors[k] }} />
                    ))}
                  </div>
                </motion.button>
              )
            })}
          </div>

          {/* Cosmetics */}
          <div className="grid gap-4 rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc] p-4 shadow-[4px_4px_0_#1c1a17] lg:grid-cols-[220px_1fr_1fr]">
            <div className="vc-dots rounded-xl border-2 border-[#1c1a17]/50 p-3">
              <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#8c1f28]">Live Preview</div>
              {cssPreview(sel, hat, glasses)}
              <div className="mt-2 text-center text-[11px] font-bold uppercase text-[#1c1a17]/70">{sel.name}</div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-black uppercase tracking-wider text-[#1c1a17]">Headgear Locker</div>
                <div className="text-[10px] font-bold uppercase text-[#1c1a17]/50">
                  {HATS.filter(isHatUnlocked).length}/{HATS.length} unlocked
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {HATS.map((h) => {
                  const unlocked = isHatUnlocked(h)
                  const active = hat === h.id
                  const criteria =
                    h.unlock.type === 'level' ? `LEVEL ${h.unlock.level}` :
                    h.unlock.type === 'achievement' ? achName(h.unlock.code).toUpperCase() : ''
                  return (
                    <button
                      key={h.id}
                      onClick={() => chooseHat(h.id)}
                      onMouseEnter={() => setHoveredHat(h.id)}
                      onMouseLeave={() => setHoveredHat(null)}
                      onFocus={() => setHoveredHat(h.id)}
                      onBlur={() => setHoveredHat(null)}
                      aria-label={`${h.label}${unlocked ? '' : ` (locked — ${unlockLabel(h)})`}`}
                      className={`relative rounded-xl border-2 p-2 text-left transition-all duration-150 ${
                        active
                          ? 'border-[#8c1f28] bg-[#f2c14e] shadow-[3px_3px_0_#8c1f28]'
                          : unlocked
                            ? 'border-[#1c1a17]/60 bg-[#f5efdc] shadow-[2px_2px_0_#1c1a17]/40 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_#1c1a17]/60'
                            : 'border-dashed border-[#1c1a17]/40 bg-[#efe6c8]/60 opacity-80 hover:opacity-100'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`text-base leading-none ${unlocked ? '' : 'grayscale'}`}>{h.emoji}</span>
                        <span className={`text-[10px] font-black uppercase leading-tight tracking-tight ${unlocked ? 'text-[#1c1a17]' : 'text-[#1c1a17]/55'}`}>
                          {h.label}
                        </span>
                      </div>
                      <div className="mt-1 min-h-[22px]">
                        {unlocked ? (
                          <span className="flex items-center gap-1 text-[9px] font-bold uppercase text-[#2e6e4e]">
                            <Unlock className="h-2.5 w-2.5" /> Equippable
                          </span>
                        ) : hoveredHat === h.id ? (
                          <span className="block text-[9px] font-bold uppercase leading-tight text-[#8c1f28]">
                            {unlockLabel(h)}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[9px] font-bold uppercase text-[#1c1a17]/45">
                            <Lock className="h-2.5 w-2.5" /> {criteria}
                          </span>
                        )}
                      </div>
                      {!unlocked && (
                        <span className="absolute right-1.5 top-1.5 text-[#8c1f28]/70">
                          <Lock className="h-3 w-3" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              <button
                onClick={toggleGlasses}
                className={`mt-2 flex w-full items-center gap-2 rounded-xl border-2 px-3 py-2 text-xs font-black uppercase tracking-tight transition-all ${
                  glasses
                    ? 'border-[#2e6e4e] bg-[#2e6e4e] text-[#f5efdc] shadow-[3px_3px_0_#1c1a17]'
                    : 'border-[#1c1a17]/60 bg-[#f5efdc] text-[#1c1a17]/70 shadow-[2px_2px_0_#1c1a17]/40'
                }`}
              >
                <Glasses className="h-4 w-4" /> {glasses ? 'Specs ON — intellectual look' : 'Specs OFF'}
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[#1c1a17]">
                <Signpost className="h-4 w-4 text-[#8c1f28]" /> Protest Sign Slogan
              </div>
              <input
                value={signText}
                maxLength={24}
                placeholder="e.g. CHAI > COMMITTEES"
                onChange={(e) => setSignText(e.target.value)}
                onBlur={saveSign}
                onKeyDown={(e) => e.key === 'Enter' && saveSign()}
                className="w-full rounded-xl border-2 border-[#1c1a17]/70 bg-white/70 px-3 py-2 text-sm font-black uppercase tracking-tight text-[#1c1a17] outline-none focus:border-[#8c1f28]"
              />
              <div className="flex justify-between text-[10px] font-bold text-[#1c1a17]/50">
                <span>Shown on your cardboard sign in-game</span>
                <span>{signText.length}/24</span>
              </div>
              <div className="mt-1 flex h-16 items-center justify-center rounded-lg border-2 border-dashed border-[#8c1f28]/50 bg-[#efe6c8]">
                <span className="rotate-[-2deg] text-sm font-black uppercase tracking-tight text-[#8c1f28]">
                  {signText || 'YOUR SLOGAN HERE'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
