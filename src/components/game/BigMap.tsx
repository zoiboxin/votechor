'use client'

import { useEffect, useRef } from 'react'
import { useGameStore, MINIMAP_MIN_ZOOM, MINIMAP_MAX_ZOOM, type Settings } from '@/lib/game-store'
import { X, MapPin, Crown, Flag, Vote, Circle, ScanEye, SquareDashedMousePointer, Crosshair, RotateCw, Compass, Spline } from 'lucide-react'
import { motion } from 'framer-motion'
import { Slider } from '@/components/ui/slider'
import { computeRoute } from '@/game/minimap'

// Hardcoded from world-def: world z range 10 → -572 mapped onto 0..100% of the strip height.
// toY(z) = ((10 - z) / 582) * 100
const ZONES = [
  { name: 'Protest Plaza', top: 1.03, height: 14.43, tone: 'bg-[#c96f4a]/25' },
  { name: 'Chowk Market', top: 15.46, height: 20.62, tone: 'bg-[#b85c3e]/25' },
  { name: 'Security Checkpoint', top: 36.08, height: 13.75, tone: 'bg-[#7f9a8c]/25' },
  { name: 'Grand Avenue', top: 49.83, height: 24.06, tone: 'bg-[#c9a86a]/25' },
  { name: 'Government District', top: 73.88, height: 26.12, tone: 'bg-[#9a7b5f]/30' },
]

const CHECKPOINTS = [
  { name: 'Plaza Gate', z: -78 },
  { name: 'Market Exit', z: -198 },
  { name: 'Security Gate', z: -278 },
  { name: 'Avenue Junction', z: -418 },
]

const ZOOM_PRESETS = [
  { label: 'Near', value: 100 },
  { label: 'Mid', value: 180 },
  { label: 'Far', value: 320 },
  { label: 'Full', value: MINIMAP_MAX_ZOOM },
]

const yFor = (z: number) => ((10 - z) / 582) * 100

function zoomLabel(z: number) {
  if (z >= 560) return 'Full city'
  if (z >= 420) return 'District'
  if (z >= 250) return 'Nearby'
  if (z >= 140) return 'Blocks'
  return 'Close-up'
}

const BUF_W = 140
const BUF_H = 420

/**
 * WYSIWYG preview — CIRCULAR-RADAR ERA: crops the engine's full-city buffer to a
 * SQUARE window of `zoom` meters, i.e. the world footprint the circular radar
 * sweeps across its diameter (the old portrait strip window no longer exists;
 * same buffer pipeline, square crop — documented graceful degradation).
 */
