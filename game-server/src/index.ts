import 'dotenv/config'
import { verifyMessage } from 'ethers'
import http from 'http'
import { randomBytes } from 'crypto'
import { logger } from './logger'

const PORT = parseInt(process.env.PORT ?? '3001')

// ── In-memory error ring buffer (last 100 errors) ──────────────────────────────
const errorLog: { ts: string; event: string; data: unknown }[] = []
export function recordError(event: string, data: unknown): void {
    errorLog.push({ ts: new Date().toISOString(), event, data })
    if (errorLog.length > 100) errorLog.shift()
}

// ── HTTP server ────────────────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
    const url = req.url ?? ''

    if (url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', ts: Date.now(), uptime: process.uptime() }))
        return
    }

    // GET /errors — recent error log (protected by GAME_SERVER_SECRET header)
    if (url === '/errors') {
        const secret = req.headers['x-internal-secret']
        if (!process.env.GAME_SERVER_SECRET || secret !== process.env.GAME_SERVER_SECRET) {
            res.writeHead(401)
            res.end('Unauthorized')
            return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(errorLog))
        return
    }

    res.writeHead(404)
    res.end()
})

// WebSocket server attached to the same HTTP server
import WebSocket, { WebSocketServer } from 'ws'
import { GameLoop } from './gameLoop'
import { getBalance } from './db'

// ── Per-connection rate limit ─────────────────────────────────────────────────
const MSG_RATE_MAX    = 30   // max messages per window
const MSG_RATE_WINDOW = 10_000  // 10 second window

// ── Per-IP connection limit ───────────────────────────────────────────────────
const MAX_CONNS_PER_IP = 5   // max simultaneous WebSocket connections from one IP

// ── Per-IP auth attempt limit (defence in depth on top of per-conn limit) ─────
// Each IP can attempt at most 20 auth messages within a 1-minute window before
// new auth requests from that IP are rejected. This prevents an attacker from
// cycling through 5 sockets per IP and bypassing the per-socket counter.
const AUTH_IP_RATE_MAX     = 20
const AUTH_IP_RATE_WINDOW  = 60_000
const ipAuthCounter = new Map<string, { count: number; windowStart: number }>()

// ── Client registry ─────────────────────────────────────────────────────────────

interface Client {
    ws: WebSocket
    wallet: string | null
    ip: string
    isAlive: boolean
    authenticated: boolean
    /** Server-issued challenge nonce for auth — unique per connection */
    challenge: string
    /** Rate limiting */
    msgCount: number
    msgWindowStart: number
    /** Auth attempt limiting — disconnect after too many failures */
    authFailures: number
}

const MAX_AUTH_FAILURES = 3   // disconnect after this many bad auth attempts

const clients = new Map<WebSocket, Client>()
const walletSockets = new Map<string, WebSocket>()
/** Track how many open connections exist per IP */
const ipConnCount = new Map<string, number>()

function send(ws: WebSocket, msg: object): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function broadcast(msg: object): void {
    const raw = JSON.stringify(msg)
    for (const [ws] of clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(raw)
    }
}

function sendTo(wallet: string, msg: object): void {
    const ws = walletSockets.get(wallet.toLowerCase())
    if (ws) send(ws, msg)
}

// ── Game loop ──────────────────────────────────────────────────────────────────

const gameLoop = new GameLoop(broadcast, sendTo)

// ── Signature verification (direct EIP-191 — no HTTP round-trip needed) ─────────

function verifyWsAuth(wallet: string, nonce: string, signature: string): boolean {
    try {
        const message = `Glitch Flight Auth: ${nonce}`
        const recovered = verifyMessage(message, signature)
        return recovered.toLowerCase() === wallet.toLowerCase()
    } catch (e: any) {
        logger.error('verify_ws_auth_failed', { error: e.message })
        return false
    }
}

// ── Message handlers ────────────────────────────────────────────────────────────

