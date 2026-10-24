/**
 * E2E — the professional human body selection syncs through the game server:
 * A joins a private room with cosmetics.body='human' (male) / B with
 * 'human-child' (female); both must appear in each other's room broadcast
 * (game:playerjoined, positional args) with the RIGHT body value, and the join
 * ack's roster must echo the sanitized body back.
 *
 * Usage: bun tests/human-body-e2e.ts
 */
import { io, type Socket } from 'socket.io-client'

const GAME_HOST = process.env.GAME_HOST ?? '127.0.0.1'
const GAME_PORT = process.env.GAME_PORT ?? '3002'
const URL = `http://${GAME_HOST}:${GAME_PORT}`
const PATH = '/gs/socket.io'
const ROOM = 'HUMANQA'

interface Res { connected: boolean; ackBody: string | null; sawPartner: string | null; error: string }

function client(label: string, body: string, partnerLabel: string, ms = 12000): Promise<Res> {
  return new Promise((resolve) => {
    const out: Res = { connected: false, ackBody: null, sawPartner: null, error: '' }
    const socket: Socket = io(URL, { path: PATH, transports: ['polling', 'websocket'], forceNew: true, reconnection: false, timeout: 6000 })
    const done = () => { try { socket.disconnect() } catch {}; resolve(out) }
    const timer = setTimeout(() => { if (!out.error) out.error = 'timeout'; done() }, ms)
    socket.on('connect', () => {
      out.connected = true
      socket.emit('game:join', {
        name: `HumanQA-${label}`,
        archetype: 'student',
        roomCode: ROOM,
        cosmetics: { body, gender: body === 'human-child' ? 'female' : 'male' },
      })
    })
    socket.on('game:joined', (ack: { ok?: boolean; playerId?: string; players?: { id: string; name?: string; cosmetics?: Record<string, unknown> }[] }) => {
      if (!ack?.ok) { out.error = `ack not ok: ${JSON.stringify(ack).slice(0, 80)}`; return }
      const me = (ack.players ?? []).find((p) => p.id === ack.playerId)
      out.ackBody = typeof me?.cosmetics?.body === 'string' ? (me.cosmetics.body as string) : null
      // late joiner: the partner is already in the roster — read them from here
      const partner = (ack.players ?? []).find((p) => p.name === `HumanQA-${partnerLabel}`)
      if (partner && typeof partner.cosmetics?.body === 'string') {
        out.sawPartner = partner.cosmetics.body as string
        clearTimeout(timer)
        setTimeout(done, 400)
      }
    })
    // room broadcast for the partner join: (id, name, archetype, cosmetics, role)
    socket.on('game:playerjoined', (_id: string, name: string, _arch: string, cosmetics?: Record<string, unknown>) => {
      if (name === `HumanQA-${partnerLabel}`) {
        out.sawPartner = typeof cosmetics?.body === 'string' ? (cosmetics.body as string) : null
        clearTimeout(timer)
        setTimeout(done, 400)
      }
    })
    socket.on('connect_error', (err: Error) => { out.error = err.message; clearTimeout(timer); done() })
  })
}

async function main() {
  // A joins first; B joins 600ms later so A receives the playerjoined broadcast
  const aP = client('A', 'human', 'B')
  await new Promise((r) => setTimeout(r, 600))
  const bP = client('B', 'human-child', 'A')
  const [a, b] = await Promise.all([aP, bP])
  console.log('[A human       ]', JSON.stringify(a))
  console.log('[B human-child ]', JSON.stringify(b))
  const okA = a.connected && a.ackBody === 'human' && a.sawPartner === 'human-child'
  const okB = b.connected && b.ackBody === 'human-child' && b.sawPartner === 'human'
  console.log(okA && okB ? 'BODY-SYNC PASS' : 'BODY-SYNC FAIL')
  process.exit(okA && okB ? 0 : 1)
}
void main()
