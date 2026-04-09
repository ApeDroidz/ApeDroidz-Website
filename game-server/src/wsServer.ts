import WebSocket, { WebSocketServer } from 'ws'
import { GameLoop } from './gameLoop'
import { getBalance } from './db'

// ── Client registry ────────────────────────────────────────────────────────────

interface Client {
    ws: WebSocket
    wallet: string | null
    isAlive: boolean
}

const clients = new Map<WebSocket, Client>()

// wallet → WebSocket (for sendTo)
const walletSockets = new Map<string, WebSocket>()

// ── Helpers ────────────────────────────────────────────────────────────────────

function send(ws: WebSocket, msg: object): void {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg))
    }
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

// ── Message handlers ───────────────────────────────────────────────────────────

async function handleAuth(client: Client, payload: { wallet: string }): Promise<void> {
    const wallet = payload.wallet?.toLowerCase()
    if (!wallet || !/^0x[0-9a-f]{40}$/i.test(wallet)) {
        send(client.ws, { type: 'error', msg: 'Invalid wallet address' })
        return
    }

    // Deregister old wallet mapping if reconnecting
    if (client.wallet) walletSockets.delete(client.wallet)

    client.wallet = wallet
    walletSockets.set(wallet, client.ws)

    const balance = await getBalance(wallet)

    // Send current game state + balance to this client
    const state = gameLoop.getPublicState()
    send(client.ws, { type: 'auth_ok', wallet, balance, gameState: state })

    console.log(`[WS] Auth: ${wallet.slice(0, 10)}… balance: ${balance}`)
}

async function handleBet(client: Client, payload: { amount: number }): Promise<void> {
    if (!client.wallet) {
        send(client.ws, { type: 'error', msg: 'Authenticate first' })
        return
    }

    const amount = Number(payload.amount)
    if (!amount || amount <= 0) {
        send(client.ws, { type: 'error', msg: 'Invalid bet amount' })
        return
    }

    const result = await gameLoop.placeBet(client.wallet, amount)

    if (!result.ok) {
        send(client.ws, { type: 'error', msg: result.error })
        return
    }

    send(client.ws, { type: 'bet_ok', amount, newBalance: result.newBalance })
}

async function handleCashout(client: Client): Promise<void> {
    if (!client.wallet) {
        send(client.ws, { type: 'error', msg: 'Authenticate first' })
        return
    }

    const result = await gameLoop.cashout(client.wallet)

    if (!result.ok) {
        send(client.ws, { type: 'error', msg: result.error })
        return
    }

    send(client.ws, {
        type: 'cashout_ok',
        at: result.at,
        profit: result.profit,
        xpGained: result.xpGained,
        newBalance: result.newBalance,
    })
}

// ── Game loop (singleton) ──────────────────────────────────────────────────────

const gameLoop = new GameLoop(broadcast, sendTo)

// ── WebSocket Server ───────────────────────────────────────────────────────────

export function createWsServer(port: number): void {
    const wss = new WebSocketServer({ port })

    // Heartbeat — drop dead connections every 30s
    setInterval(() => {
        for (const [ws, client] of clients) {
            if (!client.isAlive) {
                console.log(`[WS] Dropping dead connection: ${client.wallet ?? 'unauthed'}`)
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

        // Send current state immediately on connect
        const state = gameLoop.getPublicState()
        send(ws, { type: 'state', gameState: state })

        ws.on('message', async (raw: Buffer) => {
            let msg: { type: string; [k: string]: unknown }
            try {
                msg = JSON.parse(raw.toString())
            } catch {
                send(ws, { type: 'error', msg: 'Invalid JSON' })
                return
            }

            switch (msg.type) {
                case 'auth':
                    await handleAuth(client, msg as any)
                    break
                case 'bet':
                    await handleBet(client, msg as any)
                    break
                case 'cashout':
                    await handleCashout(client)
                    break
                case 'ping':
                    send(ws, { type: 'pong' })
                    break
                default:
                    send(ws, { type: 'error', msg: `Unknown message type: ${msg.type}` })
            }
        })

        ws.on('close', () => {
            const c = clients.get(ws)
            if (c?.wallet) walletSockets.delete(c.wallet)
            clients.delete(ws)
        })

        ws.on('error', (err: Error) => {
            console.error('[WS] Socket error:', err.message)
        })
    })

    wss.on('error', (err: Error) => {
        console.error('[WSS] Server error:', err.message)
    })

    // Start game loop
    gameLoop.start().catch(err => {
        console.error('[GameLoop] Fatal error:', err)
        process.exit(1)
    })

    console.log(`[WS] Game server listening on ws://0.0.0.0:${port}`)
}