async function handleAuth(
    client: Client,
    payload: { wallet: string; nonce?: string; signature?: string }
): Promise<void> {
    // ── Per-IP auth rate limit ────────────────────────────────────────────
    const now = Date.now()
    const ipState = ipAuthCounter.get(client.ip)
    if (!ipState || now - ipState.windowStart > AUTH_IP_RATE_WINDOW) {
        ipAuthCounter.set(client.ip, { count: 1, windowStart: now })
    } else {
        ipState.count++
        if (ipState.count > AUTH_IP_RATE_MAX) {
            logger.warn('ws_auth_ip_rate_limit', { ip: client.ip, count: ipState.count })
            send(client.ws, { type: 'error', msg: 'Too many auth attempts from this IP — try again later' })
            client.ws.terminate()
            return
        }
    }

    const wallet = payload.wallet?.toLowerCase()
    if (!wallet || !/^0x[0-9a-f]{40}$/i.test(wallet)) {
        send(client.ws, { type: 'error', msg: 'Invalid wallet address' })
        return
    }

    // Verify the challenge signature
    if (!payload.nonce || !payload.signature) {
        send(client.ws, { type: 'error', msg: 'Signature required — sign the challenge to authenticate' })
        return
    }

    // Nonce must match the server-issued challenge for this connection
    if (payload.nonce !== client.challenge) {
        send(client.ws, { type: 'error', msg: 'Invalid nonce' })
        return
    }

    const isValid = verifyWsAuth(wallet, payload.nonce, payload.signature)
    if (!isValid) {
        client.authFailures++
        logger.warn('ws_auth_rejected', { wallet: wallet.slice(0, 10), failures: client.authFailures })
        if (client.authFailures >= MAX_AUTH_FAILURES) {
            send(client.ws, { type: 'error', msg: 'Too many failed auth attempts — disconnecting' })
            client.ws.terminate()
            return
        }
        send(client.ws, { type: 'error', msg: 'Auth failed — invalid signature' })
        return
    }

    // ── Kill any existing zombie connection for this wallet ──────────────────
    const existingWs = walletSockets.get(wallet)
    if (existingWs && existingWs !== client.ws) {
        logger.info('ws_zombie_cleanup', { wallet: wallet.slice(0, 10) })
        const oldClient = clients.get(existingWs)
        if (oldClient) oldClient.wallet = null
        existingWs.terminate()
        clients.delete(existingWs)
    }

    // De-register old wallet if re-authing as a different one
    if (client.wallet && client.wallet !== wallet) {
        walletSockets.delete(client.wallet)
    }

    client.wallet = wallet
    client.authenticated = true
    walletSockets.set(wallet, client.ws)

    const balance = await getBalance(wallet)
    const state = gameLoop.getPublicState()
    const bet = gameLoop.getState().bets.get(wallet)
    send(client.ws, {
        type: 'auth_ok',
        wallet,
        balance,
        gameState: state,
        hasBet: !!bet,
        betAmount: bet?.amount ?? null,
        cashedOutAt: bet?.cashedOutAt ?? null,
    })
    logger.info('ws_auth', { wallet: wallet.slice(0, 10), balance, phase: state.phase, hasBet: !!bet })
}

async function handleBet(client: Client, payload: { amount: number }): Promise<void> {
    if (!client.wallet || !client.authenticated) { send(client.ws, { type: 'error', msg: 'Auth required' }); return }
    const amount = Number(payload.amount)
    if (!amount || amount <= 0) { send(client.ws, { type: 'error', msg: 'Invalid amount' }); return }

    const result = await gameLoop.placeBet(client.wallet, amount)
    if (!result.ok) {
        logger.warn('bet_rejected', { wallet: client.wallet.slice(0, 10), amount, reason: result.error })
        send(client.ws, { type: 'error', msg: result.error })
        return
    }
    send(client.ws, { type: 'bet_ok', amount, newBalance: result.newBalance })
}

async function handleCashout(client: Client): Promise<void> {
    if (!client.wallet || !client.authenticated) { send(client.ws, { type: 'error', msg: 'Auth required' }); return }
    const result = await gameLoop.cashout(client.wallet)
    if (!result.ok) {
        logger.warn('cashout_rejected', { wallet: client.wallet.slice(0, 10), reason: result.error })
        send(client.ws, { type: 'error', msg: result.error })
        return
    }
    send(client.ws, { type: 'cashout_ok', at: result.at, profit: result.profit, xpGained: result.xpGained, newBalance: result.newBalance })
}

// ── WebSocket setup ─────────────────────────────────────────────────────────────

// maxPayload: reject messages larger than 4KB — prevents CPU/memory DoS from giant JSON blobs
const wss = new WebSocketServer({ server: httpServer, maxPayload: 4 * 1024 })

