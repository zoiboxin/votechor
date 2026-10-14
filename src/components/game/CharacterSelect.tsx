'use client'

// VoteChor Wardrobe — pick an archetype, then kit them out across six equipment
// slots (headgear / face / outfit / footwear / back gear / in-hand) with a live
// WebGL preview of the actual in-game rig. Server stays authoritative on unlocks.
import { useEffect, useMemo, useState } from 'react'
import { useGameStore, uiActions } from '@/lib/game-store'
import { ARCHETYPES, ACHIEVEMENTS } from '@/game/shared/constants'
import {
  HAT_CATALOG, FACE_CATALOG, OUTFIT_CATALOG, FOOTWEAR_CATALOG, GEAR_CATALOG, HELD_CATALOG,
  SKIN_TONES, WARDROBE_KINDS, unlockLabel, anyItemIsUnlocked, type CosmeticItem, type CosmeticKind,
} from '@/lib/cosmetics'
import { ArrowLeft, Check, Dices, Gem, Lock, Save, Unlock } from 'lucide-react'
import { motion } from 'framer-motion'
import CharacterPreview, { type PreviewLook } from './CharacterPreview'
import type { Archetype } from '@/game/shared/types'

interface SlotSpec {
  kind: CosmeticKind
  label: string
  hint: string
  catalog: CosmeticItem[]
}

const SLOTS: SlotSpec[] = [
  { kind: 'hat', label: 'Headgear', hint: 'Caps, cones & crowns', catalog: HAT_CATALOG },
  { kind: 'face', label: 'Face', hint: 'Beards & battle paint', catalog: FACE_CATALOG },
  { kind: 'outfit', label: 'Outfit', hint: 'Dress for the cause', catalog: OUTFIT_CATALOG },
  { kind: 'footwear', label: 'Footwear', hint: 'March in style', catalog: FOOTWEAR_CATALOG },
  { kind: 'gear', label: 'Back Gear', hint: 'Drums, bags & rolls', catalog: GEAR_CATALOG },
  { kind: 'held', label: 'In Hand', hint: 'Signs, flags & bats', catalog: HELD_CATALOG },
]

const DEFAULTS: Record<CosmeticKind, string> = {
  hat: 'none', face: 'clean', outfit: 'classic', footwear: 'shoes', gear: 'none', held: 'none',
}

function cssMiniPreview(a: Archetype) {
  return (
    <div className="relative mx-auto flex h-24 w-24 items-end justify-center overflow-hidden rounded-xl border-2 border-[#1c1a17]/60"
      style={{ background: `linear-gradient(180deg, ${a.colors.accent}55 0%, ${a.colors.shirt}33 100%)` }}>
      <div className="absolute bottom-0 flex gap-1.5">
        <div className="h-5 w-3.5 rounded-b-md" style={{ background: a.colors.pants }} />
        <div className="h-5 w-3.5 rounded-b-md" style={{ background: a.colors.pants }} />
      </div>
      <div className="absolute bottom-4 h-10 w-11 rounded-t-lg border border-[#1c1a17]/40" style={{ background: a.colors.shirt }}>
        <div className="absolute left-1/2 top-1.5 h-4 w-1.5 -translate-x-1/2 rounded" style={{ background: a.colors.accent }} />
      </div>
      <div className="absolute bottom-[3.75rem] h-9 w-9 rounded-full border-2 border-[#1c1a17]/50" style={{ background: a.colors.skin }}>
        <div className="absolute inset-x-0 top-0 h-2.5 rounded-t-full" style={{ background: a.colors.hair }} />
      </div>
    </div>
  )
}

