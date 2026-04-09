'use client'

import { useEffect, useRef, useCallback, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

export type GamePhase = 'waiting' | 'running' | 'crashed'

export interface FlightSocketState {
    connected: boolean
    phase: GamePhase
    multiplier: number
    countdown: number
    elapsed: number
    round: number
    serverSeedHash: string
    serverSeed: string        // revealed after crash
    crashPoint: number | null // revealed after crash
    balance: number | null
    balanceLoading: boolean
    hasBet: boolean
    cashedOutAt: number | null
    lastXpGained: number
    lastProfit: number | null
    error: string | null
}

export interface FlightSocketActions {
    auth: (wallet: string) => void
    bet: (amount: number) => void
    cashout: () => void
    refreshBalance: () => void  // re-sends auth to get fresh balance
}

const INITIAL_STATE: FlightSocketState = {
    connected: false,
    phase: 'waiting',
    multiplier: 1.0,
    countdown: 5,
    elapsed: 0,
    round: 0,
    serverSeedHash: '',
    serverSeed: '',
    crashPoint: null,
    balance: null,
    balanceLoading: true,
    hasBet: false,
    cashedOutAt: null,
    lastXpGained: 0,
    lastProfit: null,
    error: null,
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useFlightSocket(wallet: string | undefined): [FlightSocketState, FlightSocketActions] {
    const wsRef = useRef<WebSocket | null>(null)
    const walletRef = useRef(wallet)
    const reconnectTimer = useRef<NodeJS.Timeout | null>(null)
    const pingTimer = useRef<NodeJS.Timeout | null>(null)
    const isMounted = useRef(true)

    const [state, setState] = useState<FlightSocketState>(INITIAL_STATE)

    useEffect(() => { walletRef.current = wallet }, [wallet])

    const send = useCallback((msg: object) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(msg))
        }
    }, [])

    const connect = useCallback(() => {
        const url = process.env.NEXT_PUBLIC_GAME_SERVER_WS_URL
        if (!url) {
            console.error('[FlightSocket] NEXT_PUBLIC_GAME_SERVER_WS_URL not set')
            return
        }

        if (wsRef.current) {
            wsRef.current.onopen = null
            wsRef.current.onmessage = null
            wsRef.current.onclose = null
            wsRef.current.onerror = null
            wsRef.current.close()
        }

        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
            if (!isMounted.current) return
            console.log('[FlightSocket] Connected')
            setState(s => ({ ...s, connected: true, error: null }))

            // Auth immediately if wallet available
            if (walletRef.current) {
                ws.send(JSON.stringify({ type: 'auth', wallet: walletRef.current }))
            }

            // Start ping keepalive
            if (pingTimer.current) clearInterval(pingTimer.current)
            pingTimer.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
            }, 20_000)
        }

        ws.onmessage = (event) => {
            if (!isMounted.current) return
            let msg: any
            try { msg = JSON.parse(event.data) } catch { return }
            handleMessage(msg)
        }

        ws.onclose = () => {
            if (!isMounted.current) return
            console.log('[FlightSocket] Disconnected — reconnecting in 3s…')
            setState(s => ({ ...s, connected: false }))
            if (pingTimer.current) clearInterval(pingTimer.current)
            reconnectTimer.current = setTimeout(connect, 3000)
        }

        ws.onerror = (e) => {
            console.error('[FlightSocket] Error', e)
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const handleMessage = useCallback((msg: any) => {
        switch (msg.type) {

            // Initial state on connect (before auth)
            case 'state':
            case 'waiting': {
                const gs = msg.gameState ?? msg
                setState(s => ({
                    ...s,
                    phase: 'waiting',
                    round: gs.round ?? msg.round ?? s.round,
                    serverSeedHash: gs.serverSeedHash ?? msg.serverSeedHash ?? s.serverSeedHash,
                    countdown: gs.countdown ?? msg.countdown ?? 5,
                    multiplier: 1.0,
                    serverSeed: '',
                    crashPoint: null,
                    // Reset per-round state on new round
                    ...(msg.type === 'waiting' ? { hasBet: false, cashedOutAt: null, lastXpGained: 0, lastProfit: null } : {}),
                }))
                break
            }

            case 'running': {
                setState(s => ({ ...s, phase: 'running' }))
                break
            }

            case 'tick': {
                setState(s => ({ ...s, multiplier: msg.multiplier, elapsed: msg.elapsed }))
                break
            }

            case 'crashed': {
                setState(s => ({
                    ...s,
                    phase: 'crashed',
                    multiplier: msg.crashPoint,
                    crashPoint: msg.crashPoint,
                    serverSeed: msg.serverSeed,
                }))
                break
            }

            case 'auth_ok': {
                setState(s => ({
                    ...s,
                    balance: msg.balance,
                    balanceLoading: false,
                    // Apply current game state from server
                    phase: msg.gameState?.phase ?? s.phase,
                    round: msg.gameState?.round ?? s.round,
                    serverSeedHash: msg.gameState?.serverSeedHash ?? s.serverSeedHash,
                    countdown: msg.gameState?.countdown ?? s.countdown,
                    multiplier: msg.gameState?.multiplier ?? s.multiplier,
                }))
                break
            }

            case 'bet_ok': {
                setState(s => ({
                    ...s,
                    hasBet: true,
                    balance: msg.newBalance,
                    error: null,
                }))
                break
            }

            case 'cashout_ok': {
                setState(s => ({
                    ...s,
                    cashedOutAt: msg.at,
                    balance: msg.newBalance,
                    lastXpGained: msg.xpGained,
                    lastProfit: msg.profit,
                    error: null,
                }))
                break
            }

            case 'lost': {
                setState(s => ({
                    ...s,
                    lastXpGained: msg.xpGained ?? 75,
                }))
                break
            }

            case 'error': {
                setState(s => ({ ...s, error: msg.msg }))
                // Clear error after 4s
                setTimeout(() => setState(s => ({ ...s, error: null })), 4000)
                break
            }

            case 'pong':
                break
        }
    }, [])

    // Connect on mount
    useEffect(() => {
        isMounted.current = true
        connect()
        return () => {
            isMounted.current = false
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
            if (pingTimer.current) clearInterval(pingTimer.current)
            wsRef.current?.close()
        }
    }, [connect])

    // Re-auth when wallet changes
    useEffect(() => {
        if (!wallet) {
            setState(s => ({ ...s, balance: null, balanceLoading: false }))
            return
        }
        setState(s => ({ ...s, balanceLoading: true }))
        send({ type: 'auth', wallet })
    }, [wallet, send])

    const actions: FlightSocketActions = {
        auth: (w) => send({ type: 'auth', wallet: w }),
        bet: (amount) => send({ type: 'bet', amount }),
        cashout: () => send({ type: 'cashout' }),
        refreshBalance: () => {
            if (walletRef.current) send({ type: 'auth', wallet: walletRef.current })
        },
    }

    return [state, actions]
}
