'use client'

// VoteChor Wardrobe — pick an archetype, then kit them out across six equipment
// slots (headgear / face / outfit / footwear / back gear / in-hand) with a live
// WebGL preview of the actual in-game rig. Server stays authoritative on unlocks.
// v112 CARTOON REBUILD: the GLB body roster is retired — every protester renders
// the procedural cartoon rig, so step 3 picks the ARCHETYPE (the character's
// personality + gameplay perks) and the wardrobe does the rest.
import { useEffect, useMemo, useState } from 'react'
import { useGameStore, uiActions, type Profile } from '@/lib/game-store'
import { ARCHETYPES, ACHIEVEMENTS } from '@/game/shared/constants'
import {
  HAT_CATALOG, HAIR_CATALOG, FACE_CATALOG, BUILD_CATALOG, OUTFIT_CATALOG, FOOTWEAR_CATALOG, GEAR_CATALOG, HELD_CATALOG,
  POLICE_OUTFIT_CATALOG, POLICE_HAT_CATALOG,
  SKIN_TONES, unlockLabel, itemsForKind, itemFitsGender, genderDefaultFor,
  type CosmeticItem, type CosmeticKind,
} from '@/lib/cosmetics'
import { ArrowLeft, Check, Dices, Gem, Lock, Save, Shield, Siren, Unlock } from 'lucide-react'
import { motion } from 'framer-motion'
import CharacterPreview, { type PreviewLook } from './CharacterPreview'

interface SlotSpec {
  kind: CosmeticKind
  label: string
  hint: string
  catalog: CosmeticItem[]
}

const SLOTS: SlotSpec[] = [
  { kind: 'hat', label: 'Headgear', hint: 'Caps, cones & crowns', catalog: HAT_CATALOG },
  { kind: 'hair', label: 'Hair', hint: 'Your gender’s own style book', catalog: HAIR_CATALOG },
  { kind: 'face', label: 'Face', hint: 'Beards & battle paint', catalog: FACE_CATALOG },
  { kind: 'build', label: 'Build', hint: 'Body shape & fit', catalog: BUILD_CATALOG },
  { kind: 'outfit', label: 'Outfit', hint: 'Gender-cut fits for the cause', catalog: OUTFIT_CATALOG },
  { kind: 'footwear', label: 'Footwear', hint: 'Gender-fit march gear', catalog: FOOTWEAR_CATALOG },
  { kind: 'gear', label: 'Back Gear', hint: 'Drums, bags & rolls', catalog: GEAR_CATALOG },
  { kind: 'held', label: 'In Hand', hint: 'Signs, flags & bats', catalog: HELD_CATALOG },
]

/** Extra tabs that only appear while the POLICE side is chosen (round 23). */
const POLICE_SLOTS: SlotSpec[] = [
  { kind: 'policeOutfit', label: 'Police Dress', hint: 'Six regulation uniforms', catalog: POLICE_OUTFIT_CATALOG },
  { kind: 'policeHat', label: 'Police Cap', hint: 'Peak, beret & turban', catalog: POLICE_HAT_CATALOG },
]

const DEFAULTS: Record<CosmeticKind, string> = {
  hat: 'none', hair: 'default', face: 'clean', build: 'regular', outfit: 'classic', footwear: 'shoes', gear: 'none', held: 'none',
  policeOutfit: 'khaki', policeHat: 'peak', body: 'classic',
}

