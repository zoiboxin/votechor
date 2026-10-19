'use client'

import { useEffect, useRef, useState } from 'react'
import { useGameStore, type EnvHud, type PerfHud } from '@/lib/game-store'
import { uiActions, ZONE_ACCENTS, MINIMAP_MIN_ZOOM, MINIMAP_MAX_ZOOM } from '@/lib/game-store'
import { VC_BUILD } from '@/lib/build-version'
import { vcIsTouchDevice } from '@/lib/touch'
import { ITEM_CONFIG, CAPTURE_MESSAGES } from '@/game/shared/constants'
import {
  Heart, Zap, Vote, Users, Wifi, WifiOff, Map as MapIcon, MapPin, Hand, Star,
  Clock, Package, Footprints, Gauge, Siren, Megaphone, Bot as BotIcon, Gavel,
  Sun, Moon, Sunrise, Sunset, CloudSun, Cloud, CloudRain, CloudLightning, CloudFog, Activity, GitBranch, Copy, MessageSquare, Check, ChevronDown,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import CoordChip from './CoordChip'

function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const CONNECTION_STYLE = {
  connected: { label: 'Connected', dot: 'bg-[#4e9b6e]', icon: Wifi, cls: 'text-[#2e6e4e]' },
  connecting: { label: 'Connecting', dot: 'bg-[#e0a63a] animate-pulse', icon: Wifi, cls: 'text-[#b07d1e]' },
  offline: { label: 'Offline', dot: 'bg-[#c9482e]', icon: WifiOff, cls: 'text-[#8c1f28]' },
} as const

function StatBar({ value, max, color, icon: Icon }: { value: number; max: number; color: string; icon: typeof Heart }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))
  const low = pct < 30
  return (
    <div className="flex items-center gap-1.5">
      <span className={`flex h-5 w-5 items-center justify-center rounded-md border border-[#1c1a17]/70 bg-[#1c1a17] ${low ? 'animate-pulse' : ''}`}>
        <Icon className="h-3 w-3 text-[#f5efdc]" />
      </span>
      <div className={`h-3.5 w-36 overflow-hidden rounded-full border-2 border-[#1c1a17]/80 bg-[#1c1a17]/30 ${low ? 'animate-[vc-blink_0.8s_ease-in-out_infinite]' : ''}`}>
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${low ? 'animate-pulse' : ''}`}
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className={`w-8 text-right text-[10px] font-black tabular-nums ${low ? 'text-[#c9482e]' : 'text-[#1c1a17]'}`}>{Math.round(value)}</span>
    </div>
  )
}

function InventorySlot({ uid, type, index }: { uid: string; type: string; index: number }) {
  const cfg = ITEM_CONFIG[type as keyof typeof ITEM_CONFIG]
  return (
    <button
      onClick={() => uiActions().useItem(uid)}
      onContextMenu={(e) => { e.preventDefault(); uiActions().dropItem(uid) }}
      title={`${cfg?.name ?? type} — click to use, right-click to drop`}
      className="group pointer-events-auto relative flex h-11 w-11 items-center justify-center rounded-xl border-2 border-[#1c1a17]/80 bg-[#f5efdc]/95 shadow-[3px_3px_0_rgba(28,26,23,0.8)] transition-all hover:-translate-y-0.5 hover:bg-[#f2c14e] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_rgba(28,26,23,0.8)] sm:h-12 sm:w-12"
    >
      <span className="text-xl leading-none sm:text-2xl">{cfg?.icon ?? '📦'}</span>
      <span className="absolute -left-1 -top-1.5 flex h-4 w-4 items-center justify-center rounded-md border border-[#1c1a17]/80 bg-[#1c1a17] text-[9px] font-black text-[#f2c14e]">
        {index + 1}
      </span>
      <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-[#1c1a17]/70 bg-[#1c1a17] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#f5efdc] group-hover:block">
        {cfg?.name ?? type}
      </span>
    </button>
  )
}

function SquadRow({ m, inCell }: { m: { id: string; name: string; health: number; detained: boolean; dazed: boolean }; inCell: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border bg-[#f5efdc]/90 px-2 py-1 ${
        inCell ? 'border-[#2e6e4e] shadow-[0_0_0_1px_rgba(46,110,78,0.35)]' : 'border-[#1c1a17]/60'
      }`}
    >
      <span className="min-w-0 flex-1 truncate text-[10px] font-black uppercase tracking-tight text-[#1c1a17]">{m.name}</span>
      {inCell && (
        <span className="rounded border border-[#2e6e4e] bg-[#2e6e4e] px-1 text-[8px] font-black uppercase text-[#f5efdc]">Cell</span>
      )}
      {m.detained ? (
        <span className="rounded border border-[#8c1f28] bg-[#8c1f28] px-1 text-[8px] font-black uppercase text-[#f5efdc]">Detained</span>
      ) : m.dazed ? (
        <span className="rounded border border-[#b07d1e] bg-[#f2c14e] px-1 text-[8px] font-black uppercase text-[#1c1a17]">Dazed</span>
      ) : (
        <div className="h-1.5 w-12 overflow-hidden rounded-full border border-[#1c1a17]/60 bg-[#1c1a17]/20">
          <div className={`h-full ${inCell ? 'bg-[#2e6e4e]' : 'bg-[#4e9b6e]'}`} style={{ width: `${Math.max(0, Math.min(100, m.health))}%` }} />
        </div>
      )}
    </div>
  )
}

