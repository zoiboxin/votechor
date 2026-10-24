/* eslint-disable @typescript-eslint/no-require-imports */
// VoteChor production web server — Next.js AND game-server traffic on ONE port.
//
// WHY THIS EXISTS: when the site is exposed through a Cloudflare Tunnel (or any
// single-hostname reverse proxy), only ONE local port can be published. The
// authoritative game server (bots, crowd, cars, zombies, player sync) listens
// on 127.0.0.1:3002 — a port Cloudflare's edge can NEVER expose (it only
// proxies a fixed port list: 80/8080/8880/2052/2082/2086/2095 and
// 443/2053/2083/2087/2096/8443). So this server relays every /gs/* request —
// HTTP long-polling AND WebSocket upgrades — to the game server, and the
// browser reaches multiplayer through the SAME origin it loaded the page from.
// One hostname, one port, zero CORS, TLS handled by Cloudflare.
//
// Used by run-web-server.bat:   bun server.js   (with NODE_ENV=production)
// Dev mode also works:          bun server.js   (NODE_ENV unset → next dev)
//
// Environment:
//   PORT                 listen port            (default 3000)
//   HOSTNAME             bind address           (default 0.0.0.0)
//   NODE_ENV             "production" → next({ dev: false })
//   VC_GAME_RELAY_HOST   game server host       (default 127.0.0.1)
//   VC_GAME_RELAY_PORT   game server port       (default 3002)

'use strict'

const http = require('http')
const net = require('net')
const next = require('next')

const PORT = parseInt(process.env.PORT || '3000', 10)
const HOST = process.env.HOSTNAME || '0.0.0.0'
const DEV = process.env.NODE_ENV !== 'production'
const GAME_HOST = process.env.VC_GAME_RELAY_HOST || '127.0.0.1'
const GAME_PORT = parseInt(process.env.VC_GAME_RELAY_PORT || '3002', 10)

// The socket.io path on BOTH ends is '/gs/' (see src/game/net.ts and
// mini-services/game-server/index.ts). Match /gs, /gs/... and /gs?...
function isGamePath(url) {
  const u = url || '/'
  return u === '/gs' || u.startsWith('/gs/') || u.startsWith('/gs?')
}

// v94 — LEGACY CLIENTS: bundles built before v92 speak socket.io at '/' (the
// old path), e.g. GET /?EIO=4&transport=polling — the game server rewrites
// those to /gs/ on its side, so route ANY engine.io-looking request to the
// relay too. Without this, a stale client bundle gets Next.js 404s (polling)
// and destroyed sockets (WS) → "offline, 0 crowd" even though both servers
// are perfectly healthy.
function looksLikeEngineIo(url) {
  return (url || '').includes('EIO=')
}

// ---------- HTTP relay (socket.io long-polling + handshakes) ----------
function relayHttp(req, res) {
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
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
    }
    try { res.end(JSON.stringify({ ok: false, error: 'game-server-unreachable' })) } catch { /* socket gone */ }
  })
  req.pipe(upstream)
}

// ---------- WebSocket relay (socket.io websocket transport) ----------
// Implemented as a RAW TCP relay: the browser's upgrade request is forwarded
// byte-for-byte to the game server and the two sockets are piped together.
// This deliberately avoids http.request's 'upgrade' event, which Bun does not
// reliably emit — a TCP relay behaves identically under Node and Bun.
function relayWs(req, sock, head) {
  const upstream = net.connect(GAME_PORT, GAME_HOST, () => {
    try {
      // Rebuild the raw request line + headers EXACTLY as received
      // (rawHeaders preserves original casing/order — 'ws' on the game server
      // needs the Sec-WebSocket-* headers verbatim).
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
  const cleanup = () => { try { upstream.destroy() } catch {} ; try { sock.destroy() } catch {} }
  upstream.on('error', cleanup)
  sock.on('error', cleanup)
  upstream.on('close', () => { try { sock.destroy() } catch {} })
  sock.on('close', () => { try { upstream.destroy() } catch {} })
}

const app = next({ dev: DEV, hostname: HOST, port: PORT })

app.prepare().then(() => {
  // Handlers must be resolved AFTER prepare() (Next 16 throws otherwise).
  const handle = app.getRequestHandler()
  // Next's own upgrade handler (dev HMR websocket); guarded for future API changes.
  const handleUpgrade = typeof app.getUpgradeHandler === 'function' ? app.getUpgradeHandler() : null
  const server = http.createServer((req, res) => {
    if (isGamePath(req.url) || looksLikeEngineIo(req.url)) return relayHttp(req, res)
    return handle(req, res)
  })
  server.on('upgrade', (req, sock, head) => {
    if (isGamePath(req.url) || looksLikeEngineIo(req.url)) return relayWs(req, sock, head)
    if (handleUpgrade) return handleUpgrade(req, sock, head)
    try { sock.destroy() } catch {}
  })
  server.listen(PORT, HOST, () => {
    console.log(`[votechor] web server ready on http://${HOST}:${PORT} (${DEV ? 'dev' : 'production'})`)
    console.log(`[votechor] /gs/* is relayed to the game server at ${GAME_HOST}:${GAME_PORT}`)
  })
}).catch((err) => {
  console.error('[votechor] fatal: web server failed to start:', err)
  process.exit(1)
})
