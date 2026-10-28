/**
 * Single source of truth for the client bundle version.
 *
 * WHY THIS EXISTS: the reported "everything looks blue — no buildings or roads"
 * bug kept recurring while every shipped fix verified green in QA. The strongest
 * surviving explanation is a STALE client tab (preview panel / long-lived tab
 * whose HMR socket died) still running pre-fix code. This module lets the app
 * detect that condition itself:
 *
 *   - The value below is compiled INTO the client bundle at load time.
 *   - GET /api/version imports the same constant from the CURRENT server code.
 *   - If the two disagree, the tab is running an old build → a visible
 *     "New version available — tap to refresh" banner appears (GameRoot).
 *
 * Bump VC_BUILD every round that ships client changes. A user screenshot that
 * lacks the current tag instantly identifies a stale bundle.
 */
export const VC_BUILD = 'v114'
