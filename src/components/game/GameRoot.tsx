'use client'

import { useEffect, useRef } from 'react'
import { useGameStore, type Profile } from '@/lib/game-store'
import { Loader2, Vote } from 'lucide-react'
import { motion } from 'framer-motion'
import MainMenu from './MainMenu'
import Hud from './Hud'
import Compass from './Compass'
import CinematicOverlay from './CinematicOverlay'
import BossBar from './BossBar'
import NotificationStack from './NotificationStack'
import EmoteWheel from './EmoteWheel'
import QuickMessages from './QuickMessages'
import PauseMenu from './PauseMenu'
import EndScreen from './EndScreen'
import TouchControls from './TouchControls'
import BigMap from './BigMap'
import SquadPanel from './SquadPanel'
import ReconnectOverlay from './ReconnectOverlay'
import PhotoHud from './PhotoHud'

// Global one-shot guards (StrictMode double-mount safe)
let engineBooted = false
let profileBootstrapped = false

const LOADING_TIPS = [
  'Tip: throw a bottle (Q) to distract patrols. The bottle made a heroic sacrifice.',
  'Tip: hold Shift to sprint. Stamina is a social construct, but still limited.',
  'Tip: chai restores stamina. Sip responsibly, run irresponsibly.',
  'Tip: press G for emotes. Democracy loves a good dance break.',
  'Tip: press M for the big map. Cartography is not a crime. Yet.',
  'Tip: revive detained teammates by holding E. Bribes optional.',
  'Tip: searchlights are shy. Slide (C) under them.',
  'Tip: the committee does not exist. The paperwork does.',
]

function pickTip(i: number) {
  return LOADING_TIPS[i % LOADING_TIPS.length]
}

function LoadingScreen() {
  const uiMode = useGameStore((s) => s.uiMode)
  const idx = Math.floor(Date.now() / 4000) % LOADING_TIPS.length
  return (
    <div className="vc-paper pointer-events-auto fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 overflow-hidden">
      <div className="absolute inset-0 opacity-[0.06] [background:repeating-linear-gradient(45deg,#1c1a17_0_2px,transparent_2px_14px)]" />
      <motion.div
        initial={{ scale: 0.6, rotate: -10, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 14 }}
        className="relative flex h-24 w-24 items-center justify-center rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f2a541] shadow-[6px_6px_0_#1c1a17]"
      >
        <Vote className="h-12 w-12 text-[#1c1a17]" strokeWidth={2.4} />
      </motion.div>
      <h1 className="text-center font-black uppercase tracking-tight text-[#1c1a17]">
        <span className="block text-3xl sm:text-4xl">Democracy is loading…</span>
        <span className="mt-1 block text-sm font-bold text-[#8c1f28]">
          {uiMode === 'loading' ? 'Warming up the protest…' : 'Counting the votes we are about to steal back…'}
        </span>
      </h1>
      <div className="flex items-center gap-2 text-[#1c1a17]/70">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="max-w-md px-4 text-center text-xs font-semibold sm:text-sm">{pickTip(idx)}</span>
      </div>
      <div className="mt-2 h-3 w-64 overflow-hidden rounded-full border-2 border-[#1c1a17]/80 bg-[#f5efdc]">
        <motion.div
          className="h-full bg-[#2e6e4e]"
          initial={{ width: '5%' }}
          animate={{ width: ['5%', '92%', '78%', '99%'] }}
          transition={{ duration: 2.6, times: [0, 0.5, 0.8, 1], ease: 'easeInOut' }}
        />
      </div>
    </div>
  )
}

