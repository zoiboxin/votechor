/**
 * Shared touch-capability probe (v46 mobile pass).
 * Single source of truth so every touch-gated surface (TouchControls, Hud hints,
 * QuickMessages toggle) agrees on one answer instead of each re-sniffing the UA.
 *
 * `window.__vcForceTouch` is a QA escape hatch: it lets automation (agent-browser)
 * mount the full touch HUD on a desktop-class headless browser to verify the
 * mobile layout end-to-end. It is read once at component mount, never persisted,
 * and does nothing unless explicitly set from the console.
 */
export function vcIsTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as { __vcForceTouch?: boolean }
  if (w.__vcForceTouch === true) return true
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}
