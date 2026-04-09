import 'dotenv/config'
import http from 'http'
import { createWsServer } from './wsServer'
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

    // GET /errors — recent error log (protected by INTERNAL_SECRET header)
    if (url === '/errors') {
        const secret = req.headers['x-internal-secret']
        if (!process.env.INTERNAL_SECRET || secret !== process.env.INTERNAL_SECRET) {
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

// ── Client registry ─────────────────────────────────────────────────────────────

interface Client {
    ws: WebSocket
    wallet: string | null
    isAlive: boolean
}

const clients = new Map<WebSocket, Client>()
const walletSockets = new Map<string, WebSocket>()

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

// ── Message handlers ────────────────────────────────────────────────────────────

async function handleAuth(client: Client, payload: { wallet: string }): Promise<void> {
    const wallet = payload.wallet?.toLowerCase()
    if (!wallet || !/^0x[0-9a-f]{40}$/i.test(wallet)) {
        send(client.ws, { type: 'error', msg: 'Invalid wallet address' })
        return
    }
    if (client.wallet) walletSockets.delete(client.wallet)
    client.wallet = wallet
    walletSockets.set(wallet, client.ws)

    const balance = await getBalance(wallet)
    const state = gameLoop.getPublicState()
    send(client.ws, { type: 'auth_ok', wallet, balance, gameState: state })
    logger.info('ws_auth', { wallet: wallet.slice(0, 10), balance, phase: state.phase })
}

async function handleBet(client: Client, payload: { amount: number }): Promise<void> {
    if (!client.wallet) { send(client.ws, { type: 'error', msg: 'Auth required' }); return }
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
    if (!client.wallet) { send(client.ws, { type: 'error', msg: 'Auth required' }); return }
    const result = await gameLoop.cashout(client.wallet)
    if (!result.ok) {
        logger.warn('cashout_rejected', { wallet: client.wallet.slice(0, 10), reason: result.error })
        send(client.ws, { type: 'error', msg: result.error })
        return
    }
    send(client.ws, { type: 'cashout_ok', at: result.at, profit: result.profit, xpGained: result.xpGained, newBalance: result.newBalance })
}

// ── WebSocket setup ─────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer })

setInterval(() => {
    for (const [ws, client] of clients) {
        if (!client.isAlive) {
            ws.terminate()
            clients.delete(ws)
            if (client.wallet) walletSockets.delete(client.wallet)
            return
        }
        client.isAlive = false
        ws.ping()
    }
}, 30_000)

wss.on('connection', (ws: WebSocket) => {
    const client: Client = { ws, wallet: null, isAlive: true }
    clients.set(ws, client)

    ws.on('pong', () => { client.isAlive = true })

    // Send current state on connect
    send(ws, { type: 'state', gameState: gameLoop.getPublicState() })

    ws.on('message', async (raw: Buffer) => {
        let msg: { type: string;[k: string]: unknown }
        try { msg = JSON.parse(raw.toString()) }
        catch { send(ws, { type: 'error', msg: 'Invalid JSON' }); return }

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