export default function GameRoot() {
  const minimapBufferRef = useRef<HTMLCanvasElement>(null)
  const uiMode = useGameStore((s) => s.uiMode)
  const photoMode = useGameStore((s) => s.photoMode)

  useEffect(() => {
    const st = useGameStore.getState()

    // ---- hydrate persisted settings BEFORE engine boot ----
    try {
      const rawSettings = localStorage.getItem('votechor_settings')
      if (rawSettings) st.setSettings(JSON.parse(rawSettings))
    } catch {
      /* corrupt settings are ignored, defaults win */
    }

    // ---- profile bootstrap ----
    if (!profileBootstrapped) {
      profileBootstrapped = true
      void (async () => {
        try {
          const saved = localStorage.getItem('votechor_profile')
          let token: string | null = null
          if (saved) {
            const parsed = JSON.parse(saved) as { token?: string; profile?: Profile }
            token = parsed?.token ?? null
            if (parsed?.profile) {
              st.setProfile(parsed.profile)
              st.setProfileLoading(false)
            }
          }
          // re-read FRESH store state — `st` is a stale snapshot once setProfile ran
          if (!useGameStore.getState().profile) {
            const fallbackName = localStorage.getItem('votechor_name') || `Protester_${Math.floor(1000 + Math.random() * 9000)}`
            const res = await fetch('/api/profile', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: fallbackName }),
            })
            if (res.ok) {
              const data = (await res.json()) as { token: string; profile: Parameters<typeof st.setProfile>[0] }
              if (data?.profile) {
                localStorage.setItem('votechor_profile', JSON.stringify({ token: data.token, profile: data.profile }))
                localStorage.setItem('votechor_name', data.profile.name)
                st.setProfile(data.profile)
                token = data.token
              }
            } else {
              st.notify('The profile office is closed for lunch. You protest as an unregistered citizen.', 'warning')
            }
          } else if (token) {
            // stored profile exists — refresh it from the server (XP/unlocks may have changed on another device)
            try {
              const rres = await fetch('/api/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-vc-token': token },
                body: JSON.stringify({}),
              })
              if (rres.ok) {
                const data = (await rres.json()) as { token: string; profile: Parameters<typeof st.setProfile>[0] }
                if (data?.profile) {
                  localStorage.setItem('votechor_profile', JSON.stringify({ token: data.token, profile: data.profile }))
                  st.setProfile(data.profile)
                }
              }
            } catch { /* offline — cached profile stays */ }
          }
          // ---- daily challenge fetch ----
          if (token) {
            try {
              const dres = await fetch('/api/daily', { headers: { 'x-vc-token': token } })
              if (dres.ok) {
                const d = (await dres.json()) as { challenge: { kind: string; desc: string; target: number; reward: number }; progress: number; claimed: boolean }
                st.setDaily({ kind: d.challenge.kind, desc: d.challenge.desc, target: d.challenge.target, reward: d.challenge.reward, progress: d.progress, claimed: d.claimed })
              }
            } catch { /* daily is optional sugar */ }
          }
        } catch {
          st.notify('Profile registry unreachable. Offline protesters still count.', 'warning')
        } finally {
          st.setProfileLoading(false)
        }
      })()
    }

    // ---- dynamic engine boot (keeps three.js out of the UI bundle) ----
    if (!engineBooted) {
      engineBooted = true
      void import('@/game/game').then(({ getGame }) => {
        const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null
        const buffer = minimapBufferRef.current
        if (canvas && buffer) void getGame().boot(canvas, buffer)
      })
    }
  }, [])

  const inMatch = uiMode === 'playing' || uiMode === 'paused'
  const photoActive = inMatch && photoMode && uiMode === 'playing'

  return (
    <>
      {/* Global poster-style utilities + keyframes shared by all game UI */}
      <style>{`
        @keyframes vc-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes vc-orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes vc-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
        @keyframes vc-stamp-in { 0% { transform: scale(2.4) rotate(-8deg); opacity: 0; } 55% { transform: scale(0.94) rotate(-8deg); opacity: 1; } 100% { transform: scale(1) rotate(-8deg); opacity: 1; } }
        @keyframes vc-wobble { 0%, 100% { transform: rotate(-1.2deg); } 50% { transform: rotate(1.2deg); } }
        @keyframes vc-ping-ring { 0% { transform: scale(0.8); opacity: 0.8; } 100% { transform: scale(1.6); opacity: 0; } }
        @keyframes vc-grain { 0% { transform: translate(0, 0); } 25% { transform: translate(-4%, 3%); } 50% { transform: translate(3%, -4%); } 75% { transform: translate(-3%, -2%); } 100% { transform: translate(0, 0); } }
        @keyframes vc-mote { 0% { transform: translateY(0) translateX(0) rotate(0deg); opacity: 0; } 8% { opacity: var(--mote-o, 0.5); } 92% { opacity: var(--mote-o, 0.5); } 100% { transform: translateY(-110vh) translateX(var(--mote-x, 30px)) rotate(300deg); opacity: 0; } }
        @keyframes vc-march { from { transform: translateX(-60px); } to { transform: translateX(100vw); } }
        @keyframes vc-march-bob { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-3px) rotate(2deg); } }
        @keyframes vc-shine { 0% { transform: translateX(-120%) skewX(-18deg); } 100% { transform: translateX(240%) skewX(-18deg); } }
        @keyframes vc-zonetint { 0% { opacity: 0; } 14% { opacity: 1; } 100% { opacity: 0; } }
        .vc-scroll::-webkit-scrollbar { width: 10px; }
        .vc-scroll::-webkit-scrollbar-track { background: rgba(28,26,23,0.08); border-radius: 8px; }
        .vc-scroll::-webkit-scrollbar-thumb { background: #8c1f28; border-radius: 8px; border: 2px solid #f5efdc; }
        .vc-scroll { scrollbar-width: thin; scrollbar-color: #8c1f28 #e8e0c8; }
        .vc-paper {
          background-color: #f5efdc;
          background-image:
            repeating-linear-gradient(0deg, rgba(28,26,23,0.028) 0px, rgba(28,26,23,0.028) 1px, transparent 1px, transparent 3px),
            repeating-linear-gradient(90deg, rgba(28,26,23,0.02) 0px, rgba(28,26,23,0.02) 1px, transparent 1px, transparent 4px);
        }
        .vc-stamp-texture { box-shadow: inset 0 0 0 2px rgba(140,31,40,0.35), inset 0 0 18px rgba(140,31,40,0.25), 4px 4px 0 rgba(28,26,23,0.85); }
        .vc-dots { background-image: radial-gradient(rgba(28,26,23,0.14) 1px, transparent 1px); background-size: 12px 12px; }
      `}</style>

      {/* 3D viewport */}
      <canvas id="game-canvas" className="fixed inset-0 z-0 block h-full w-full" />
      {/* Minimap buffer — drawn by the engine, copied by Hud/BigMap */}
      <canvas ref={minimapBufferRef} width={140} height={420} className="hidden" />

      {/* Menu + its sub-screens */}
      {uiMode === 'menu' && <MainMenu />}

      {/* Boot / match loading */}
      {(uiMode === 'boot' || uiMode === 'loading') && <LoadingScreen />}

      {/* In-match HUD (kept mounted while paused so the world stays readable behind the menu)
          — hidden entirely during photo mode, which gets its own viewfinder overlay */}
      {inMatch && !photoActive && (
        <>
          <Hud minimapBuffer={minimapBufferRef} />
          <Compass />
          <CinematicOverlay />
          <BossBar />
          <SquadPanel />
          <BigMap minimapBuffer={minimapBufferRef} />
          <EmoteWheel />
          <QuickMessages />
          <ReconnectOverlay />
          {uiMode === 'playing' && <TouchControls />}
        </>
      )}

      {photoActive && <PhotoHud />}

      {uiMode === 'paused' && <PauseMenu />}
      {uiMode === 'ended' && <EndScreen />}

      {/* Toasts work in every mode */}
      <NotificationStack />
    </>
  )
}