function DetainedOverlay() {
  const detainRemain = useGameStore((s) => s.hud.detainRemain)
  const spectating = useGameStore((s) => s.hud.spectating)
  // fresh random message every time this overlay mounts (i.e. every new detention)
  const [message] = useState(() => CAPTURE_MESSAGES[Math.floor(Math.random() * CAPTURE_MESSAGES.length)])
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 ${spectating ? 'bg-[#8c1f28]/12' : 'bg-[#8c1f28]/30 backdrop-blur-[2px]'}`}
    >
      <div className="absolute inset-0 shadow-[inset_0_0_120px_rgba(140,31,40,0.45)]" />
      <div className={`animate-[vc-stamp-in_0.4s_ease-out] rounded-xl border-4 border-red-600 bg-red-600/10 px-8 py-3 font-black uppercase tracking-tight text-red-600 shadow-[0_0_0_2px_rgba(255,255,255,0.4)_inset,6px_6px_0_rgba(28,26,23,0.5)] ${spectating ? 'text-4xl sm:text-5xl' : 'text-5xl sm:text-7xl'}`}
        style={{ textShadow: '2px 2px 0 rgba(28,26,23,0.35)' }}>
        DETAINED
      </div>
      {!spectating && (
        <p className="max-w-md px-6 text-center text-sm font-bold uppercase tracking-wide text-[#1c1a17] drop-shadow-[1px_1px_0_#f5efdc] sm:text-base">
          {message}
        </p>
      )}
      {spectating ? (
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border-2 border-[#4ecdc4] bg-[#1c1a17]/85 px-4 py-1.5 text-xs font-black uppercase tracking-tight text-[#4ecdc4] shadow-[3px_3px_0_rgba(28,26,23,0.6)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4ecdc4] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#4ecdc4]" />
            </span>
            SPECTATING {spectating}
          </div>
          <span className="rounded-full bg-[#1c1a17]/70 px-3 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#f5efdc]/85">
            The revolution continues through them
          </span>
        </div>
      ) : null}
      <div className="rounded-full border-2 border-[#1c1a17]/80 bg-[#1c1a17] px-4 py-1.5 text-sm font-black tabular-nums text-[#f2c14e]">
        Release in {Math.ceil(detainRemain)}s — paperwork is being stamped
      </div>
    </motion.div>
  )
}

function DazedOverlay() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#f2c14e]/10"
    >
      <div className="flex flex-col items-center gap-2">
        <div className="relative h-20 w-20 animate-[vc-orbit_2.2s_linear_infinite]">
          {[0, 72, 144, 216, 288].map((deg) => (
            <Star
              key={deg}
              className="absolute left-1/2 top-1/2 h-5 w-5 fill-[#f2c14e] text-[#1c1a17]"
              style={{ transform: `rotate(${deg}deg) translateY(-30px)` }}
            />
          ))}
        </div>
        <span className="rounded-full border-2 border-[#1c1a17]/70 bg-[#f5efdc]/90 px-3 py-1 text-xs font-black uppercase tracking-widest text-[#1c1a17]">
          Recovering… the ground is moving
        </span>
      </div>
    </motion.div>
  )
}

const TIME_ICONS = { sun: Sun, sunrise: Sunrise, sunset: Sunset, moon: Moon } as const
const WEATHER_ICONS = {
  clear: CloudSun, cloudy: Cloud, overcast: Cloud, rain: CloudRain, storm: CloudLightning, fog: CloudFog,
} as const

function EnvChip({ env, compact }: { env: EnvHud; compact?: boolean }) {
  const TimeIcon = TIME_ICONS[env.icon]
  const WIcon = WEATHER_ICONS[env.wIcon]
  // v46 — compact (touch): one row keeps the top-right stack short enough that it
  // can never run into the touch action pad on landscape phones
  if (compact) {
    return (
      <div className="pointer-events-auto flex w-40 items-center gap-1.5 rounded-xl border-2 border-[#1c1a17]/80 bg-[#f5efdc]/92 px-2 py-1 shadow-[3px_3px_0_rgba(28,26,23,0.75)] backdrop-blur-sm">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[#1c1a17]/70 bg-[#1c1a17]">
          <TimeIcon className="h-2.5 w-2.5 text-[#f2c14e]" />
        </span>
        <span className="text-[10px] font-black tabular-nums text-[#1c1a17]">{env.time}</span>
        <span className="min-w-0 flex-1 truncate text-[9px] font-black uppercase tracking-wider text-[#8c1f28]">{env.phase}</span>
        <WIcon className="h-3.5 w-3.5 shrink-0 text-[#1c1a17]/70" />
      </div>
    )
  }
  return (
    /* v46 — w-40 on phones (the top-right stack shares its column with the touch
       action pad); full w-56 from sm up */
    <div className="pointer-events-auto w-40 overflow-hidden rounded-xl border-2 border-[#1c1a17]/80 bg-[#f5efdc]/92 shadow-[3px_3px_0_rgba(28,26,23,0.75)] backdrop-blur-sm sm:w-56">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[#1c1a17]/70 bg-[#1c1a17]">
          <TimeIcon className="h-2.5 w-2.5 text-[#f2c14e]" />
        </span>
        <span className="text-[10px] font-black tabular-nums text-[#1c1a17]">{env.time}</span>
        <span className="truncate text-[9px] font-black uppercase tracking-wider text-[#8c1f28]">{env.phase}</span>
      </div>
      <div className="flex items-center gap-1.5 border-t border-[#1c1a17]/15 bg-[#1c1a17]/5 px-2 py-0.5">
        <WIcon className="h-3 w-3 shrink-0 text-[#1c1a17]/70" />
        <span className="truncate text-[8.5px] font-black uppercase tracking-wide text-[#1c1a17]/75">{env.weather}</span>
      </div>
    </div>
  )
}

/** Perf chip — FPS · frame time · draw calls · triangles · net · crowd vs rigs · RES · build tag (1Hz, change-gated).
 *  v46 — compact single-row on touch: the wide sm:w-56 version reaches into the
 *  landscape action-pad's x-band and covered the Interact button. */
function PerfChip({ perf, compact }: { perf: PerfHud; compact?: boolean }) {
  const kbps = perf.kbps >= 10 ? `${Math.round(perf.kbps)}` : perf.kbps.toFixed(1)
  if (compact) {
    return (
      <div className="flex w-40 items-center gap-1.5 overflow-hidden rounded-xl border-2 border-[#1c1a17]/80 bg-[#f5efdc]/92 px-2 py-1 shadow-[3px_3px_0_rgba(28,26,23,0.75)] backdrop-blur-sm">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[#1c1a17]/70 bg-[#1c1a17]">
          <Activity className="h-2.5 w-2.5 text-[#4e9b6e]" />
        </span>
        <span className="text-[9px] font-black tabular-nums text-[#1c1a17]">{perf.fps}fps</span>
        <span className="min-w-0 flex-1 truncate text-[8px] font-black tabular-nums uppercase text-[#1c1a17]/60">
          {perf.drawCalls}dc · {perf.trisK}K
        </span>
        <span className="shrink-0 rounded bg-[#1c1a17]/10 px-1 text-[7.5px] font-black uppercase text-[#1c1a17]/60">{VC_BUILD}</span>
        {perf.gl !== 'ok' && (
          <span title={perf.glMsg || 'Graphics fault'} className={`shrink-0 animate-pulse rounded px-1 text-[7.5px] font-black uppercase text-white ${perf.gl === 'lost' ? 'bg-[#c9482e]' : 'bg-[#e2b714] text-[#1c1a17]'}`}>
            {perf.gl === 'lost' ? 'GL LOST' : 'GL ERR'}
          </span>
        )}
      </div>
    )
  }
  return (
    <div className="w-40 overflow-hidden rounded-xl border-2 border-[#1c1a17]/80 bg-[#f5efdc]/92 shadow-[3px_3px_0_rgba(28,26,23,0.75)] backdrop-blur-sm sm:w-56">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[#1c1a17]/70 bg-[#1c1a17]">
          <Activity className="h-2.5 w-2.5 text-[#4e9b6e]" />
        </span>
        <span className="text-[10px] font-black tabular-nums text-[#1c1a17]">{perf.fps} FPS</span>
        <span className="ml-auto rounded bg-[#1c1a17]/10 px-1 text-[8px] font-black uppercase tracking-wide text-[#1c1a17]/60" title="Client build — report this tag when a bug persists after refreshing">
          {VC_BUILD}
        </span>
        <span className="text-[9px] font-black tabular-nums text-[#1c1a17]/55">{perf.frameMs.toFixed(0)}ms</span>
        <span className="ml-auto text-[9px] font-black tabular-nums text-[#1c1a17]/60">RES {perf.res}</span>
      </div>
      <div className="flex items-center gap-1.5 border-t border-[#1c1a17]/15 bg-[#1c1a17]/5 px-2 py-0.5">
        <GitBranch className="h-3 w-3 shrink-0 text-[#1c1a17]/70" />
        <span className="truncate text-[8.5px] font-black tabular-nums uppercase tracking-wide text-[#1c1a17]/75">
          {perf.drawCalls} dc · {perf.trisK}K tris · {kbps}K/S
        </span>
      </div>
      <div className="flex items-center gap-1.5 border-t border-[#1c1a17]/15 bg-[#1c1a17]/5 px-2 py-0.5">
        <Users className="h-3 w-3 shrink-0 text-[#1c1a17]/70" />
        <span className="truncate text-[8.5px] font-black uppercase tracking-wide text-[#1c1a17]/75">
          {perf.crowd} crowd · {perf.rigs} rigs
        </span>
        {perf.gl !== 'ok' && (
          <span
            title={perf.glMsg || 'Graphics fault'}
            className={`ml-auto shrink-0 animate-pulse rounded px-1 text-[8px] font-black uppercase text-white ${
              perf.gl === 'lost' ? 'bg-[#c9482e]' : 'bg-[#e2b714] text-[#1c1a17]'
            }`}
          >
            {perf.gl === 'lost' ? 'GL LOST' : 'GL ERR'}
          </span>
        )}
      </div>
    </div>
  )
}

export default function Hud() {
  const hud = useGameStore((s) => s.hud)
  const settings = useGameStore((s) => s.settings)
  const fps = useGameStore((s) => s.fps)
  const squadOpen = useGameStore((s) => s.squadOpen)
  const squad = useGameStore((s) => s.squad)
  const season = useGameStore((s) => s.season)
  const toggleMap = useGameStore((s) => s.toggleMap)
  const toggleSquad = useGameStore((s) => s.toggleSquad)
  const [isTouch] = useState(() => vcIsTouchDevice())
  const minimapRef = useRef<HTMLCanvasElement>(null)
  const minimapBoxRef = useRef<HTMLDivElement>(null)
  const [zoneVisible, setZoneVisible] = useState(true)
  const [now, setNow] = useState(Date.now())
  const flashAt = useGameStore((s) => s.hud.env.flashAt)
  const [flash, setFlash] = useState(false)

  // lightning flash overlay — re-fires on every new flashAt stamp
  useEffect(() => {
    if (!flashAt) return
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 340)
    return () => clearTimeout(t)
  }, [flashAt])

  // the engine draws the zoomed, player-following minimap straight into the visible strip
  useEffect(() => {
    uiActions().setHudMinimap(minimapRef.current)
    return () => uiActions().setHudMinimap(null)
  }, [])

  // mouse-wheel over the radar adjusts the minimap zoom (clamped + persisted via the
  // same setSettings + localStorage('votechor_settings') contract the big map uses)
  useEffect(() => {
    const el = minimapBoxRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const st = useGameStore.getState()
      const cur = st.settings.minimapZoom ?? 150
      const next = Math.max(MINIMAP_MIN_ZOOM, Math.min(MINIMAP_MAX_ZOOM, Math.round((cur + (e.deltaY > 0 ? 12 : -12)) / 2) * 2))
      if (next === cur) return
      st.setSettings({ minimapZoom: next })
      try {
        localStorage.setItem('votechor_settings', JSON.stringify({ ...st.settings, minimapZoom: next, keybinds: { ...st.settings.keybinds } }))
      } catch {
        /* private browsing — lives for this session only */
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // zone banner fades out after a change
  useEffect(() => {
    setZoneVisible(true)
    const t = setTimeout(() => setZoneVisible(false), 2800)
    return () => clearTimeout(t)
  }, [hud.zoneName])

  // cheap clock for time-limited buffs
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  const conn = CONNECTION_STYLE[hud.connection]
  const speedLeft = Math.max(0, Math.ceil((hud.speedBoostUntil - now) / 1000))
  const lowHealth = hud.health / Math.max(1, hud.maxHealth) < 0.3

  return (
    /* v46 — z-[35]: above TouchControls' drag-to-look layer (z-30). The look layer
       spans the whole right half of the screen, so at z-20 it silently swallowed
       every tap on right-side HUD elements (minimap → big map, the collapsed
       squad chip, perf/env chips). The HUD root itself is pointer-events-none —
       only the chips capture events — so look-dragging on empty space still works. */
    <div className="pointer-events-none fixed inset-0 z-[35] select-none font-sans">
      {/* low-health vignette */}
      {lowHealth && !hud.detained && (
        <div className="absolute inset-0 animate-[vc-blink_1.4s_ease-in-out_infinite] shadow-[inset_0_0_90px_rgba(140,31,40,0.6)]" />
      )}
      {/* hunted vignette (police/security chasing) — v51: dimmer + slower pulse while the badge fades out */}
      {hud.hunted && !hud.detained && !lowHealth && (
        <div
          className={hud.wantedFading
            ? 'absolute inset-0 animate-[vc-blink_1.8s_ease-in-out_infinite] shadow-[inset_0_0_74px_rgba(201,47,47,0.22)]'
            : 'absolute inset-0 animate-[vc-blink_0.85s_ease-in-out_infinite] shadow-[inset_0_0_74px_rgba(201,47,47,0.42)]'}
        />
      )}

      {/* lightning flash (storm weather) */}
      <AnimatePresence>
        {flash && (
          <motion.div
            key={`flash-${flashAt}`}
            initial={{ opacity: 0.78 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.34, ease: 'easeOut' }}
            className="absolute inset-0 z-40 bg-[#e8f0ff]"
          />
        )}
      </AnimatePresence>

      {/* WANTED — chase alarm stamp (v51: fading = dimmed "losing them…" state) */}
      <AnimatePresence>
        {hud.hunted && !hud.detained && (
          <motion.div
            key="wanted"
            initial={{ opacity: 0, scale: 1.7, rotate: -6 }}
            animate={{ opacity: 1, scale: 1, rotate: -2 }}
            exit={{ opacity: 0, scale: 0.7, rotate: 2, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 340, damping: 17 }}
            className="absolute left-1/2 top-[30%] z-10 -translate-x-1/2"
          >
            {hud.wantedFading ? (
              <div className="vc-stamp-texture flex animate-[vc-blink_1.8s_ease-in-out_infinite] items-center gap-2 rounded-lg border-[3px] border-[#8c1f28]/55 bg-[#8c1f28]/55 px-4 py-1.5">
                <Siren className="h-4 w-4 text-[#f2c14e]/70" strokeWidth={2.6} />
                <span className="text-sm font-black uppercase tracking-[0.3em] text-[#f5efdc]/75">Wanted</span>
                <span className="text-[10px] font-black uppercase tracking-widest text-[#f2c14e]/80">Losing them…</span>
              </div>
            ) : (
              <div className="vc-stamp-texture flex animate-pulse items-center gap-2 rounded-lg border-[3px] border-[#8c1f28] bg-[#8c1f28]/92 px-4 py-1.5">
                <Siren className="h-4 w-4 text-[#f2c14e]" strokeWidth={2.6} />
                <span className="text-sm font-black uppercase tracking-[0.3em] text-[#f5efdc]">Wanted</span>
                <span className="text-[10px] font-black uppercase tracking-widest text-[#f2c14e]">Run!</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- top-left: vitals ---------- */}
      <div className="absolute left-2 top-2 origin-top-left space-y-1.5 scale-90 sm:left-3 sm:top-3 sm:scale-100">
        <div className="pointer-events-auto rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc]/92 p-2.5 shadow-[4px_4px_0_rgba(28,26,23,0.8)] backdrop-blur-sm">
          <StatBar value={hud.health} max={hud.maxHealth} color="linear-gradient(90deg,#c9482e,#8c1f28)" icon={Heart} />
          <div className="mt-1.5" />
          <StatBar value={hud.stamina} max={100} color="linear-gradient(90deg,#f2c14e,#e0a63a)" icon={Zap} />
          <div className="mt-2 flex items-center gap-2">
            <span className="flex items-center gap-1 rounded-full border-2 border-[#1c1a17]/80 bg-[#f2c14e] px-2 py-0.5 text-[11px] font-black tabular-nums text-[#1c1a17]">
              <Vote className="h-3.5 w-3.5" /> {hud.tokens}/{hud.tokensNeeded}
            </span>
            <span className="flex items-center gap-1 rounded-full border border-[#1c1a17]/50 bg-[#f5efdc] px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#1c1a17]/70">
              <Footprints className="h-3 w-3" /> {hud.distance}m
            </span>
            {speedLeft > 0 && (
              <span className="flex items-center gap-1 rounded-full border border-[#2e6e4e] bg-[#2e6e4e] px-2 py-0.5 text-[10px] font-black uppercase text-[#f5efdc]">
                <Gauge className="h-3 w-3" /> {speedLeft}s
              </span>
            )}
          </div>
        </div>
        {/* objective banner */}
        <div className="max-w-[240px] rounded-xl border-2 border-[#1c1a17]/80 bg-[#1c1a17]/90 px-3 py-1.5 shadow-[3px_3px_0_rgba(28,26,23,0.8)] sm:max-w-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[9px] font-black uppercase tracking-[0.25em] text-[#f2a541]">Objective</div>
            {hud.role === 'police' && (
              <span className="flex items-center gap-1 rounded-full border border-[#9ecbff]/60 bg-[#3d5a80]/70 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-[#cfe4ff]">
                <Siren className="h-2.5 w-2.5" /> Officer
              </span>
            )}
          </div>
          <div className="text-[11px] font-bold leading-snug text-[#f5efdc] sm:text-xs">{hud.objective}</div>
          {hud.role === 'police' && (
            <div className="mt-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-[#9ecbff]">
              <Gavel className="h-2.5 w-2.5" /> {hud.arrests} arrested this shift
            </div>
          )}
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f5efdc]/20">
              <div
                className="h-full bg-[#f2c14e] transition-[width] duration-300"
                style={{ width: `${(hud.checkpoint / Math.max(1, hud.totalCheckpoints)) * 100}%` }}
              />
            </div>
            <span className="text-[9px] font-black uppercase tabular-nums text-[#f5efdc]/70">
              CP {hud.checkpoint}/{hud.totalCheckpoints}
            </span>
          </div>
        </div>
      </div>

      {/* ---------- top-right: connection / match info ---------- */}
      {/* v42 — items-end: every chip (connection, env, perf, season, cell, squad pane)
          flush-aligns to the RIGHT edge regardless of its own width — previously the
          stack stretched to its widest child and narrower chips (squad pane, season,
          cell) floated left of it, looking un-docked. */}
      <div className="absolute right-2 top-2 flex max-h-[calc(100vh-202px)] origin-top-right scale-90 flex-col items-end space-y-1.5 overflow-x-clip overflow-y-clip [overflow-clip-margin:8px] sm:right-3 sm:top-3 sm:scale-100">
        <div className="pointer-events-auto flex items-center gap-2.5 rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc]/92 px-3 py-2 shadow-[4px_4px_0_rgba(28,26,23,0.8)] backdrop-blur-sm">
          <span className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide ${conn.cls}`}>
            <span className={`h-2 w-2 rounded-full ${conn.dot}`} />
            <conn.icon className="h-3 w-3" />
            {/* v46 — label + ping collapse on phones to keep the chip one row */}
            <span className="hidden sm:inline">{conn.label}</span>
          </span>
          <span className="hidden text-[10px] font-black tabular-nums text-[#1c1a17]/70 sm:inline">{hud.ping}ms</span>
          <span className="flex items-center gap-1 text-[10px] font-black tabular-nums text-[#1c1a17]/70">
            <Users className="h-3 w-3" /> {hud.playersOnline}
          </span>
          <span className="flex items-center gap-1 rounded-lg border border-[#1c1a17]/50 bg-[#1c1a17] px-1.5 py-0.5 text-[10px] font-black tabular-nums text-[#f2c14e]">
            <Clock className="h-3 w-3" /> {formatTime(hud.matchTime)}
          </span>
          {settings.showFps && (
            <span className="text-[10px] font-black tabular-nums text-[#2e6e4e]">{fps} FPS</span>
          )}
        </div>

        {/* environment chip — in-game clock + weather (client-side day/night cycle) */}
        <EnvChip env={hud.env} compact={isTouch} />

        {/* perf chip — FPS · net · crowd/rigs · render res (toggle in Options → Performance) */}
        {settings.perfHud && <PerfChip perf={hud.perf} compact={isTouch} />}

        {/* season chip (solo queue — persistent 100-protester world with backfill bots) */}
        {season && (
          <div className="pointer-events-auto w-40 overflow-hidden rounded-xl border-2 border-[#8c1f28] bg-[#8c1f28]/95 shadow-[3px_3px_0_rgba(28,26,23,0.75)] sm:w-56">
            <div className="flex items-center justify-between gap-1.5 px-2 py-1">
              <span className="flex items-center gap-1.5">
                <BotIcon className="h-3 w-3 text-[#f2c14e]" />
                <span className="text-[9px] font-black uppercase tracking-[0.18em] text-[#f5efdc]">{season.name}</span>
              </span>
              <span className="flex items-center gap-1 text-[9px] font-black tabular-nums text-[#f2c14e]">
                {season.humans + season.bots}/{season.cap}
                <span className="text-[#f5efdc]/70">·</span>
                <span className="text-[#7ee08a]">{season.humans} human{season.humans === 1 ? '' : 's'}</span>
              </span>
            </div>
            <AnimatePresence>
              {season.lastEvent && now - season.lastEventAt < 6000 && (
                <motion.div
                  key={season.lastEvent + String(season.lastEventAt)}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-1.5 border-t border-[#f5efdc]/15 bg-[#1c1a17]/25 px-2 py-0.5"
                >
                  <Megaphone className="h-2.5 w-2.5 shrink-0 text-[#f2c14e]" />
                  <span className="truncate text-[8.5px] font-bold uppercase tracking-wide text-[#f5efdc]/90">{season.lastEvent}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* protest-cell squad chip (§15) */}
        {squad && squad.members.length > 0 && (
          <div className="pointer-events-auto flex w-36 items-center justify-between rounded-xl border-2 border-[#2e6e4e] bg-[#2e6e4e]/95 px-2 py-1 shadow-[3px_3px_0_rgba(28,26,23,0.75)] sm:w-44">
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7ee08a] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#7ee08a]" />
              </span>
              <span className="text-[9px] font-black uppercase tracking-[0.18em] text-[#f5efdc]">Cell</span>
              <span className="font-mono text-xs font-black tracking-[0.22em] text-[#f2c14e]">{squad.code}</span>
            </span>
            <span className="text-[10px] font-black tabular-nums text-[#f5efdc]">{squad.members.length}/4</span>
          </div>
        )}

        {/* squad — PERSISTENT + right-docked (v42). v46 mobile pass: on TOUCH devices
            (phones AND tablets, any orientation) the pane collapses to a small header
            chip (count + chevron) so the top-right column never runs into the touch
            action pad — tapping it opens the full Tab squad manager. Desktop (no
            touch controls on screen) keeps the full pane with live rows unchanged. */}
        {settings.squadPanel !== false && !squadOpen && !isTouch && (
          <div className="pointer-events-auto flex max-h-full min-h-0 w-48 flex-col overflow-hidden rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc]/92 p-1.5 shadow-[4px_4px_0_rgba(28,26,23,0.8)] backdrop-blur-sm">
            <div className="flex items-center justify-between px-1">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#8c1f28]">Squad</span>
              <span className="rounded border border-[#1c1a17]/50 bg-[#1c1a17] px-1 text-[8px] font-black tabular-nums text-[#f2c14e]">
                {hud.squad.length}
              </span>
            </div>
            {hud.squad.length === 0 ? (
              <div className="px-1 pb-0.5 pt-0.5 text-[9px] font-semibold leading-snug text-[#1c1a17]/50">
                Nobody in range — <span className="font-black text-[#1c1a17]/70">Tab</span> opens the cell manager.
              </div>
            ) : (
              <div className="vc-scroll mt-1 max-h-[32vh] min-h-0 flex-initial space-y-1 overflow-y-auto pr-0.5">
                {hud.squad.map((m) => <SquadRow key={m.id} m={m} inCell={squad?.members.some((c) => c.id === m.id) ?? false} />)}
              </div>
            )}
          </div>
        )}
        {/* touch: collapsed one-row chip — tap opens the full squad manager (z-45 modal) */}
        {settings.squadPanel !== false && !squadOpen && isTouch && (
          <button
            onClick={() => toggleSquad(true)}
            title="Squad — tap to open the cell manager"
            aria-label={`Squad status, ${hud.squad.length} protester${hud.squad.length === 1 ? '' : 's'} nearby. Tap to open the squad manager.`}
            className="pointer-events-auto flex w-32 items-center justify-between rounded-xl border-2 border-[#1c1a17]/80 bg-[#f5efdc]/92 px-2 py-1.5 shadow-[3px_3px_0_rgba(28,26,23,0.8)] backdrop-blur-sm active:scale-95"
          >
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3 text-[#8c1f28]" />
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#8c1f28]">Squad</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="rounded border border-[#1c1a17]/50 bg-[#1c1a17] px-1 text-[8px] font-black tabular-nums text-[#f2c14e]">
                {hud.squad.length}
              </span>
              <ChevronDown className="h-3 w-3 text-[#1c1a17]/50" />
            </span>
          </button>
        )}
      </div>

      {/* ---------- center-top: zone banner ---------- */}
      <div className="absolute left-1/2 top-16 -translate-x-1/2 sm:top-20">
        <AnimatePresence>
          {zoneVisible && (
            <motion.div
              key={hud.zoneName}
              initial={{ opacity: 0, y: -14, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              className="text-center"
            >
              <div className="inline-block overflow-hidden rounded-xl border-2 border-[#1c1a17]/80 bg-[#f5efdc]/95 shadow-[4px_4px_0_rgba(28,26,23,0.8)]">
                <div className="h-1.5 w-full" style={{ background: ZONE_ACCENTS[hud.zoneName] ?? '#c96f4a' }} />
                <div className="px-5 py-1.5">
                  <div className="text-base font-black uppercase tracking-tight text-[#1c1a17] sm:text-xl">{hud.zoneName}</div>
                  {hud.zoneHint && (
                    <div className="text-[10px] font-bold uppercase tracking-wide text-[#8c1f28]">{hud.zoneHint}</div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {/* v43 — persistent district chip: the level map this match plays */}
        {(hud.mapName || hud.mapXpMul > 1) && (
          <div className="mt-1.5 flex justify-center">
            <div
              className="inline-flex items-center gap-1.5 rounded-full border border-[#1c1a17]/70 bg-[#1c1a17]/65 px-3 py-0.5 backdrop-blur-sm"
              title={`District: ${hud.mapName} · difficulty ${hud.mapDifficulty}/5 · XP ×${hud.mapXpMul}`}
            >
              <MapPin className="h-3 w-3 shrink-0 text-[#f2c14e]" />
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#f5efdc]">
                {hud.mapName || 'Purani Sadak'}
              </span>
              <span className="flex items-center gap-0.5" aria-label={`Difficulty ${hud.mapDifficulty} of 5`}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className={`h-1 w-1 rounded-full ${i <= hud.mapDifficulty ? 'bg-[#f2c14e]' : 'bg-[#f5efdc]/25'}`} />
                ))}
              </span>
              {hud.mapXpMul > 1 && (
                <span className="text-[9px] font-black text-[#f2c14e]">×{hud.mapXpMul}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ---------- bottom-left: inventory ---------- */}
      <div className="absolute bottom-2 left-2 origin-bottom-left scale-90 space-y-1 sm:bottom-3 sm:left-3 sm:scale-100">
        <div className="flex flex-wrap gap-1.5">
          {hud.inventory.map((it, i) => (
            <InventorySlot key={it.uid} uid={it.uid} type={it.type} index={i} />
          ))}
          {Array.from({ length: Math.max(0, hud.inventoryMax - hud.inventory.length) }).map((_, i) => (
            <span
              key={`empty-${i}`}
              className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-dashed border-[#1c1a17]/40 bg-[#1c1a17]/20 sm:h-12 sm:w-12"
            >
              <Package className="h-4 w-4 text-[#f5efdc]/40" />
            </span>
          ))}
        </div>
        <div className="w-fit rounded-lg bg-[#1c1a17]/75 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-[#f5efdc]/80">
          {isTouch ? 'tap slot = use item' : '1–8 use · right-click drop · F gift to teammate'}
        </div>
      </div>

      {/* ---------- bottom-center: coordinates chip (v44) + prompts ---------- */}
      <div className="absolute bottom-3 left-1/2 flex w-max max-w-[92vw] -translate-x-1/2 flex-col items-center gap-1.5">
        {/* persistent location readout — tap to copy, teammates route to shared pins */}
        <CoordsChip mapX={hud.mapX} mapZ={hud.mapZ} />
        <AnimatePresence>
          {hud.carryingBallot && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="flex items-center gap-2 rounded-full border-2 border-[#8c1f28] bg-[#f2c14e] px-4 py-1.5 text-xs font-black uppercase tracking-tight text-[#1c1a17] shadow-[3px_3px_0_#8c1f28]"
            >
              🗳️ Carrying ballot — deposit at the box!
            </motion.div>
          )}
          {hud.revivedProgress !== null && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="w-56 rounded-xl border-2 border-[#2e6e4e] bg-[#f5efdc]/95 px-3 py-1.5 shadow-[3px_3px_0_#2e6e4e]"
            >
              <div className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-[#2e6e4e]">Reviving teammate… hold still</div>
              <div className="h-2 overflow-hidden rounded-full border border-[#1c1a17]/50 bg-[#1c1a17]/20">
                <div className="h-full bg-[#2e6e4e] transition-[width] duration-150" style={{ width: `${hud.revivedProgress * 100}%` }} />
              </div>
            </motion.div>
          )}
          {hud.interactPrompt && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="pointer-events-auto flex items-center gap-2 rounded-full border-2 border-[#1c1a17]/80 bg-[#f5efdc]/95 px-4 py-1.5 shadow-[3px_3px_0_rgba(28,26,23,0.8)]"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-md border-2 border-[#1c1a17]/70 bg-[#f2c14e] text-[11px] font-black text-[#1c1a17]">
                E
              </span>
              <span className="text-xs font-black uppercase tracking-tight text-[#1c1a17]">
                <Hand className="mr-1 inline h-3.5 w-3.5" />
                {hud.interactPrompt}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ---------- bottom-right: circular minimap (GTA-style radar) ---------- */}
      <div
        ref={minimapBoxRef}
        className="absolute bottom-2 right-2 origin-bottom-right scale-90 sm:bottom-3 sm:right-3 sm:scale-100"
      >
        <button
          onClick={() => toggleMap(true)}
          title="Open big map (M) — scroll on the radar to zoom it"
          className="pointer-events-auto group relative block h-[148px] w-[148px] overflow-hidden rounded-full border-2 border-[#f5efdc]/85 bg-[#1c1a17] shadow-[4px_4px_0_rgba(28,26,23,0.8)] transition-transform duration-150 hover:scale-[1.035] hover:shadow-[5px_6px_0_rgba(28,26,23,0.8)] sm:h-[172px] sm:w-[172px]"
        >
          <canvas ref={minimapRef} width={176} height={176} className="block h-full w-full" />
          <span className="absolute left-2 top-2 rounded bg-[#1c1a17]/80 px-1 py-px text-[7px] font-black uppercase tracking-wider text-[#f2c14e]">
            {settings.minimapZoom >= 580 ? 'full city' : `${Math.round(settings.minimapZoom)}m view`}
          </span>
          <span className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded bg-[#1c1a17]/70 px-1.5 py-px text-[7px] font-black uppercase tracking-widest text-[#f5efdc]/75">
            <MapIcon className="h-2.5 w-2.5" /> M — big map
          </span>
        </button>
      </div>

      {/* ---------- overlays ---------- */}
      <AnimatePresence>{hud.dazed && <DazedOverlay key="dazed" />}</AnimatePresence>
      <AnimatePresence>{hud.detained && <DetainedOverlay key="detained" />}</AnimatePresence>

      {/* ---------- v44 — live chat feed (bottom-left, above the inventory) ---------- */}
      <ChatFeed />

      {/* movement hint (very early match only) — touch users get stick copy, not WASD */}
      {hud.matchTime < 8 && !hud.detained && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#1c1a17]/70 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#f5efdc]/85">
          {isTouch ? 'left stick to move · hold RUN to sprint' : 'WASD move · Shift sprint · Space jump · C slide'}
        </div>
      )}
    </div>
  )
}

// ================= v44 — coordinates readout + live chat feed =================

/** Bottom-center location chip — always-on, tap to copy "X .. · Z .." for sharing. */
function CoordsChip({ mapX, mapZ }: { mapX: number; mapZ: number }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    const text = `X ${mapX} · Z ${mapZ}`
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      } catch { /* clipboard unavailable */ }
    }
    setCopied(true)
    useGameStore.getState().notify(`Coordinates copied — paste them in chat (T) so the squad can find you.`, 'info')
    setTimeout(() => setCopied(false), 1600)
  }
  return (
    <button
      onClick={copy}
      title="Click to copy your coordinates — share them in chat (T) so teammates can route to you"
      aria-label={`Your location: X ${mapX}, Z ${mapZ}. Click to copy.`}
      className="pointer-events-auto flex items-center gap-1.5 rounded-full border-2 border-[#1c1a17]/70 bg-[#1c1a17]/78 px-3 py-0.5 text-[10px] font-black tabular-nums tracking-wide text-[#f5efdc]/90 shadow-[2px_2px_0_rgba(28,26,23,0.55)] backdrop-blur-sm transition-all hover:border-[#f2c14e] hover:text-[#f2c14e]"
    >
      {copied ? <Check className="h-3 w-3 text-[#4e9b6e]" /> : <MapPin className="h-3 w-3 text-[#f2c14e]" />}
      <span>X {mapX} · Z {mapZ}</span>
      <span className="hidden items-center gap-0.5 rounded bg-[#f5efdc]/12 px-1 text-[7px] font-black uppercase tracking-widest text-[#f5efdc]/60 sm:flex">
        <Copy className="h-2 w-2" /> copy
      </span>
    </button>
  )
}

const CHAT_FEED_TTL_MS = 14000
const CHAT_FEED_MAX = 4

/** Bottom-left chat ticker: the freshest few comms lines, auto-fading after 14 s.
 *  Coordinate lines carry a gold pin chip — clicking it sets the radar waypoint.
 *  v46 — on touch devices it shows at most 2 lines and sits in the clear band
 *  between the inventory (below) and the joystick (above); desktop keeps 4. */
function ChatFeed() {
  const chatLog = useGameStore((s) => s.chat.log)
  const chatOpen = useGameStore((s) => s.chatOpen)
  const [, forceTick] = useState(0)
  const [isTouch] = useState(() => vcIsTouchDevice())
  const feedMax = isTouch ? 2 : CHAT_FEED_MAX

  // 1 Hz re-render so old lines fade out without any store writes
  useEffect(() => {
    if (chatLog.length === 0) return
    const t = window.setInterval(() => forceTick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [chatLog.length])

  if (chatOpen) return null // the comms panel shows the full log — no double feed
  const now = Date.now()
  const fresh = chatLog.filter((c) => now - c.at < CHAT_FEED_TTL_MS).slice(-feedMax)
  if (fresh.length === 0) return null

  return (
    <div className="pointer-events-none absolute bottom-[5.75rem] left-2 z-10 flex w-56 flex-col gap-1 sm:bottom-30 sm:left-3 sm:w-72">
      <AnimatePresence>
        {fresh.map((c) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className="pointer-events-auto flex items-start gap-1.5 rounded-xl border-2 border-[#1c1a17]/70 bg-[#f5efdc]/92 px-2 py-1 shadow-[2px_2px_0_rgba(28,26,23,0.65)] backdrop-blur-sm"
          >
            <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-[#8c1f28]" />
            <span className="min-w-0 text-[10px] leading-snug">
              <span className={`font-black uppercase tracking-tight ${c.mine ? 'text-[#2e6e4e]' : c.bot ? 'text-[#1c1a17]/40' : 'text-[#8c1f28]'}`}>
                {c.mine ? 'You' : c.name}
              </span>
              <span className="ml-1 break-words font-semibold text-[#1c1a17]/85">{c.text}</span>
              {c.text.match(/[Xx]\s*-?\d/) && (
                <span className="ml-1 inline-flex translate-y-px">
                  <CoordChip text={c.text} who={c.mine ? undefined : c.name} />
                </span>
              )}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
