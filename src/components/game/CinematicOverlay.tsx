'use client'
// Cinematic overlay — vignette + animated film grain + zone-entry tint during play.
// Skipped when reducedEffects is on. Pure CSS, pointer-events-none.
import { useGameStore, ZONE_ACCENTS } from '@/lib/game-store'

export default function CinematicOverlay() {
  const uiMode = useGameStore((s) => s.uiMode)
  const reduced = useGameStore((s) => s.settings.reducedEffects)
  const detained = useGameStore((s) => s.hud.detained)
  const dazed = useGameStore((s) => s.hud.dazed)
  const health = useGameStore((s) => s.hud.health)
  const maxHealth = useGameStore((s) => s.hud.maxHealth)
  const cinematic = useGameStore((s) => s.hud.cinematic)
  const zoneName = useGameStore((s) => s.hud.zoneName)

  if (uiMode !== 'playing' || reduced) return null
  const lowHealth = health / Math.max(1, maxHealth) < 0.3
  const zoneAccent = ZONE_ACCENTS[zoneName] ?? '#c96f4a'

  return (
    <>
      {/* zone-entry tint wash — re-keyed per zone so the CSS animation replays on entry;
          vc-zonetint ends at opacity 0 so the wash vanishes until the next zone */}
      <div
        key={zoneName}
        className="pointer-events-none fixed inset-0 z-20"
        style={{ background: `radial-gradient(ellipse at center, transparent 30%, ${zoneAccent}26 100%)`, animation: 'vc-zonetint 2.4s ease-out forwards' }}
      />
      {/* vignette — deepens when low health */}
      <div
        className="pointer-events-none fixed inset-0 z-20 transition-opacity duration-700"
        style={{
          background: `radial-gradient(ellipse at center, transparent 52%, rgba(28,26,23,${lowHealth ? 0.55 : 0.28}) 100%)`,
        }}
      />
      {/* low-health pulse ring */}
      {lowHealth && !detained && !dazed && (
        <div
          className="pointer-events-none fixed inset-0 z-20 animate-pulse"
          style={{ background: 'radial-gradient(ellipse at center, transparent 60%, rgba(140,31,40,0.35) 100%)' }}
        />
      )}
      {/* film grain */}
      <div
        className="pointer-events-none fixed inset-0 z-20 opacity-[0.05] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 240 240' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: '240px 240px',
          animation: 'vc-grain 0.6s steps(4) infinite',
        }}
      />
      {/* boss cinematic letterbox */}
      {cinematic && (
        <>
          <div className="pointer-events-none fixed inset-x-0 top-0 z-30 bg-[#1c1a17] transition-all duration-500" style={{ height: '7vh' }} />
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-[#1c1a17]" style={{ height: '7vh' }} />
          <div className="pointer-events-none fixed left-1/2 top-[8.5vh] z-30 -translate-x-1/2 text-center">
            <div className="vc-stamp-in rounded-xl border-2 border-[#f2c14e] bg-[#1c1a17]/85 px-5 py-2 shadow-[5px_5px_0_rgba(242,193,78,0.4)]">
              <div className="text-[10px] font-black uppercase tracking-[0.35em] text-[#f2a541]">Now approaching the podium</div>
              <div className="text-lg font-black uppercase tracking-tight text-[#f5efdc] sm:text-2xl">The Great Vote Collector</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#f5efdc]/60">Minister of Missing Votes · 14-term champion of paperwork</div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