export default function CharacterSelect({ onBack }: { onBack: () => void }) {
  const profile = useGameStore((s) => s.profile)
  const setProfile = useGameStore((s) => s.setProfile)
  const notify = useGameStore((s) => s.notify)

  const [archetype, setArchetype] = useState(profile?.archetype ?? 'student')
  const [hat, setHat] = useState(profile?.cosmetics?.hat ?? 'none')
  const [face, setFace] = useState(profile?.cosmetics?.face ?? 'clean')
  const [outfit, setOutfit] = useState(profile?.cosmetics?.outfit ?? 'classic')
  const [footwear, setFootwear] = useState(profile?.cosmetics?.footwear ?? 'shoes')
  const [gear, setGear] = useState(profile?.cosmetics?.gear ?? 'none')
  const [held, setHeld] = useState(profile?.cosmetics?.held ?? 'none')
  const [glasses, setGlasses] = useState(profile?.cosmetics?.glasses ?? false)
  const [skinTone, setSkinTone] = useState(profile?.cosmetics?.skinTone ?? '')
  const [signText, setSignText] = useState(profile?.cosmetics?.signText ?? '')
  const [saving, setSaving] = useState(false)
  const [unlockedCodes, setUnlockedCodes] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<CosmeticKind>('hat')
  const [hovered, setHovered] = useState<string | null>(null)

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
  const achName = (code: string) => ACHIEVEMENTS.find((a) => a.id === code)?.name ?? code.replaceAll('_', ' ')

  const isUnlocked = (item: CosmeticItem) => {
    if (item.unlock.type === 'free') return true
    if (item.unlock.type === 'level') return level >= item.unlock.level
    return unlockedCodes.has(item.unlock.code)
  }

  const token = () => {
    try {
      const raw = localStorage.getItem('votechor_profile')
      return raw ? (JSON.parse(raw) as { token?: string }).token ?? null : null
    } catch {
      return null
    }
  }

  // NOTE: the API REPLACES the stored cosmetics object — always persist the FULL look.
  const currentLook = () => ({
    hat, face, outfit, footwear, gear, held, glasses,
    ...(skinTone ? { skinTone } : {}),
    signText: signText.slice(0, 24),
  })

  const persist = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-vc-token': token() ?? '' },
        body: JSON.stringify({ cosmetics: currentLook() }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        notify(data.error ? `Wardrobe rejected: ${data.error}` : 'Wardrobe department did not answer. Changes kept locally.', 'warning')
      }
    } catch {
      notify('Saved locally. The server will hear about this later.', 'warning')
    } finally {
      setSaving(false)
    }
  }

  const setSlot = (kind: CosmeticKind, id: string, item?: CosmeticItem) => {
    if (item && !isUnlocked(item)) {
      notify(`Locked: ${item.label} — ${unlockLabel(item)}`, 'warning')
      return
    }
    switch (kind) {
      case 'hat': setHat(id); break
      case 'face': setFace(id); break
      case 'outfit': setOutfit(id); break
      case 'footwear': setFootwear(id); break
      case 'gear': setGear(id); break
      case 'held': setHeld(id); break
    }
    uiActions().updateCosmetics({ [kind]: id })
    if (profile) setProfile({ ...profile, cosmetics: { ...profile.cosmetics, [kind]: id } })
    void persist()
  }

  const toggleGlasses = () => {
    const next = !glasses
    setGlasses(next)
    uiActions().updateCosmetics({ glasses: next })
    if (profile) setProfile({ ...profile, cosmetics: { ...profile.cosmetics, glasses: next } })
    void persist()
  }

  const chooseSkin = (hex: string) => {
    const next = skinTone === hex ? '' : hex
    setSkinTone(next)
    uiActions().updateCosmetics({ skinTone: next })
    if (profile) setProfile({ ...profile, cosmetics: { ...profile.cosmetics, skinTone: next } })
    void persist()
  }

  const chooseArchetype = (id: string) => {
    setArchetype(id)
    uiActions().selectArchetype(id)
    setProfile(profile ? { ...profile, archetype: id } : profile)
    // archetype is a separate API field
    ;(async () => {
      setSaving(true)
      try {
        await fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-vc-token': token() ?? '' },
          body: JSON.stringify({ archetype: id, cosmetics: currentLook() }),
        })
      } catch { /* local-only */ } finally { setSaving(false) }
    })()
  }

  const saveSign = () => {
    const text = signText.slice(0, 24)
    setSignText(text)
    uiActions().updateCosmetics({ signText: text })
    if (profile) setProfile({ ...profile, cosmetics: { ...profile.cosmetics, signText: text } })
    void persist()
  }

  const randomize = () => {
    const pickFree = (catalog: CosmeticItem[]) => {
      const pool = catalog.filter(isUnlocked)
      return pool[Math.floor(Math.random() * pool.length)]?.id ?? catalog[0].id
    }
    const rh = pickFree(HAT_CATALOG); setHat(rh)
    const rf = pickFree(FACE_CATALOG); setFace(rf)
    const ro = pickFree(OUTFIT_CATALOG); setOutfit(ro)
    const rw = pickFree(FOOTWEAR_CATALOG); setFootwear(rw)
    const rg = pickFree(GEAR_CATALOG); setGear(rg)
    const rd = pickFree(HELD_CATALOG); setHeld(rd)
    const rs = Math.random() < 0.4
    setGlasses(rs)
    const tone = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)].hex
    setSkinTone(tone)
    uiActions().updateCosmetics({ hat: rh, face: rf, outfit: ro, footwear: rw, gear: rg, held: rd, glasses: rs, skinTone: tone })
    if (profile) setProfile({ ...profile, cosmetics: { ...profile.cosmetics, hat: rh, face: rf, outfit: ro, footwear: rw, gear: rg, held: rd, glasses: rs, skinTone: tone } })
    void persist()
    notify('Stylist rolled a fresh fit — democracy never looked better', 'squad')
  }

  const look: PreviewLook = useMemo(() => ({
    archetype, hat, glasses, face, outfit, footwear, gear, held, signText: signText.trim(),
    skinTone: skinTone || undefined,
  }), [archetype, hat, glasses, face, outfit, footwear, gear, held, signText, skinTone])

  const sel = ARCHETYPES.find((a) => a.id === archetype) ?? ARCHETYPES[0]
  const activeTab = SLOTS.find((s) => s.kind === tab) ?? SLOTS[0]
  const equippedCount = WARDROBE_KINDS.filter((k) => {
    const v = { hat, face, outfit, footwear, gear, held }[k]
    return v !== DEFAULTS[k]
  }).length + (glasses ? 1 : 0) + (skinTone ? 1 : 0)

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
        <h2 className="text-xl font-black uppercase tracking-tight text-[#1c1a17] sm:text-2xl">Protester Wardrobe</h2>
        <span className="hidden rounded-full border-2 border-[#1c1a17]/60 bg-[#f5efdc]/80 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#1c1a17]/70 sm:inline">
          {equippedCount} equipped
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={randomize}
            className="flex items-center gap-1.5 rounded-xl border-2 border-[#1c1a17]/80 bg-[#2e6e4e] px-3 py-1.5 text-xs font-black uppercase tracking-tight text-[#f5efdc] shadow-[3px_3px_0_#1c1a17] transition-all hover:-translate-y-0.5 hover:shadow-[4px_5px_0_#1c1a17] active:translate-x-[1px] active:translate-y-[1px]"
          >
            <Dices className="h-4 w-4" /> Surprise Fit
          </button>
          {saving && <Save className="h-4 w-4 animate-pulse text-[#8c1f28]" />}
        </div>
      </header>

      <div className="vc-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-5 px-4 py-5">
          {/* Archetype grid */}
          <section aria-label="Characters">
            <div className="mb-2 flex items-baseline gap-2">
              <h3 className="text-sm font-black uppercase tracking-widest text-[#1c1a17]">1 · Choose Your Character</h3>
              <span className="text-[10px] font-bold uppercase text-[#1c1a17]/50">{ARCHETYPES.length} rebels with quirks</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ARCHETYPES.map((a, i) => {
                const active = a.id === archetype
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
                    {cssMiniPreview(a)}
                    <div className="mt-2 text-sm font-black uppercase tracking-tight text-[#1c1a17]">{a.name}</div>
                    <div className="mt-0.5 text-[11px] font-semibold leading-snug text-[#1c1a17]/70">{a.desc}</div>
                    <div className="mt-2 flex items-start gap-1 rounded-lg bg-[#2e6e4e]/15 px-2 py-1 text-[10px] font-bold text-[#2e6e4e]">
                      <Gem className="mt-0.5 h-3 w-3 shrink-0" /> {a.perk}
                    </div>
                  </motion.button>
                )
              })}
            </div>
          </section>

          {/* Wardrobe: live 3D preview + tabbed slots */}
          <section aria-label="Wardrobe" className="rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc] p-4 shadow-[4px_4px_0_#1c1a17]">
            <div className="mb-3 flex items-baseline gap-2">
              <h3 className="text-sm font-black uppercase tracking-widest text-[#1c1a17]">2 · Dress The Protester</h3>
              <span className="text-[10px] font-bold uppercase text-[#1c1a17]/50">drag the figure to spin</span>
            </div>
            <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
              {/* Preview + skin tones */}
              <div className="space-y-3">
                <div className="vc-dots overflow-hidden rounded-xl border-2 border-[#1c1a17]/50 bg-gradient-to-b from-[#cfe0e8] to-[#efe6c8]">
                  <CharacterPreview look={look} className="h-[300px] w-full" />
                </div>
                <div className="rounded-xl border-2 border-[#1c1a17]/50 p-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8c1f28]">Skin Tone</span>
                    {skinTone && <span className="text-[9px] font-bold uppercase text-[#1c1a17]/50">{SKIN_TONES.find((t) => t.hex === skinTone)?.label}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {SKIN_TONES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => chooseSkin(t.hex)}
                        title={t.label}
                        aria-label={`Skin tone ${t.label}`}
                        className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${skinTone === t.hex ? 'border-[#8c1f28] ring-2 ring-[#f2c14e]' : 'border-[#1c1a17]/40'}`}
                        style={{ background: t.hex }}
                      />
                    ))}
                  </div>
                  <div className="mt-2 text-center text-[11px] font-bold uppercase text-[#1c1a17]/70">{sel.name}</div>
                </div>
                <button
                  onClick={toggleGlasses}
                  className={`flex w-full items-center justify-center gap-2 rounded-xl border-2 px-3 py-2 text-xs font-black uppercase tracking-tight transition-all ${
                    glasses
                      ? 'border-[#2e6e4e] bg-[#2e6e4e] text-[#f5efdc] shadow-[3px_3px_0_#1c1a17]'
                      : 'border-[#1c1a17]/60 bg-[#f5efdc] text-[#1c1a17]/70 shadow-[2px_2px_0_#1c1a17]/40'
                  }`}
                >
                  {glasses ? 'Specs ON — intellectual look' : 'Specs OFF'}
                </button>
              </div>

              {/* Tabs + item grid + slogan */}
              <div className="space-y-3">
                <div role="tablist" aria-label="Wardrobe slots" className="flex flex-wrap gap-1.5">
                  {SLOTS.map((s) => {
                    const value = { hat, face, outfit, footwear, gear, held }[s.kind]
                    const isDefault = value === DEFAULTS[s.kind]
                    return (
                      <button
                        key={s.kind}
                        role="tab"
                        aria-selected={tab === s.kind}
                        onClick={() => setTab(s.kind)}
                        className={`rounded-xl border-2 px-3 py-1.5 text-[11px] font-black uppercase tracking-tight transition-all ${
                          tab === s.kind
                            ? 'border-[#8c1f28] bg-[#f2c14e] text-[#1c1a17] shadow-[3px_3px_0_#8c1f28]'
                            : 'border-[#1c1a17]/50 bg-[#f5efdc] text-[#1c1a17]/70 shadow-[2px_2px_0_#1c1a17]/30 hover:-translate-y-0.5'
                        }`}
                      >
                        {s.label}
                        {!isDefault && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[#2e6e4e]" />}
                      </button>
                    )
                  })}
                </div>

                <div className="min-h-[190px] rounded-xl border-2 border-[#1c1a17]/40 p-3">
                  <div className="mb-2 flex items-baseline justify-between">
                    <div>
                      <span className="text-xs font-black uppercase tracking-wider text-[#1c1a17]">{activeTab.label}</span>
                      <span className="ml-2 text-[10px] font-bold uppercase text-[#1c1a17]/45">{activeTab.hint}</span>
                    </div>
                    <span className="text-[10px] font-bold uppercase text-[#1c1a17]/50">
                      {activeTab.catalog.filter(isUnlocked).length}/{activeTab.catalog.length} unlocked
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                    {activeTab.catalog.map((item) => {
                      const unlocked = isUnlocked(item)
                      const value = { hat, face, outfit, footwear, gear, held }[item.kind]
                      const active = value === item.id
                      const criteria =
                        item.unlock.type === 'level' ? `LEVEL ${item.unlock.level}` :
                        item.unlock.type === 'achievement' ? achName(item.unlock.code).toUpperCase() : ''
                      return (
                        <button
                          key={item.id}
                          onClick={() => setSlot(item.kind as CosmeticKind, item.id, item)}
                          onMouseEnter={() => setHovered(item.id)}
                          onMouseLeave={() => setHovered(null)}
                          onFocus={() => setHovered(item.id)}
                          onBlur={() => setHovered(null)}
                          aria-label={`${item.label}${unlocked ? '' : ` (locked — ${unlockLabel(item)})`}`}
                          className={`relative rounded-xl border-2 p-2 text-left transition-all duration-150 ${
                            active
                              ? 'border-[#8c1f28] bg-[#f2c14e] shadow-[3px_3px_0_#8c1f28]'
                              : unlocked
                                ? 'border-[#1c1a17]/60 bg-white/60 shadow-[2px_2px_0_#1c1a17]/40 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_#1c1a17]/60'
                                : 'border-dashed border-[#1c1a17]/40 bg-[#efe6c8]/60 opacity-80 hover:opacity-100'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`text-base leading-none ${unlocked ? '' : 'grayscale'}`}>{item.emoji}</span>
                            <span className={`text-[10px] font-black uppercase leading-tight tracking-tight ${unlocked ? 'text-[#1c1a17]' : 'text-[#1c1a17]/55'}`}>
                              {item.label}
                            </span>
                          </div>
                          <div className="mt-0.5 line-clamp-1 text-[9px] font-semibold text-[#1c1a17]/50">{item.desc}</div>
                          <div className="mt-1 min-h-[16px]">
                            {unlocked ? (
                              <span className="flex items-center gap-1 text-[9px] font-bold uppercase text-[#2e6e4e]">
                                <Unlock className="h-2.5 w-2.5" /> {active ? 'Equipped' : 'Equippable'}
                              </span>
                            ) : hovered === item.id ? (
                              <span className="block text-[9px] font-bold uppercase leading-tight text-[#8c1f28]">
                                {unlockLabel(item)}
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
                </div>

                {/* Slogan (drives the sign + banner) */}
                <div className="rounded-xl border-2 border-[#1c1a17]/40 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[#1c1a17]">
                    Protest Slogan
                    <span className="font-bold normal-case text-[#1c1a17]/45">— shown on the sign &amp; banner</span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={signText}
                      maxLength={24}
                      placeholder="e.g. CHAI > COMMITTEES"
                      onChange={(e) => setSignText(e.target.value)}
                      onBlur={saveSign}
                      onKeyDown={(e) => e.key === 'Enter' && saveSign()}
                      className="min-w-0 flex-1 rounded-xl border-2 border-[#1c1a17]/70 bg-white/70 px-3 py-2 text-sm font-black uppercase tracking-tight text-[#1c1a17] outline-none focus:border-[#8c1f28]"
                    />
                    <button
                      onClick={saveSign}
                      className="shrink-0 rounded-xl border-2 border-[#1c1a17]/80 bg-[#f2c14e] px-3 py-2 text-xs font-black uppercase tracking-tight text-[#1c1a17] shadow-[2px_2px_0_#1c1a17] transition-all hover:-translate-y-0.5"
                    >
                      Paint It
                    </button>
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] font-bold text-[#1c1a17]/50">
                    <span>Equip “Protest Sign” or “Cloth Banner” in In&nbsp;Hand to carry it</span>
                    <span>{signText.length}/24</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