setInterval(() => {
    for (const [ws, client] of clients) {
        if (!client.isAlive) {
            ws.terminate()
            if (client.wallet) walletSockets.delete(client.wallet)
            const prev = ipConnCount.get(client.ip) ?? 1
            if (prev <= 1) ipConnCount.delete(client.ip)
            else ipConnCount.set(client.ip, prev - 1)
            clients.delete(ws)
            continue   // was `return` — bug: exited the whole interval, leaving dead connections uncleaned
        }
        client.isAlive = false
        ws.ping()
    }

    // GC expired auth rate-limit entries to prevent unbounded growth
    const now = Date.now()
    for (const [ip, state] of ipAuthCounter) {
        if (now - state.windowStart > AUTH_IP_RATE_WINDOW * 2) {
            ipAuthCounter.delete(ip)
        }
    }
}, 30_000)

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    // ── Enforce TLS in production via x-forwarded-proto from the proxy.
    //    Set REQUIRE_TLS=1 in Railway/Cloud Run/etc. to harden against
    //    accidental ws:// rollouts where MITM could rewrite bet/cashout.
    if (process.env.REQUIRE_TLS === '1') {
        const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0].trim()
        if (proto && proto !== 'https' && proto !== 'wss') {
            logger.warn('ws_reject_non_tls', { proto })
            ws.close(1008, 'TLS required')
            return
        }
    }

    // Extract client IP (behind Railway/nginx proxy)
    const ip = (req.headers['x-forwarded-for'] as string ?? req.socket.remoteAddress ?? 'unknown')
        .split(',')[0].trim()

    // ── Per-IP connection limit ───────────────────────────────────────────────
    const currentCount = ipConnCount.get(ip) ?? 0
    if (currentCount >= MAX_CONNS_PER_IP) {
        logger.warn('ws_conn_limit_reached', { ip, count: currentCount })
        ws.close(1008, 'Too many connections from your IP')
        return
    }
    ipConnCount.set(ip, currentCount + 1)

    // Issue a unique challenge nonce for this connection
    const challenge = randomBytes(16).toString('hex')
    const client: Client = {
        ws,
        wallet: null,
        ip,
        isAlive: true,
        authenticated: false,
        challenge,
        msgCount: 0,
        msgWindowStart: Date.now(),
        authFailures: 0,
    }
    clients.set(ws, client)

    ws.on('pong', () => { client.isAlive = true })

    // Send initial game state + challenge nonce
    send(ws, { type: 'state', gameState: gameLoop.getPublicState() })
    send(ws, { type: 'challenge', nonce: challenge })

    ws.on('message', async (raw: Buffer) => {
        // ── Per-connection rate limiting ──────────────────────────────────────
        const now = Date.now()
        if (now - client.msgWindowStart > MSG_RATE_WINDOW) {
            client.msgCount = 0
            client.msgWindowStart = now
        }
        client.msgCount++
        if (client.msgCount > MSG_RATE_MAX) {
            send(ws, { type: 'error', msg: 'Too many messages — slow down' })
            return
        }

        let msg: { type: string; [k: string]: unknown }
        try { msg = JSON.parse(raw.toString()) }
        catch { send(ws, { type: 'error', msg: 'Invalid JSON' }); return }

        // ── Auth gate: only auth and ping allowed before authentication ───────
        if (!client.authenticated && msg.type !== 'auth' && msg.type !== 'ping') {
            send(ws, { type: 'error', msg: 'Authentication required' })
            return
        }

        switch (msg.type) {
            case 'auth':     await handleAuth(client, msg as any); break
            case 'bet':      await handleBet(client, msg as any); break
            case 'cashout':  await handleCashout(client); break
            case 'ping':     send(ws, { type: 'pong' }); break
            default:         send(ws, { type: 'error', msg: `Unknown: ${msg.type}` })
        }
    })

    ws.on('close', () => {
        const c = clients.get(ws)
        if (c?.wallet) walletSockets.delete(c.wallet)
        // Decrement per-IP counter
        const prev = ipConnCount.get(ip) ?? 1
        if (prev <= 1) ipConnCount.delete(ip)
        else ipConnCount.set(ip, prev - 1)
        clients.delete(ws)
    })

    ws.on('error', (e: Error) => {
        logger.error('ws_socket_error', { wallet: client.wallet, error: e.message })
        recordError('ws_socket_error', e.message)
    })
})

// ── Start ───────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, '0.0.0.0', async () => {
    logger.info('server_start', { port: PORT })
    try {
        await gameLoop.start()
    } catch (e: any) {
        logger.error('game_loop_fatal', { error: e.message })
        recordError('game_loop_fatal', e.message)
        process.exit(1)
    }
})

httpServer.on('error', (e: Error) => {
    logger.error('http_fatal', { error: e.message })
    process.exit(1)
})

process.on('uncaughtException', (e: Error) => {
    logger.error('uncaught_exception', { error: e.message, stack: e.stack })
    recordError('uncaught_exception', e.message)
})
process.on('unhandledRejection', (reason: unknown) => {
    logger.error('unhandled_rejection', { reason: String(reason) })
    recordError('unhandled_rejection', String(reason))
})
