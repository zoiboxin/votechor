// VoteChor player identity — deterministic human-friendly ID derived from the secret token.
// The DB token is a secret (auth); the short ID is a PUBLIC identifier players can share,
// quote on leaderboards and use to find their profile. Pure + shared client/server.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // unambiguous set (no I/L/O/0/1)

/**
 * shortIdFromToken — "VC-XXXX-XXXX" derived from the player's secret token.
 * Same token always yields the same ID (FNV-1a seeded LCG keeps it stable
 * across sessions and between server + client without shipping the token).
 */
export function shortIdFromToken(token: string | null | undefined): string {
  if (!token) return 'VC-????-????'
  // FNV-1a 32-bit seed
  let h = 0x811c9dc5
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // LCG expansion → 8 chars from the unambiguous alphabet
  let s = h >>> 0
  let out = ''
  for (let i = 0; i < 8; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    out += ALPHABET[s % ALPHABET.length]
    if (i === 3) out += '-'
  }
  return `VC-${out.slice(0, 4)}-${out.slice(5)}`
}

/** Runtime guard for API payloads — only these two roles exist. */
export type PlayerRole = 'protector' | 'police'

export function sanitizeRole(v: unknown): PlayerRole {
  return v === 'police' ? 'police' : 'protector'
}
