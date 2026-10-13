'use client'

import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '@/lib/game-store'
import { uiActions, ZONE_ACCENTS } from '@/lib/game-store'
import { ITEM_CONFIG, CAPTURE_MESSAGES } from '@/game/shared/constants'
import {
  Heart, Zap, Vote, Users, Wifi, WifiOff, Map as MapIcon, Hand, Star,
  Clock, Package, Footprints, Gauge, Siren,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

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

export default function Hud({ minimapBuffer }: { minimapBuffer: React.RefObject<HTMLCanvasElement | null> }) {
  const hud = useGameStore((s) => s.hud)
  const settings = useGameStore((s) => s.settings)
  const fps = useGameStore((s) => s.fps)
  const squadOpen = useGameStore((s) => s.squadOpen)
  const squad = useGameStore((s) => s.squad)
  const toggleMap = useGameStore((s) => s.toggleMap)
  const minimapRef = useRef<HTMLCanvasElement>(null)
  const [zoneVisible, setZoneVisible] = useState(true)
  const [now, setNow] = useState(Date.now())

  // copy engine-drawn minimap buffer to the visible strip every frame
  useEffect(() => {
    let raf = 0
    const draw = () => {
      const buf = minimapBuffer.current
      const vis = minimapRef.current
      if (buf && vis) {
        const ctx = vis.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, vis.width, vis.height)
          ctx.drawImage(buf, 0, 0)
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [minimapBuffer])

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
    <div className="pointer-events-none fixed inset-0 z-20 select-none font-sans">
      {/* low-health vignette */}
      {lowHealth && !hud.detained && (
        <div className="absolute inset-0 animate-[vc-blink_1.4s_ease-in-out_infinite] shadow-[inset_0_0_90px_rgba(140,31,40,0.6)]" />
      )}
      {/* hunted vignette (police/security chasing) */}
      {hud.hunted && !hud.detained && !lowHealth && (
        <div className="absolute inset-0 animate-[vc-blink_0.85s_ease-in-out_infinite] shadow-[inset_0_0_74px_rgba(201,47,47,0.42)]" />
      )}

      {/* WANTED — chase alarm stamp */}
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
            <div className="vc-stamp-texture flex animate-pulse items-center gap-2 rounded-lg border-[3px] border-[#8c1f28] bg-[#8c1f28]/92 px-4 py-1.5">
              <Siren className="h-4 w-4 text-[#f2c14e]" strokeWidth={2.6} />
              <span className="text-sm font-black uppercase tracking-[0.3em] text-[#f5efdc]">Wanted</span>
              <span className="text-[10px] font-black uppercase tracking-widest text-[#f2c14e]">Run!</span>
            </div>
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
          <div className="text-[9px] font-black uppercase tracking-[0.25em] text-[#f2a541]">Objective</div>
          <div className="text-[11px] font-bold leading-snug text-[#f5efdc] sm:text-xs">{hud.objective}</div>
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
      <div className="absolute right-2 top-2 origin-top-right scale-90 space-y-1.5 sm:right-3 sm:top-3 sm:scale-100">
        <div className="pointer-events-auto flex items-center gap-2.5 rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc]/92 px-3 py-2 shadow-[4px_4px_0_rgba(28,26,23,0.8)] backdrop-blur-sm">
          <span className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide ${conn.cls}`}>
            <span className={`h-2 w-2 rounded-full ${conn.dot}`} />
            <conn.icon className="h-3 w-3" />
            {conn.label}
          </span>
          <span className="text-[10px] font-black tabular-nums text-[#1c1a17]/70">{hud.ping}ms</span>
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

        {/* protest-cell squad chip (§15) */}
        {squad && squad.members.length > 0 && (
          <div className="pointer-events-auto flex w-44 items-center justify-between rounded-xl border-2 border-[#2e6e4e] bg-[#2e6e4e]/95 px-2 py-1 shadow-[3px_3px_0_rgba(28,26,23,0.75)]">
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

        {/* squad list */}
        {(hud.squad.length > 0 || squadOpen) && (
          <div className="pointer-events-auto w-44 space-y-1 rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc]/92 p-1.5 shadow-[4px_4px_0_rgba(28,26,23,0.8)] backdrop-blur-sm">
            <div className="px-1 text-[9px] font-black uppercase tracking-[0.2em] text-[#8c1f28]">Squad</div>
            {hud.squad.map((m) => <SquadRow key={m.id} m={m} inCell={squad?.members.some((c) => c.id === m.id) ?? false} />)}
            {hud.squad.length === 0 && (
              <div className="px-1 pb-0.5 text-[9px] font-semibold text-[#1c1a17]/50">No squad. Press Tab for tips.</div>
            )}
          </div>
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
          1–8 use · right-click drop · F gift to teammate
        </div>
      </div>

      {/* ---------- bottom-center: prompts ---------- */}
      <div className="absolute bottom-3 left-1/2 flex w-max max-w-[92vw] -translate-x-1/2 flex-col items-center gap-1.5">
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

      {/* ---------- bottom-right: minimap ---------- */}
      <div className="absolute bottom-2 right-2 origin-bottom-right scale-90 sm:bottom-3 sm:right-3 sm:scale-100">
        <button
          onClick={() => toggleMap(true)}
          title="Open big map (M)"
          className="pointer-events-auto group relative block overflow-hidden rounded-2xl border-2 border-[#1c1a17]/80 bg-[#1c1a17]/85 p-1 shadow-[4px_4px_0_rgba(28,26,23,0.8)] transition-all hover:-translate-y-0.5 hover:shadow-[5px_6px_0_rgba(28,26,23,0.8)]"
        >
          <canvas ref={minimapRef} width={140} height={420} className="block h-[210px] w-[70px] rounded-xl sm:h-[280px] sm:w-[93px]" />
          <span className="mt-0.5 flex items-center justify-center gap-1 text-[8px] font-black uppercase tracking-widest text-[#f5efdc]/70">
            <MapIcon className="h-2.5 w-2.5" /> M — big map
          </span>
        </button>
      </div>

      {/* ---------- overlays ---------- */}
      <AnimatePresence>{hud.dazed && <DazedOverlay key="dazed" />}</AnimatePresence>
      <AnimatePresence>{hud.detained && <DetainedOverlay key="detained" />}</AnimatePresence>

      {/* movement hint (very early match only) */}
      {hud.matchTime < 8 && !hud.detained && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-[#1c1a17]/70 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#f5efdc]/85">
          WASD move · Shift sprint · Space jump · C slide
        </div>
      )}
    </div>
  )
}
