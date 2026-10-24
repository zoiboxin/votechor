'use client'

/**
 * Cookie-style consent banner (task 97) — "save the game files on my device".
 *
 * VoteChor uses NO tracking cookies. What we CAN offer is the browser's Cache
 * API: with one tap, the 3D character model files are stored locally and every
 * future session loads them straight from disk — faster boots, less mobile
 * data, instant character swaps. This banner asks once, remembers the answer,
 * streams the files in with a progress bar, and purges caches from older
 * builds automatically. Everything degrades to normal network loading.
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Cookie, HardDriveDownload, Check, Loader2, X } from 'lucide-react'
import {
  SMALL_ASSET_URLS, BIG_ASSET_URLS, getConsent, setConsent,
  precacheAssets, purgeOldAssetCaches, cachedAssetInfo, type PrecacheProgress,
} from '@/lib/asset-cache'

const fmtMB = (b: number) => `${(b / (1024 * 1024)).toFixed(1)} MB`

type Phase = 'ask' | 'caching' | 'done'

export default function CookieBanner() {
  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<Phase>('ask')
  const [prog, setProg] = useState<PrecacheProgress | null>(null)
  const [doneBytes, setDoneBytes] = useState(0)
  const [bigSaved, setBigSaved] = useState(false)
  const [bigBusy, setBigBusy] = useState(false)

  useEffect(() => {
    // housekeeping regardless of the answer: drop caches from older builds
    void purgeOldAssetCaches()
    if (getConsent() === 'unset') {
      const t = window.setTimeout(() => setVisible(true), 1600) // let the menu land first
      return () => window.clearTimeout(t)
    }
    if (getConsent() === 'granted') {
      // already accepted previously — refresh the small set silently (new build = empty cache)
      void cachedAssetInfo().then(({ count }) => {
        if (count < SMALL_ASSET_URLS.length) void precacheAssets(SMALL_ASSET_URLS)
      })
    }
  }, [])

  const accept = async () => {
    setConsent('granted')
    setPhase('caching')
    const res = await precacheAssets(SMALL_ASSET_URLS, setProg)
    setDoneBytes(res.bytes)
    setBigSaved(res.ok === SMALL_ASSET_URLS.length ? false : res.ok > 0)
    setPhase('done')
    window.setTimeout(() => setVisible(false), 6000)
  }

  const saveBig = async () => {
    setBigBusy(true)
    await precacheAssets(BIG_ASSET_URLS)
    setBigSaved(true)
    setBigBusy(false)
  }

  const decline = () => {
    setConsent('declined')
    setVisible(false)
  }

  const pct = prog ? Math.round((prog.done / Math.max(1, prog.total)) * 100) : 0

  return (
    <AnimatePresence>
      {visible && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[55] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 280, damping: 24 }}
            className="vc-paper pointer-events-auto w-[min(560px,96vw)] rounded-2xl border-2 border-[#1c1a17] p-4 shadow-[5px_5px_0_rgba(28,26,23,0.8)]"
            role="dialog"
            aria-label="Save game files locally for faster loading"
          >
            {phase === 'ask' && (
              <div className="flex gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-[#1c1a17] bg-[#f2a541] shadow-[2px_2px_0_rgba(28,26,23,0.6)]">
                  <Cookie className="h-5 w-5 text-[#1c1a17]" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black uppercase tracking-tight text-[#1c1a17]">
                    Save the game files on this device?
                  </p>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-[#1c1a17]/75">
                    No tracking cookies here — with one tap VoteChor stores its 3D character
                    models (~0.8 MB) in your browser&apos;s local cache. Nothing leaves your
                    device; the game just loads instantly next time and saves your data.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={accept}
                      className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[#1c1a17] bg-[#f2a541] px-3 py-1.5 text-xs font-black uppercase tracking-tight text-[#1c1a17] shadow-[2px_2px_0_rgba(28,26,23,0.7)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
                    >
                      <HardDriveDownload className="h-3.5 w-3.5" aria-hidden /> Save locally
                    </button>
                    <button
                      onClick={decline}
                      className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[#1c1a17]/25 px-3 py-1.5 text-xs font-bold uppercase tracking-tight text-[#1c1a17]/60 transition-colors hover:border-[#1c1a17]/50 hover:text-[#1c1a17]"
                    >
                      Not now
                    </button>
                  </div>
                </div>
                <button
                  onClick={decline}
                  aria-label="Dismiss"
                  className="h-6 w-6 shrink-0 rounded-md text-[#1c1a17]/40 transition-colors hover:bg-[#1c1a17]/10 hover:text-[#1c1a17]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {phase === 'caching' && (
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[#8c1f28]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase tracking-tight text-[#1c1a17]">
                    Saving character models… {prog?.done ?? 0}/{prog?.total ?? SMALL_ASSET_URLS.length} · {fmtMB(prog?.bytes ?? 0)}
                  </p>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full border border-[#1c1a17]/20 bg-[#1c1a17]/10">
                    <div className="h-full rounded-full bg-[#f2a541] transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            )}

            {phase === 'done' && (
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-[#1c1a17] bg-[#7da556]">
                  <Check className="h-4 w-4 text-[#1c1a17]" strokeWidth={3.5} aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase tracking-tight text-[#1c1a17]">
                    Saved on this device ✓ — instant loads from now on
                  </p>
                  {!bigSaved && (
                    <button
                      onClick={saveBig}
                      disabled={bigBusy}
                      className="mt-1 text-[11px] font-bold text-[#8c1f28] underline decoration-dotted underline-offset-2 disabled:opacity-60"
                    >
                      {bigBusy ? 'Saving the big Protester model…' : 'Also save the big Protester model (24 MB)'}
                    </button>
                  )}
                  {bigSaved && (
                    <p className="mt-0.5 text-[11px] font-semibold text-[#1c1a17]/60">
                      All character files are stored locally · clear anytime via browser settings
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setVisible(false)}
                  aria-label="Close"
                  className="h-6 w-6 shrink-0 rounded-md text-[#1c1a17]/40 transition-colors hover:bg-[#1c1a17]/10 hover:text-[#1c1a17]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
