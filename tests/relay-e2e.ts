/**
 * Relay E2E test (v94 hardening QA) — replicates server.js's /gs/ relay
 * (HTTP polling + raw-TCP WS upgrade) on port 3011, then connects a REAL
 * socket.io client exactly like src/game/net.ts does and performs a full
 * game:join against the live game server on 3002.
 *
 * Test A: through the relay  (user path: page on :3000 → same-origin /gs/)
 * Test B: direct :3002       (user path: local-direct candidate)
 */
import http from 'http'
import net from 'net'
import type { Duplex } from 'stream'
import { io, type Socket } from 'socket.io-client'

const GAME_HOST = '127.0.0.1'
const GAME_PORT = 3002
const RELAY_PORT = 3011

function isGamePath(url?: string) {
  const u = url || '/'
  if (u === '/gs' || u.startsWith('/gs/') || u.startsWith('/gs?')) return true
  // v94 — legacy socket.io clients (pre-v92 bundles) speak at '/': relay them too
  return u.includes('EIO=')
}

// ---- verbatim relayHttp from server.js ----
function relayHttp(req: http.IncomingMessage, res: http.ServerResponse) {
  const options = {
    hostname: GAME_HOST,
    port: GAME_PORT,
    path: req.url,
    method: req.method,
    headers: Object.assign({}, req.headers, { host: `${GAME_HOST}:${GAME_PORT}` }),
  }
  const upstream = http.request(options, (up) => {
    res.writeHead(up.statusCode || 502, up.headers)
    up.pipe(res)
  })
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' })
    try { res.end(JSON.stringify({ ok: false, error: 'game-server-unreachable' })) } catch { /* gone */ }
  })
  req.pipe(upstream)
}

// ---- verbatim relayWs from server.js (raw TCP) ----
function relayWs(req: http.IncomingMessage, sock: Duplex, head: Buffer) {
  const upstream = net.connect(GAME_PORT, GAME_HOST, () => {
    try {
      const parts = [`${req.method} ${req.url} HTTP/1.1`]
      const rh = req.rawHeaders || []
      for (let i = 0; i < rh.length; i += 2) parts.push(`${rh[i]}: ${rh[i + 1]}`)
      const raw = parts.join('\r\n') + '\r\n\r\n'
      upstream.write(raw)
      if (head && head.length) upstream.write(head)
      upstream.pipe(sock)
      sock.pipe(upstream)
    } catch { cleanup() }
  })
  const cleanup = () => { try { upstream.destroy() } catch {}; try { sock.destroy() } catch {} }
  upstream.on('error', cleanup)
  sock.on('error', cleanup)
  upstream.on('close', () => { try { sock.destroy() } catch {} })
  sock.on('close', () => { try { upstream.destroy() } catch {} })
}

interface Result {
  label: string
  connected: boolean
  wsUpgraded: boolean
  joined: boolean
  players: number
  npcs: number
  seasonBots: number
  error: string
}

function runClient(label: string, url: string, ms = 12000, socketPath = '/gs/'): Promise<Result> {
  return new Promise((resolve) => {
    const out: Result = { label, connected: false, wsUpgraded: false, joined: false, players: 0, npcs: 0, seasonBots: 0, error: '' }
    const socket: Socket = io(url, {
      path: socketPath,
      transports: ['polling', 'websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 6000,
    })
    const done = () => { try { socket.disconnect() } catch {}; resolve(out) }
    const timer = setTimeout(() => { if (!out.error) out.error = 'timeout'; done() }, ms)
    socket.on('connect', () => {
      out.connected = true
      out.wsUpgraded = socket.io.engine.transport.name === 'websocket'
      socket.io.engine.on('upgrade', () => { out.wsUpgraded = true })
      socket.emit('game:join', { name: `RelayQA-${label}`, archetype: 'student', roomCode: null, season: true })
    })
    socket.on('game:joined', (ack: { ok: boolean; players?: unknown[]; npcs?: unknown[]; season?: { bots?: number } | null }) => {
      out.joined = !!ack.ok
      out.players = ack.players?.length ?? 0
      out.npcs = ack.npcs?.length ?? 0
      out.seasonBots = ack.season?.bots ?? 0
      clearTimeout(timer)
      setTimeout(done, 800) // give the WS upgrade a moment to fire too
    })
    socket.on('connect_error', (err: Error) => { out.error = err.message; clearTimeout(timer); done() })
    socket.on('disconnect', (reason: string) => { if (!out.joined) { out.error = out.error || reason; clearTimeout(timer); done() } })
  })
}

async function main() {
  const server = http.createServer((req, res) => {
    if (isGamePath(req.url)) return relayHttp(req, res)
    res.writeHead(404); res.end('not-game-path')
  })
  server.on('upgrade', (req, sock, head) => {
    if (isGamePath(req.url)) return relayWs(req, sock, head)
    try { sock.destroy() } catch {}
  })
  await new Promise<void>((r) => server.listen(RELAY_PORT, '127.0.0.1', r))

  const only = process.argv[2] // optional label filter: bun tests/relay-e2e.ts legacy-relay
  const run = (label: string, url: string, socketPath = '/gs/') =>
    (!only || label === only) ? runClient(label, url, 12000, socketPath) : Promise.resolve(null)

  const a = await run('relay-3011', `http://127.0.0.1:${RELAY_PORT}`) as Result | null
  if (a) console.log('[A relay ]', JSON.stringify(a))
  const b = await run('direct-3002', `http://${GAME_HOST}:${GAME_PORT}`) as Result | null
  if (b) console.log('[B direct]', JSON.stringify(b))
  // v94 — LEGACY-PATH regression: a pre-v92 client bundle speaks socket.io at
  // '/' (both direct and through the relay). The game server must rewrite
  // /?EIO=... → /gs/?EIO=... so these clients can never go offline again.
  const c = await run('legacy-direct', `http://${GAME_HOST}:${GAME_PORT}`, '/') as Result | null
  if (c) console.log('[C legacy-direct]', JSON.stringify(c))
  const d = await run('legacy-relay', `http://127.0.0.1:${RELAY_PORT}`, '/') as Result | null
  if (d) console.log('[D legacy-relay ]', JSON.stringify(d))
  const pass = [a, b, c, d].every((r) => !r || (r.connected && r.joined))
  console.log(pass ? 'RELAY-E2E: ALL PASS' : 'RELAY-E2E: FAIL')
  server.close()
  process.exit(pass ? 0 : 1)
}

main().catch((e) => { console.error('fatal', e); process.exit(1) })
