// v94 — SAME-ORIGIN GAME-SERVER RELAY (catch-all proxy).
//
// WHY: socket.io needs either a direct port (http://host:3002) or a reverse
// proxy on the page's own origin. Direct :3002 is blocked in some sandboxed /
// locked-down browser environments, and plain-Node relays (server.js) only
// exist in production. This Next.js route relays socket.io POLLING traffic to
// the authoritative game server over the SAME origin the page loaded from —
// zero CORS, zero extra ports, works in dev AND production.
//
// WebSocket upgrades can NOT pass through Next route handlers, so this relay
// serves the polling transport (the client's default first transport anyway);
// direct :3002 / server.js relay paths still upgrade to websocket when
// available and always win in candidate order.
//
// Client speaks:  /api/gs-relay/?EIO=4&transport=polling&...
// Relayed to:     http://127.0.0.1:3002/gs/?EIO=4&transport=polling&...
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const GAME_HOST = process.env.VC_GAME_RELAY_HOST || '127.0.0.1'
const GAME_PORT = parseInt(process.env.VC_GAME_RELAY_PORT || '3002', 10)

async function relay(req: NextRequest, method: 'GET' | 'POST' | 'PUT' | 'OPTIONS') {
  const incoming = new URL(req.url)
  const target = `http://${GAME_HOST}:${GAME_PORT}/gs/${incoming.search}`
  try {
    const upstream = await fetch(target, {
      method,
      headers: (() => {
        const h = new Headers()
        const ct = req.headers.get('content-type')
        if (ct) h.set('content-type', ct)
        // engine.io session stickiness cookie, if any
        const ck = req.headers.get('cookie')
        if (ck) h.set('cookie', ck)
        return h
      })(),
      body: method === 'GET' || method === 'OPTIONS' ? undefined : await req.arrayBuffer(),
      cache: 'no-store',
    })
    const resHeaders = new Headers()
    upstream.headers.forEach((v, k) => {
      // hop-by-hop / encoding headers must not be forwarded manually
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k.toLowerCase())) {
        resHeaders.set(k, v)
      }
    })
    resHeaders.set('x-gs-relay', 'next')
    return new Response(upstream.body, { status: upstream.status, headers: resHeaders })
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'game-server-unreachable' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }
}

export async function GET(req: NextRequest) { return relay(req, 'GET') }
export async function POST(req: NextRequest) { return relay(req, 'POST') }
export async function PUT(req: NextRequest) { return relay(req, 'PUT') }
export async function OPTIONS(req: NextRequest) { return relay(req, 'OPTIONS') }
