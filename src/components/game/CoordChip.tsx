'use client'

// v44 — a clickable "X 12.5 · Z -80" chip used by the chat feed + comms panel.
// Clicking sets the HUD waypoint: the circular minimap routes the player there
// (the same gold pin the big map drops). Pure store — no engine coupling.
import { MapPin } from 'lucide-react'
import { useGameStore, parseCoords } from '@/lib/game-store'

export default function CoordChip({ text, who }: { text: string; who?: string }) {
  const coords = parseCoords(text)
  if (!coords) return null
  const setWp = () => {
    useGameStore.getState().patchHud({
      waypoint: { x: coords.x, z: coords.z, label: (who ?? 'SHARED').toUpperCase().slice(0, 10) },
    })
    useGameStore.getState().notify(`Waypoint set — ${who ? `${who}'s` : ''} pin at X ${coords.x} · Z ${coords.z}. The radar will route you.`, 'info')
  }
  return (
    <button
      onClick={setWp}
      title={`Set waypoint at X ${coords.x} · Z ${coords.z}`}
      className="inline-flex items-center gap-1 rounded-md border border-[#b07d1e] bg-[#f2c14e] px-1.5 py-px align-middle text-[9px] font-black tabular-nums text-[#1c1a17] shadow-[1px_1px_0_rgba(28,26,23,0.7)] transition-colors hover:bg-[#ffdf7e]"
    >
      <MapPin className="h-2.5 w-2.5" /> X {coords.x} · Z {coords.z}
    </button>
  )
}