export default function CharacterSelect({ onBack }: { onBack: () => void }) {
  const profile = useGameStore((s) => s.profile)
  const setProfile = useGameStore((s) => s.setProfile)
  const notify = useGameStore((s) => s.notify)

  const [archetype, setArchetype] = useState(profile?.archetype ?? 'student')
  const [hat, setHat] = useState(profile?.cosmetics?.hat ?? 'none')
  const [hair, setHair] = useState(profile?.cosmetics?.hair ?? 'default')
  // STEP 1 is the gender tab: it drives the hair/outfit/footwear style books,
  // the rig silhouette and the default wardrobe picks.
  const [gender, setGender] = useState<'male' | 'female'>(() =>
    profile?.cosmetics?.gender === 'male' ? 'male' : 'female')
  const [policeOutfit, setPoliceOutfit] = useState(profile?.cosmetics?.policeOutfit ?? 'khaki')
  const [policeHat, setPoliceHat] = useState(profile?.cosmetics?.policeHat ?? 'peak')
  const [face, setFace] = useState(profile?.cosmetics?.face ?? 'clean')
  const [build, setBuild] = useState(profile?.cosmetics?.build ?? 'regular')
  const [outfit, setOutfit] = useState(profile?.cosmetics?.outfit ?? 'classic')
  const [footwear, setFootwear] = useState(profile?.cosmetics?.footwear ?? 'shoes')
  const [gear, setGear] = useState(profile?.cosmetics?.gear ?? 'none')
  const [held, setHeld] = useState(profile?.cosmetics?.held ?? 'none')
  const [glasses, setGlasses] = useState(profile?.cosmetics?.glasses ?? false)
  const [skinTone, setSkinTone] = useState(profile?.cosmetics?.skinTone ?? '')
  const [signText, setSignText] = useState(profile?.cosmetics?.signText ?? '')
  const [role, setRole] = useState<'protector' | 'police'>(profile?.role === 'police' ? 'police' : 'protector')
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

  // v112 CARTOON migration — profiles saved with a retired GLB body id land back
  // on the classic cartoon rig exactly once, so game + join payload agree.
  useEffect(() => {
    const saved = profile?.cosmetics?.body
    if (!profile || !saved || saved === 'classic') return
    uiActions().updateCosmetics({ body: 'classic' })
    setProfile({ ...profile, cosmetics: { ...profile.cosmetics, body: 'classic' } })
    void persist({ body: 'classic' })
    // run once per mount — profile loads later must not overwrite a user's choice
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
    hat, hair, gender, face, build, outfit, footwear, gear, held, glasses,
    policeOutfit, policeHat,
    ...(skinTone ? { skinTone } : {}),
    signText: signText.slice(0, 24),
  })

  /** `overrides` carry the just-clicked values — React state lags one tick behind, so
   *  posting plain currentLook() would silently save the PREVIOUS look (r23 bugfix). */
  const persist = async (overrides?: Record<string, string | boolean>) => {
    setSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-vc-token': token() ?? '' },
        body: JSON.stringify({ cosmetics: { ...currentLook(), ...overrides } }),
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
      case 'hair': setHair(id); break
      case 'face': setFace(id); break
      case 'build': setBuild(id); break
      case 'outfit': setOutfit(id); break
      case 'footwear': setFootwear(id); break
      case 'gear': setGear(id); break
      case 'held': setHeld(id); break
      case 'policeOutfit': setPoliceOutfit(id); break
      case 'policeHat': setPoliceHat(id); break
    }
    const patch: Partial<Profile['cosmetics']> = {}
    ;(patch as Record<string, string | boolean>)[kind] = id
    uiActions().updateCosmetics(patch)
    if (profile) setProfile({ ...profile, cosmetics: { ...profile.cosmetics, [kind]: id } })
    void persist({ [kind]: id })
  }

  const toggleGlasses = () => {
    const next = !glasses
    setGlasses(next)
    uiActions().updateCosmetics({ glasses: next })
    if (profile) setProfile({ ...profile, cosmetics: { ...profile.cosmetics, glasses: next } })
    void persist({ glasses: next })
  }

  const chooseSkin = (hex: string) => {
    const next = skinTone === hex ? '' : hex
    setSkinTone(next)
    uiActions().updateCosmetics({ skinTone: next })
    if (profile) setProfile({ ...profile, cosmetics: { ...profile.cosmetics, skinTone: next } })
    void persist({ skinTone: next })
  }

  /** Male / female build — task 82: each gender owns a DISTINCT style book, so
   *  switching swaps any hair / outfit / footwear pick that belongs to the other
   *  book for that gender's signature default (one persisted patch). */
  const chooseGender = (next: 'male' | 'female') => {
    if (next === gender) return
    setGender(next)
    const nextHair = itemFitsGender('hair', hair, next) ? hair : genderDefaultFor('hair', next)
    const nextOutfit = itemFitsGender('outfit', outfit, next) ? outfit : genderDefaultFor('outfit', next)
    const nextFootwear = itemFitsGender('footwear', footwear, next) ? footwear : genderDefaultFor('footwear', next)
    if (nextHair !== hair) setHair(nextHair)
    if (nextOutfit !== outfit) setOutfit(nextOutfit)
    if (nextFootwear !== footwear) setFootwear(nextFootwear)
    uiActions().updateCosmetics({ gender: next, hair: nextHair, outfit: nextOutfit, footwear: nextFootwear })
    if (profile) setProfile({ ...profile, cosmetics: { ...profile.cosmetics, gender: next, hair: nextHair, outfit: nextOutfit, footwear: nextFootwear } })
    void persist({ gender: next, hair: nextHair, outfit: nextOutfit, footwear: nextFootwear })
  }

  const chooseArchetype = (id: string) => {
    setArchetype(id)
    uiActions().selectArchetype(id)
    setProfile(profile ? { ...profile, archetype: id } : profile)
    const a = ARCHETYPES.find((x) => x.id === id)
    if (a) notify(`${a.name} energy on — ${a.perk}`, 'squad')
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

  /** Pick a side — persisted on the profile (server) + localStorage (offline fallback). */
  const chooseRole = (next: 'protector' | 'police') => {
    if (next === role) return
    setRole(next)
    setProfile(profile ? { ...profile, role: next } : profile)
    try { localStorage.setItem('votechor_role', next) } catch { /* private browsing */ }
    notify(next === 'police'
      ? 'Badge accepted — you report for duty next match. Keep the lathi polite.'
      : 'Welcome back to the people’s side — the protest missed you.', 'info')
    ;(async () => {
      setSaving(true)
      try {
        await fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-vc-token': token() ?? '' },
          // the API replaces the stored cosmetics object — post the FULL look
          body: JSON.stringify({ role: next, cosmetics: currentLook() }),
        })
      } catch { /* local-only */ } finally { setSaving(false) }
    })()
  }

  const saveSign = () => {
    const text = signText.slice(0, 24)
    setSignText(text)
    uiActions().updateCosmetics({ signText: text })
    if (profile) setProfile({ ...profile, cosmetics: { ...profile.cosmetics, signText: text } })
    void persist({ signText: text })
  }

  const randomize = () => {
    const pickFree = (catalog: CosmeticItem[]) => {
      const pool = catalog.filter(isUnlocked)
      return pool[Math.floor(Math.random() * pool.length)]?.id ?? catalog[0].id
    }
    const rg = gender === 'female' ? 'male' : 'female'
    const rh = pickFree(HAT_CATALOG); setHat(rh)
    // hair / outfit / footwear roll from the NEW gender's own book
    const rhair = pickFree(itemsForKind('hair', rg)); setHair(rhair)
    const rf = pickFree(FACE_CATALOG); setFace(rf)
    const rb = pickFree(BUILD_CATALOG); setBuild(rb)
    const ro = pickFree(itemsForKind('outfit', rg)); setOutfit(ro)
    const rw = pickFree(itemsForKind('footwear', rg)); setFootwear(rw)
    const rgr = pickFree(GEAR_CATALOG); setGear(rgr)
    const rd = pickFree(HELD_CATALOG); setHeld(rd)
    const rpo = pickFree(POLICE_OUTFIT_CATALOG); setPoliceOutfit(rpo)
    const rph = pickFree(POLICE_HAT_CATALOG); setPoliceHat(rph)
    const rs = Math.random() < 0.4
    setGlasses(rs)
    const tone = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)].hex
    setSkinTone(tone)
    setGender(rg)
    uiActions().updateCosmetics({ hat: rh, hair: rhair, gender: rg, face: rf, build: rb, outfit: ro, footwear: rw, gear: rgr, held: rd, policeOutfit: rpo, policeHat: rph, glasses: rs, skinTone: tone })
    if (profile) setProfile({ ...profile, cosmetics: { ...profile.cosmetics, hat: rh, hair: rhair, gender: rg, face: rf, build: rb, outfit: ro, footwear: rw, gear: rgr, held: rd, policeOutfit: rpo, policeHat: rph, glasses: rs, skinTone: tone } })
    void persist({ hat: rh, hair: rhair, gender: rg, face: rf, build: rb, outfit: ro, footwear: rw, gear: rgr, held: rd, policeOutfit: rpo, policeHat: rph, glasses: rs, skinTone: tone })
    notify('Stylist rolled a fresh fit — democracy never looked better', 'squad')
  }

  const police = role === 'police'
  const look: PreviewLook = useMemo(() => ({
    archetype, hat, glasses, face, build, outfit, footwear, gear, held, signText: signText.trim(),
    skinTone: skinTone || undefined,
    gender, hair,
    police,
    policeOutfit, policeHat,
  }), [archetype, hat, glasses, face, build, outfit, footwear, gear, held, signText, skinTone, gender, hair, police, policeOutfit, policeHat])

  const sel = ARCHETYPES.find((a) => a.id === archetype) ?? ARCHETYPES[0]
  const visibleSlots = police ? [...SLOTS, ...POLICE_SLOTS] : SLOTS
  const activeTab = visibleSlots.find((s) => s.kind === tab) ?? visibleSlots[0]
  // hair / outfit / footwear books are gender-specific — the grid shows
  // only the current gender's styles (headgear stays shared by design).
  const activeCatalog = useMemo(
    () => itemsForKind(activeTab.kind, gender),
    [activeTab.kind, gender],
  )
  const slotValues: Record<CosmeticKind, string> = { hat, hair, face, build, outfit, footwear, gear, held, policeOutfit, policeHat, body: 'classic' }
  const equippedCount = visibleSlots.filter((s) => slotValues[s.kind] !== DEFAULTS[s.kind]).length + (glasses ? 1 : 0) + (skinTone ? 1 : 0)

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
          {/* STEP 1: the gender tab — drives the hair/outfit/footwear books and
              the rig silhouette (male vs female cartoon cuts). */}
          <section aria-label="Choose your look">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-black uppercase tracking-widest text-[#1c1a17]">1 · Choose Your Look</h3>
              <span className="text-[10px] font-bold uppercase text-[#1c1a17]/50">male or female — the wardrobe books follow this tab</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['male', 'female'] as const).map((g, gi) => {
                const active = gender === g
                return (
                  <motion.button
                    key={g}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 * gi }}
                    onClick={() => chooseGender(g)}
                    aria-pressed={active}
                    className={`relative rounded-2xl border-2 p-4 text-left transition-all duration-150 ${
                      active
                        ? 'border-[#8c1f28] bg-[#f2c14e]/50 shadow-[5px_5px_0_#8c1f28]'
                        : 'border-[#1c1a17]/70 bg-[#f5efdc] shadow-[4px_4px_0_#1c1a17] hover:-translate-y-0.5 hover:shadow-[5px_6px_0_#1c1a17]'
                    }`}
                  >
                    {active && (
                      <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#1c1a17] bg-[#8c1f28] text-[#f5efdc]">
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                      </span>
                    )}
                    <div className="flex items-center gap-2.5">
                      <span className={`flex h-11 w-11 items-center justify-center rounded-xl border-2 text-lg font-black ${active ? 'border-[#8c1f28] bg-[#8c1f28] text-[#f5efdc]' : 'border-[#1c1a17]/60 bg-[#f2c14e] text-[#1c1a17]'}`}>
                        {g === 'male' ? '♂' : '♀'}
                      </span>
                      <div>
                        <div className="text-base font-black uppercase tracking-tight text-[#1c1a17]">{g === 'male' ? 'Male' : 'Female'}</div>
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#8c1f28]">
                          {g === 'male' ? 'The men’s cut' : 'The women’s cut'}
                        </div>
                      </div>
                      <span className="ml-auto rounded-full border border-[#1c1a17]/30 bg-[#efe6c8]/70 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#1c1a17]/60">
                        cartoon rig
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] font-semibold leading-snug text-[#1c1a17]/75">
                      {g === 'male'
                        ? 'Classic cuts, beards, short styles — the men’s own wardrobe book.'
                        : 'Ponytails, buns, dresses & heels — the women’s own wardrobe book.'}
                    </p>
                  </motion.button>
                )
              })}
            </div>
          </section>

          {/* STEP 2: the side. */}
          <section aria-label="Choose your side">
            <div className="mb-2 flex items-baseline gap-2">
              <h3 className="text-sm font-black uppercase tracking-widest text-[#1c1a17]">2 · Choose Your Side</h3>
              <span className="text-[10px] font-bold uppercase text-[#1c1a17]/50">two badges, one city — saves to your profile</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <motion.button
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                onClick={() => chooseRole('protector')}
                aria-pressed={role === 'protector'}
                className={`relative rounded-2xl border-2 p-4 text-left transition-all duration-150 ${
                  role === 'protector'
                    ? 'border-[#2e6e4e] bg-[#dcebe0] shadow-[5px_5px_0_#2e6e4e]'
                    : 'border-[#1c1a17]/70 bg-[#f5efdc] shadow-[4px_4px_0_#1c1a17] hover:-translate-y-0.5 hover:shadow-[5px_6px_0_#1c1a17]'
                }`}
              >
                {role === 'protector' && (
                  <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#1c1a17] bg-[#2e6e4e] text-[#f5efdc]">
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                )}
                <div className="flex items-center gap-2.5">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl border-2 ${role === 'protector' ? 'border-[#2e6e4e] bg-[#2e6e4e] text-[#f5efdc]' : 'border-[#1c1a17]/60 bg-[#f2c14e] text-[#1c1a17]'}`}>
                    <Shield className="h-5 w-5" strokeWidth={2.4} />
                  </span>
                  <div>
                    <div className="text-base font-black uppercase tracking-tight text-[#1c1a17]">Protector</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#2e6e4e]">The people&apos;s side</div>
                  </div>
                </div>
                <p className="mt-2 text-[11px] font-semibold leading-snug text-[#1c1a17]/75">
                  March with the protest — dodge patrols, recover the stolen votes, rescue squadmates and feed the crowd.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] font-black uppercase tracking-wide">
                  <span className="rounded-full border border-[#2e6e4e]/50 bg-[#2e6e4e]/10 px-2 py-0.5 text-[#2e6e4e]">Recover votes</span>
                  <span className="rounded-full border border-[#2e6e4e]/50 bg-[#2e6e4e]/10 px-2 py-0.5 text-[#2e6e4e]">Rescue squad</span>
                  <span className="rounded-full border border-[#2e6e4e]/50 bg-[#2e6e4e]/10 px-2 py-0.5 text-[#2e6e4e]">Default post</span>
                </div>
              </motion.button>

              <motion.button
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                onClick={() => chooseRole('police')}
                aria-pressed={role === 'police'}
                className={`relative rounded-2xl border-2 p-4 text-left transition-all duration-150 ${
                  role === 'police'
                    ? 'border-[#3d5a80] bg-[#e2ecf5] shadow-[5px_5px_0_#3d5a80]'
                    : 'border-[#1c1a17]/70 bg-[#f5efdc] shadow-[4px_4px_0_#1c1a17] hover:-translate-y-0.5 hover:shadow-[5px_6px_0_#1c1a17]'
                }`}
              >
                {role === 'police' && (
                  <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#1c1a17] bg-[#3d5a80] text-[#f5efdc]">
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                )}
                <div className="flex items-center gap-2.5">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl border-2 ${role === 'police' ? 'border-[#3d5a80] bg-[#3d5a80] text-[#f5efdc]' : 'border-[#1c1a17]/60 bg-[#f2c14e] text-[#1c1a17]'}`}>
                    <Siren className="h-5 w-5" strokeWidth={2.4} />
                  </span>
                  <div>
                    <div className="text-base font-black uppercase tracking-tight text-[#1c1a17]">Police</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#3d5a80]">The committee&apos;s side</div>
                  </div>
                </div>
                <p className="mt-2 text-[11px] font-semibold leading-snug text-[#1c1a17]/75">
                  Wear the khaki &amp; lathi — fellow officers stand down, protesters scatter, and YOU make the arrests (E) up close.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] font-black uppercase tracking-wide">
                  <span className="rounded-full border border-[#3d5a80]/50 bg-[#3d5a80]/10 px-2 py-0.5 text-[#3d5a80]">Arrest powers (E)</span>
                  <span className="rounded-full border border-[#3d5a80]/50 bg-[#3d5a80]/10 px-2 py-0.5 text-[#3d5a80]">Officer immunity</span>
                  <span className="rounded-full border border-[#3d5a80]/50 bg-[#3d5a80]/10 px-2 py-0.5 text-[#3d5a80]">+40 XP / arrest</span>
                </div>
              </motion.button>
            </div>
          </section>

          {/* STEP 3: the character — the ARCHETYPES (personality + gameplay perks).
              Every body renders the same cartoon rig; the archetype decides HOW it
              plays, the wardrobe decides HOW it looks. */}
          <section aria-label="Characters">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-black uppercase tracking-widest text-[#1c1a17]">3 · Choose Your Character</h3>
              <span className="text-[10px] font-bold uppercase text-[#1c1a17]/50">
                {gender === 'male' ? '♂ male cut' : '♀ female cut'} · {police ? '🚓 police side' : '🛡 protector side'} · perks ride every outfit
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {ARCHETYPES.map((a, i) => {
                const active = a.id === archetype
                return (
                  <motion.button
                    key={a.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3) }}
                    onClick={() => chooseArchetype(a.id)}
                    aria-pressed={active}
                    title={a.perk}
                    className={`relative rounded-2xl border-2 p-2.5 text-left transition-all duration-150 ${
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
                    <div className="flex items-center gap-2">
                      <span className="h-6 w-6 shrink-0 rounded-full border-2 border-[#1c1a17]/40" style={{ background: a.colors.shirt }} />
                      <span className="text-xs font-black uppercase leading-tight tracking-tight text-[#1c1a17]">{a.name}</span>
                      <Gem className="ml-auto h-3 w-3 shrink-0 text-[#2e6e4e]" />
                    </div>
                    <div className="mt-1.5 text-[10px] font-semibold leading-snug text-[#1c1a17]/65">
                      {a.perk}
                    </div>
                  </motion.button>
                )
              })}
            </div>
          </section>

          {/* Wardrobe: live 3D preview + tabbed slots */}
          <section aria-label="Wardrobe" className="rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc] p-4 shadow-[4px_4px_0_#1c1a17]">
            <div className="mb-3 flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-black uppercase tracking-widest text-[#1c1a17]">
                {police ? '4 · Dress The Officer' : '4 · Dress The Protester'}
              </h3>
              <span className="text-[10px] font-bold uppercase text-[#1c1a17]/50">drag the figure to spin</span>
              {police && (
                <span className="rounded-full border-2 border-[#3d5a80]/60 bg-[#e2ecf5] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#3d5a80]">
                  🚓 police wardrobe active — uniform &amp; cap tabs below
                </span>
              )}
            </div>
            <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
              {/* Preview + build + skin tones */}
              <div className="space-y-3">
                <div className="vc-dots overflow-hidden rounded-xl border-2 border-[#1c1a17]/50 bg-gradient-to-b from-[#cfe0e8] to-[#efe6c8]">
                  <CharacterPreview look={look} className="h-[300px] w-full" />
                </div>
                <div className="rounded-xl border-2 border-dashed border-[#1c1a17]/30 bg-[#efe6c8]/40 px-3 py-2">
                  <span className="block text-[10px] font-black uppercase tracking-wide text-[#1c1a17]/60">
                    {police
                      ? '🚓 Police side: pick your regulation dress + cap in the tabs below'
                      : 'Everything you style here renders on your protester in-game'}
                  </span>
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
                  {visibleSlots.map((s) => {
                    const value = slotValues[s.kind]
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
                            : s.kind === 'policeOutfit' || s.kind === 'policeHat'
                              ? 'border-[#3d5a80]/60 bg-[#e2ecf5] text-[#3d5a80] shadow-[2px_2px_0_#3d5a80]/40 hover:-translate-y-0.5'
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
                      {activeCatalog.filter(isUnlocked).length}/{activeCatalog.length} unlocked
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                    {activeCatalog.map((item) => {
                      const unlocked = isUnlocked(item)
                      const value = slotValues[item.kind]
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
