// VoteChor local asset cache — "save game files to my device" (task 97).
//
// The user asked for a cookie-style consent banner that, once accepted, stores
// the game's heavyweight 3D model files IN THE BROWSER (Cache API) and serves
// every later session straight from local disk — faster boots, less data, and
// instant character swaps. Zero tracking: the only things ever stored are the
// public /models/*.glb files, under a build-versioned cache name so a new
// deploy always fetches fresh bytes and old versions get purged.
//
// Everything degrades silently: no Cache API (old browsers / non-secure
// contexts / bun tests) → no consent storage → plain network loads, exactly
// the pre-feature behavior.
import { VC_BUILD } from './build-version'

const CONSENT_KEY = 'vc-asset-consent'
const CACHE_PREFIX = 'vc-assets-'

export const cacheName = () => `${CACHE_PREFIX}${VC_BUILD}`

/** The small character models (~5 MB total) — offered by the banner. */
export const SMALL_ASSET_URLS = [
  '/models/votechor-kid.glb',
  '/models/votechor-female.glb',
  '/models/votechor-male.glb',
  '/models/votechor-male-rigged.glb',
  '/models/votechor-human-male.glb',
  '/models/votechor-human-female.glb',
  '/models/votechor-human-child.glb',
  '/models/adventurer.glb',
  '/models/beach.glb',
] as const

/** The 24 MB textured protester hero — offered as an opt-in second step. */
export const BIG_ASSET_URLS = ['/models/votechor-male-skinned.glb'] as const

export type ConsentState = 'granted' | 'declined' | 'unset'

export function getConsent(): ConsentState {
  try {
    const v = localStorage.getItem(CONSENT_KEY)
    return v === 'granted' || v === 'declined' ? v : 'unset'
  } catch {
    return 'unset'
  }
}

export function setConsent(state: 'granted' | 'declined') {
  try { localStorage.setItem(CONSENT_KEY, state) } catch { /* private mode — session-only then */ }
}

const cachesApi = (): CacheStorage | null => {
  try {
    return typeof caches !== 'undefined' ? caches : null
  } catch {
    return null
  }
}

/** Delete asset caches from OLDER builds (keeps storage tidy across deploys). */
export async function purgeOldAssetCaches(): Promise<void> {
  const c = cachesApi()
  if (!c) return
  try {
    const current = cacheName()
    const names = await c.keys()
    await Promise.all(
      names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== current).map((n) => c.delete(n)),
    )
  } catch { /* never block boot on cache housekeeping */ }
}

export interface PrecacheProgress {
  done: number
  total: number
  bytes: number
  url: string
}

/** Fetch every URL into the versioned cache. Progress fires per finished file. */
export async function precacheAssets(
  urls: readonly string[],
  onProgress?: (p: PrecacheProgress) => void,
): Promise<{ ok: number; failed: number; bytes: number }> {
  const c = cachesApi()
  if (!c) return { ok: 0, failed: urls.length, bytes: 0 }
  let cache: Cache
  try { cache = await c.open(cacheName()) } catch { return { ok: 0, failed: urls.length, bytes: 0 } }
  let ok = 0
  let failed = 0
  let bytes = 0
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-cache' })
      if (!res.ok) throw new Error(String(res.status))
      const buf = await res.arrayBuffer()
      bytes += buf.byteLength
      // slice: the Response takes ownership of its copy, parse keeps using ours
      await cache.put(url, new Response(buf.slice(0), { headers: { 'content-type': res.headers.get('content-type') ?? 'model/gltf-binary' } }))
      ok++
    } catch {
      failed++
    }
    onProgress?.({ done: ok + failed, total: urls.length, bytes, url })
  }
  return { ok, failed, bytes }
}

/**
 * Cache-first asset fetch — the GLBAssetManager's fast path once consent is
 * granted. Returns null whenever the cache path can't serve (no consent, no
 * Cache API, fetch failure) and the caller falls back to its normal loader.
 */
export async function fetchAssetBuffer(url: string): Promise<ArrayBuffer | null> {
  if (getConsent() !== 'granted') return null
  const c = cachesApi()
  if (!c) return null
  try {
    const cache = await c.open(cacheName())
    const hit = await cache.match(url)
    if (hit) return await hit.arrayBuffer()
    // consented but not precached yet — fetch now and store for next time
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    try { await cache.put(url, new Response(buf.slice(0))) } catch { /* quota — ignore */ }
    return buf
  } catch {
    return null
  }
}

/** How much is currently cached (banner status display). */
export async function cachedAssetInfo(urls: readonly string[] = SMALL_ASSET_URLS): Promise<{ count: number; bytes: number }> {
  const c = cachesApi()
  if (!c) return { count: 0, bytes: 0 }
  try {
    const cache = await c.open(cacheName())
    let count = 0
    let bytes = 0
    for (const url of urls) {
      const hit = await cache.match(url)
      if (hit) {
        count++
        bytes += Number(hit.headers.get('content-length') ?? 0)
      }
    }
    return { count, bytes }
  } catch {
    return { count: 0, bytes: 0 }
  }
}