function MinimapPreview({ buffer }: { buffer: React.RefObject<HTMLCanvasElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const zoom = useGameStore((s) => s.settings.minimapZoom)
  const mapX = useGameStore((s) => s.hud.mapX)
  const mapZ = useGameStore((s) => s.hud.mapZ)

  useEffect(() => {
    let raf = 0
    const draw = () => {
      const buf = buffer.current
      const vis = canvasRef.current
      if (buf && vis) {
        const ctx = vis.getContext('2d')
        if (ctx) {
          ctx.imageSmoothingEnabled = false
          const span = Math.max(MINIMAP_MIN_ZOOM, Math.min(MINIMAP_MAX_ZOOM, zoom || 150))
          const wx0 = mapX - span / 2, wzTop = mapZ + span / 2
          ctx.clearRect(0, 0, vis.width, vis.height)
          ctx.fillStyle = 'rgba(28,26,23,0.85)'
          ctx.fillRect(0, 0, vis.width, vis.height)
          // intersect the square window with the world bounds, mapped into buffer pixels
          const cx0 = Math.max(wx0, -48), cx1 = Math.min(wx0 + span, 48)
          const cz0 = Math.max(wzTop, -572), cz1 = Math.min(wzTop - span, 10)
          if (cx1 > cx0 && cz0 > cz1) {
            const sx = ((cx0 + 48) / 96) * BUF_W
            const sy = ((10 - cz0) / 582) * BUF_H
            const sw = ((cx1 - cx0) / 96) * BUF_W
            const sh = ((cz0 - cz1) / 582) * BUF_H
            const dx = ((cx0 - wx0) / span) * vis.width
            const dy = ((wzTop - cz0) / span) * vis.height
            const dw = ((cx1 - cx0) / span) * vis.width
            const dh = ((cz0 - cz1) / span) * vis.height
            ctx.drawImage(buf, sx, sy, sw, sh, dx, dy, dw, dh)
          }
          // you-marker at the center (the radar's arrow lives here)
          const px = vis.width / 2, py = vis.height / 2
          ctx.fillStyle = '#ffffff'
          ctx.strokeStyle = '#1c1a17'
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.moveTo(px, py - 6); ctx.lineTo(px + 4.4, py + 5); ctx.lineTo(px, py + 2.6); ctx.lineTo(px - 4.4, py + 5)
          ctx.closePath(); ctx.fill(); ctx.stroke()
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [buffer, zoom, mapX, mapZ])

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0 overflow-hidden rounded-full border-2 border-[#f5efdc]/80 bg-[#1c1a17] shadow-[3px_3px_0_rgba(28,26,23,0.5)]">
        <canvas ref={canvasRef} width={140} height={140} className="block h-[104px] w-[104px]" />
        <span className="absolute left-1/2 top-0.5 -translate-x-1/2 rounded bg-[#1c1a17]/80 px-1 text-[7px] font-black uppercase tracking-wider text-[#f2c14e]">▲ N</span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.2em] text-[#8c1f28]">
          <ScanEye className="h-3 w-3" /> Live radar preview
        </div>
        <p className="mt-1 text-[10px] font-semibold leading-snug text-[#1c1a17]/65">
          The world your circular radar sweeps — a square crop of its diameter, live as you march.
        </p>
      </div>
    </div>
  )
}

/** Minimap zoom settings — the requested scroll-and-adjust panel inside the big map. */
function MinimapSettings({ buffer }: { buffer: React.RefObject<HTMLCanvasElement | null> }) {
  const settings = useGameStore((s) => s.settings)
  const setSettings = useGameStore((s) => s.setSettings)
  const zoom = settings.minimapZoom ?? MINIMAP_MAX_ZOOM

  const update = (patch: Partial<Settings>) => {
    setSettings(patch)
    try {
      const merged = { ...settings, ...patch, keybinds: { ...settings.keybinds, ...(patch.keybinds ?? {}) } }
      localStorage.setItem('votechor_settings', JSON.stringify(merged))
    } catch {
      /* private browsing — lives for this session only */
    }
  }

  return (
    <div className="vc-scroll w-full shrink-0 space-y-3 overflow-y-auto sm:w-52">
      <div className="rounded-2xl border-2 border-[#1c1a17]/80 bg-[#f5efdc] p-3 shadow-[3px_3px_0_rgba(28,26,23,0.4)]">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-[#8c1f28]">
            <SquareDashedMousePointer className="h-3.5 w-3.5" /> Minimap zoom
          </div>
          <span className="rounded-md border border-[#1c1a17]/40 bg-[#f2c14e] px-1.5 py-px text-[9px] font-black tabular-nums text-[#1c1a17]">
            {zoomLabel(zoom)} · {Math.round(zoom)}m
          </span>
        </div>
        <Slider
          value={[zoom]}
          min={MINIMAP_MIN_ZOOM}
          max={MINIMAP_MAX_ZOOM}
          step={2}
          onValueChange={(v) => update({ minimapZoom: v[0] ?? MINIMAP_MAX_ZOOM })}
          aria-label="Minimap zoom window"
          className="my-2"
        />
        <div className="flex justify-between text-[8px] font-black uppercase tracking-wider text-[#1c1a17]/45">
          <span>close-up</span>
          <span>full city</span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1">
          {ZOOM_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => update({ minimapZoom: p.value })}
              className={`rounded-lg border-2 px-1 py-1 text-[9px] font-black uppercase tracking-wide shadow-[2px_2px_0_#1c1a17] transition-all hover:-translate-y-px active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_#1c1a17] ${
                Math.abs(zoom - p.value) < 2
                  ? 'border-[#1c1a17] bg-[#1c1a17] text-[#f2c14e]'
                  : 'border-[#1c1a17]/70 bg-[#f5efdc] text-[#1c1a17] hover:bg-[#f2c14e]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1">
          <button
            onClick={() => update({ minimapRotate: !settings.minimapRotate })}
            title="Rotate the radar with your heading, or keep it north-up"
            className={`flex items-center justify-center gap-1 rounded-lg border-2 px-1 py-1 text-[9px] font-black uppercase tracking-wide shadow-[2px_2px_0_#1c1a17] transition-all hover:-translate-y-px active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_#1c1a17] ${
              settings.minimapRotate
                ? 'border-[#1c1a17] bg-[#1c1a17] text-[#f2c14e]'
                : 'border-[#1c1a17]/70 bg-[#f5efdc] text-[#1c1a17] hover:bg-[#f2c14e]'
            }`}
          >
            {settings.minimapRotate ? <RotateCw className="h-3 w-3" /> : <Compass className="h-3 w-3" />}
            {settings.minimapRotate ? 'Rotating' : 'North-up'}
          </button>
          <button
            onClick={() => useGameStore.getState().patchHud({ waypoint: null })}
            title="Clears the waypoint and re-centers the radar on you"
            className="flex items-center justify-center gap-1 rounded-lg border-2 border-[#1c1a17]/70 bg-[#f5efdc] px-1 py-1 text-[9px] font-black uppercase tracking-wide text-[#1c1a17] shadow-[2px_2px_0_#1c1a17] transition-all hover:-translate-y-px hover:bg-[#f2c14e] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_#1c1a17]"
          >
            <Crosshair className="h-3 w-3" /> Recenter
          </button>
        </div>
      </div>

      <div className="rounded-2xl border-2 border-dashed border-[#8c1f28]/50 bg-[#f2c14e]/25 p-3">
        <MinimapPreview buffer={buffer} />
      </div>

      <p className="px-1 text-[9px] font-semibold leading-relaxed text-[#1c1a17]/55">
        The gold dashed circle on the map is the ground your radar sweeps. Scroll the radar to zoom,
        click the map to drop a waypoint — your choices survive page reloads.
      </p>
    </div>
  )
}

export default function BigMap({ minimapBuffer }: { minimapBuffer: React.RefObject<HTMLCanvasElement | null> }) {
  const open = useGameStore((s) => s.mapOpen)
  const toggleMap = useGameStore((s) => s.toggleMap)
  const zoneName = useGameStore((s) => s.hud.zoneName)
  const mapX = useGameStore((s) => s.hud.mapX)
  const mapZ = useGameStore((s) => s.hud.mapZ)
  const minimapZoom = useGameStore((s) => s.settings.minimapZoom)
  const waypoint = useGameStore((s) => s.hud.waypoint)
  const patchHud = useGameStore((s) => s.patchHud)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // CLICK-TO-WAYPOINT: click anywhere on the city → gold pin + radar marker + route
  const setWaypoint = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const wx = ((e.clientX - rect.left) / rect.width) * 96 - 48
    const wz = 10 - ((e.clientY - rect.top) / rect.height) * 582
    patchHud({ waypoint: { x: Math.round(wx * 10) / 10, z: Math.round(wz * 10) / 10, label: 'WAYPOINT' } })
  }

  useEffect(() => {
    if (!open) return
    let raf = 0
    const draw = () => {
      const buf = minimapBuffer.current
      const vis = canvasRef.current
      if (buf && vis) {
        const ctx = vis.getContext('2d')
        if (ctx) {
          ctx.imageSmoothingEnabled = false
          ctx.clearRect(0, 0, vis.width, vis.height)
          ctx.drawImage(buf, 0, 0, vis.width, vis.height)
          // route preview: gold dashed walking line player → waypoint (A* over the 10m nav grid)
          const st = useGameStore.getState()
          const wp = st.hud.waypoint
          if (wp) {
            const toX = (x: number) => ((x + 48) / 96) * vis.width
            const toY = (z: number) => ((10 - z) / 582) * vis.height
            const route = computeRoute(st.hud.mapX, st.hud.mapZ, wp.x, wp.z)
            const pts = [{ x: st.hud.mapX, z: st.hud.mapZ }, ...(route ?? [{ x: wp.x, z: wp.z }])]
            ctx.lineJoin = 'round'
            ctx.lineCap = 'round'
            ctx.beginPath()
            pts.forEach((p, i) => (i === 0 ? ctx.moveTo(toX(p.x), toY(p.z)) : ctx.lineTo(toX(p.x), toY(p.z))))
            ctx.strokeStyle = 'rgba(28,26,23,0.7)'
            ctx.lineWidth = 6
            ctx.stroke()
            ctx.strokeStyle = '#f2c14e'
            ctx.lineWidth = 2.6
            ctx.setLineDash([8, 6])
            ctx.stroke()
            ctx.setLineDash([])
          }
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [open, minimapBuffer])

  if (!open) return null

  // circular radar footprint on the map — a true world-circle becomes an ellipse
  // here because the map stretches x and z differently (96m→320px vs 582m→700px)
  const radarRect = {
    left: `${Math.max(0, Math.min(100, ((mapX + 48) / 96) * 100))}%`,
    top: `${Math.max(0, Math.min(100, ((10 - mapZ) / 582) * 100))}%`,
    width: `${Math.min(160, (minimapZoom / 96) * 100)}%`,
    height: `${Math.min(110, (minimapZoom / 582) * 100)}%`,
  }

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-[#1c1a17]/70 backdrop-blur-sm" onClick={() => toggleMap(false)}>
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22 }}
        className="vc-paper relative flex max-h-[92vh] flex-col gap-3 overflow-y-auto rounded-3xl border-2 border-[#1c1a17]/80 p-4 shadow-[8px_8px_0_rgba(28,26,23,0.85)] vc-scroll sm:flex-row sm:overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* map column */}
        <div className="flex min-h-0 flex-col">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-lg font-black uppercase tracking-tight text-[#1c1a17]">
              City Map <span className="text-[#8c1f28]">— The Long Walk</span>
            </h3>
            <div className="flex items-center gap-1.5">
              {/* distance-to-waypoint chip (live — hud.mapX/mapZ tick at 8Hz) */}
              {waypoint && (
                <span className="flex items-center gap-1 rounded-lg border-2 border-[#b07d1e] bg-[#f2c14e] px-2 py-0.5 text-[10px] font-black tabular-nums text-[#1c1a17] shadow-[2px_2px_0_#1c1a17]">
                  <MapPin className="h-3 w-3" />
                  {Math.round(Math.hypot(waypoint.x - mapX, waypoint.z - mapZ))}m
                  <button
                    onClick={() => patchHud({ waypoint: null })}
                    className="ml-0.5 rounded border border-[#1c1a17]/40 bg-[#f5efdc]/70 px-0.5 hover:bg-[#1c1a17] hover:text-[#f2c14e]"
                    aria-label="Clear waypoint"
                    title="Clear waypoint"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )}
              <button
                onClick={() => toggleMap(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border-2 border-[#1c1a17]/70 bg-[#f5efdc] text-[#1c1a17] shadow-[2px_2px_0_#1c1a17] transition-all hover:bg-[#f2c14e] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_#1c1a17]"
                aria-label="Close map"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div
            onClick={setWaypoint}
            title="Click anywhere to drop a gold waypoint — the radar will route you there"
            className="relative cursor-crosshair overflow-hidden rounded-2xl border-2 border-[#1c1a17]/80 bg-[#1c1a17]"
            style={{ height: 'min(64vh, 600px)', aspectRatio: '320 / 700' }}
          >
            <canvas ref={canvasRef} width={320} height={700} className="absolute inset-0 h-full w-full" />

            {/* zone overlays */}
            {ZONES.map((z) => (
              <div
                key={z.name}
                className={`absolute inset-x-0 border-y border-dashed border-[#f5efdc]/25 ${z.tone}`}
                style={{ top: `${z.top}%`, height: `${z.height}%` }}
              >
                <span className={`absolute left-1.5 top-0.5 text-[9px] font-black uppercase tracking-wider sm:text-[11px] ${zoneName === z.name ? 'text-[#f2c14e]' : 'text-[#f5efdc]/70'}`}>
                  {z.name}
                </span>
              </div>
            ))}

            {/* gold radar ellipse = the ground the circular radar sweeps (moves with the player);
                a world-circle maps to an ellipse because this map stretches x and z differently */}
            <div
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-dashed border-[#f2c14e] bg-[#f2c14e]/10 shadow-[0_0_0_1px_rgba(28,26,23,0.45)] transition-all duration-300"
              style={radarRect}
            >
              <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded bg-[#f2c14e]/90 px-1 text-[7px] font-black uppercase tracking-widest text-[#1c1a17]">
                radar
              </span>
            </div>

            {/* user waypoint pin — click it to clear */}
            {waypoint && (
              <button
                onClick={(e) => { e.stopPropagation(); patchHud({ waypoint: null }) }}
                title="Waypoint — click the pin to clear it"
                aria-label="Clear waypoint"
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-[92%] text-[#f2c14e] drop-shadow-[1px_1px_0_rgba(28,26,23,0.65)] transition-transform hover:scale-110"
                style={{ left: `${Math.max(2, Math.min(98, ((waypoint.x + 48) / 96) * 100))}%`, top: `${Math.max(2, Math.min(98, yFor(waypoint.z)))}%` }}
              >
                <MapPin className="h-5 w-5 fill-[#f2c14e] text-[#1c1a17]" />
              </button>
            )}

            {/* checkpoint markers */}
            {CHECKPOINTS.map((c) => (
              <div
                key={c.name}
                className="absolute flex items-center gap-1"
                style={{ top: `${yFor(c.z)}%`, left: '56%' }}
              >
                <Flag className="h-3 w-3 text-[#c9482e]" />
                <span className="whitespace-nowrap text-[8px] font-black uppercase tracking-wide text-[#f5efdc]/80 sm:text-[9px]">
                  {c.name}
                </span>
              </div>
            ))}

            {/* boss arena marker */}
            <div className="absolute flex items-center gap-1" style={{ top: `${yFor(-520)}%`, left: '56%' }}>
              <Crown className="h-3.5 w-3.5 text-[#8c1f28]" />
              <span className="whitespace-nowrap text-[8px] font-black uppercase tracking-wide text-[#f2a541] sm:text-[9px]">
                Vote Collector Arena
              </span>
            </div>

            {/* compass */}
            <span className="absolute right-1.5 top-1 rounded bg-[#1c1a17]/70 px-1 text-[8px] font-black uppercase tracking-widest text-[#f5efdc]/70">
              ▲ North (Plaza)
            </span>
          </div>
        </div>

        {/* minimap settings column — zoom slider + live preview (requested: scroll & adjust) */}
        <MinimapSettings buffer={minimapBuffer} />

        {/* legend column */}
        <div className="vc-scroll hidden w-44 shrink-0 overflow-y-auto sm:block">
          <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-[#8c1f28]">Legend</div>
          <ul className="space-y-1.5 text-[10px] font-bold text-[#1c1a17]/80">
            <li className="flex items-center gap-2"><Circle className="h-3 w-3 fill-[#c9482e] text-[#c9482e]" /> Checkpoint (red = locked)</li>
            <li className="flex items-center gap-2"><Circle className="h-3 w-3 fill-[#4e9b6e] text-[#4e9b6e]" /> Checkpoint (green = yours)</li>
            <li className="flex items-center gap-2"><Vote className="h-3 w-3 text-[#e0a63a]" /> Stolen vote token</li>
            <li className="flex items-center gap-2"><Circle className="h-3 w-3 fill-[#3a6ea5] text-[#3a6ea5]" /> Patrol</li>
            <li className="flex items-center gap-2"><Circle className="h-3 w-3 fill-[#ff3b30] text-[#ff3b30]" /> Patrol chasing someone</li>
            <li className="flex items-center gap-2"><Circle className="h-3 w-3 fill-[#4ecdc4] text-[#4ecdc4]" /> Squadmate</li>
            <li className="flex items-center gap-2"><Circle className="h-3 w-3 fill-white text-[#1c1a17]" /> You, brave arrow</li>
            <li className="flex items-center gap-2"><Crown className="h-3 w-3 text-[#8c1f28]" /> Boss gate + arena</li>
            <li className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 fill-[#f2c14e] text-[#1c1a17]" /> Waypoint (click map to drop)</li>
            <li className="flex items-center gap-2"><Spline className="h-3 w-3 text-[#b07d1e]" /> Walking route (gold dashes)</li>
            <li className="flex items-center gap-2"><span className="h-3 w-6 rounded-[50%] border-2 border-dashed border-[#b07d1e] bg-[#f2c14e]/30" /> Radar ground view</li>
          </ul>
          <div className="mt-3 rounded-xl border-2 border-dashed border-[#8c1f28]/50 bg-[#f2c14e]/25 p-2">
            <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[#8c1f28]">
              <MapPin className="h-3 w-3" /> Current zone
            </div>
            <p className="mt-0.5 text-xs font-black uppercase tracking-tight text-[#1c1a17]">{zoneName}</p>
          </div>
          <p className="mt-3 text-[9px] font-semibold leading-relaxed text-[#1c1a17]/55">
            The map is drawn live by the engine. Tokens you have already grabbed will not appear — they are safely
            in your pockets, where votes belong.
          </p>
          <p className="mt-2 text-center text-[9px] font-bold uppercase tracking-widest text-[#1c1a17]/40">M / Esc to close</p>
        </div>
      </motion.div>
    </div>
  )
}
