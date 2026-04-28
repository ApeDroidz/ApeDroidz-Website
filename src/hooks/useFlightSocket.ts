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
    betAmount: number | null  // amount of current bet (optimistic)
    cashedOutAt: number | null
    lastXpGained: number
    lastProfit: number | null
    error: string | null
    // Vault-driven bet bounds, refreshed each round by the server.
    minBet: number            // hard floor (default 5)
    maxBet: number            // dynamic ceiling = min(MAX_BET_APE, vault*PCT/CRASH_CAP)
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
    betAmount: null,
    cashedOutAt: null,
    lastXpGained: 0,
    lastProfit: null,
    error: null,
    minBet: 5,    // baseline; overwritten by server `waiting` event
    maxBet: 50,   // baseline; overwritten by server `waiting` event
}

// ── Hook ───────────────────────────────────────────────────────────────────────

/**
 * @param wallet  - Connected wallet address (from thirdweb useActiveAccount)
 * @param signFn  - Function to sign a message with the wallet (from account.signMessage)
 *                  Required for WebSocket authentication via EIP-191 challenge-response.
 */
export function useFlightSocket(
    wallet: string | undefined,
    signFn?: (message: string) => Promise<string>
): [FlightSocketState, FlightSocketActions] {
    const wsRef = useRef<WebSocket | null>(null)
    const walletRef = useRef(wallet)
    const signFnRef = useRef(signFn)
    const challengeNonceRef = useRef<string | null>(null)
    const reconnectTimer = useRef<NodeJS.Timeout | null>(null)
    const pingTimer = useRef<NodeJS.Timeout | null>(null)
    const isMounted = useRef(true)
    // Track pending bet for rollback
    const pendingBetRef = useRef<{ amount: number; prevBalance: number | null } | null>(null)
    // Track pending cashout for optimistic rollback
    const pendingCashoutRef = useRef(false)

    const [state, setState] = useState<FlightSocketState>(INITIAL_STATE)
    // Keep a ref to current state for rollback access
    const stateRef = useRef(state)
    useEffect(() => { stateRef.current = state }, [state])

    useEffect(() => { walletRef.current = wallet }, [wallet])
    useEffect(() => { signFnRef.current = signFn }, [signFn])

    const send = useCallback((msg: object) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(msg))
        }
    }, [])

    /** Sign the current challenge and send an auth message */
    const doAuth = useCallback(async (w: string) => {
        const nonce = challengeNonceRef.current
        const sign = signFnRef.current
        if (!nonce || !sign) return
        try {
            const message = `Glitch Flight Auth: ${nonce}`
            const signature = await sign(message)
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'auth', wallet: w, nonce, signature }))
            }
        } catch (e) {
            console.error('[FlightSocket] Sign failed', e)
        }
    }, [])

    const connect = useCallback(() => {
        const url = process.env.NEXT_PUBLIC_GAME_SERVER_WS_URL
        if (!url) {
            console.error('[FlightSocket] NEXT_PUBLIC_GAME_SERVER_WS_URL not set')
            return
        }

        // ── Force TLS in production. Plain ws:// would let MITM attackers
        //    rewrite bet/cashout commands. localhost is allowed for dev.
        try {
            const parsed = new URL(url)
            const isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)
            if (parsed.protocol !== 'wss:' && !isLocal) {
                console.error('[FlightSocket] Refusing to connect over non-TLS ws://', url)
                setState(s => ({ ...s, error: 'Insecure WebSocket URL — TLS required', connected: false }))
                return
            }
        } catch (e) {
            console.error('[FlightSocket] Invalid WS URL:', url)
            return
        }

        if (wsRef.current) {
            wsRef.current.onopen = null
            wsRef.current.onmessage = null
            wsRef.current.onclose = null
            wsRef.current.onerror = null
            wsRef.current.close()
        }

        // Reset challenge on new connection
        challengeNonceRef.current = null

        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
            if (!isMounted.current) return
            console.log('[FlightSocket] Connected')
            setState(s => ({ ...s, connected: true, error: null }))

            // Start ping keepalive
            if (pingTimer.current) clearInterval(pingTimer.current)
            pingTimer.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
            }, 20_000)
            // Auth happens after server sends the challenge message
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
            // Stop balance spinner on disconnect — will reload after reconnect + auth
            setState(s => ({ ...s, connected: false, balanceLoading: false }))
            if (pingTimer.current) clearInterval(pingTimer.current)
            challengeNonceRef.current = null
            reconnectTimer.current = setTimeout(connect, 3000)
        }

        ws.onerror = (e) => {
            console.error('[FlightSocket] Error', e)
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const handleMessage = useCallback((msg: any) => {
        switch (msg.type) {

            // Server-issued challenge — sign and authenticate
            case 'challenge': {
                challengeNonceRef.current = msg.nonce
                // Auto-auth if wallet and signFn are available
                if (walletRef.current && signFnRef.current) {
                    setState(s => ({ ...s, balanceLoading: true }))
                    doAuth(walletRef.current)
                }
                break
            }

            // Initial state on connect (before auth)
            case 'state': {
                const gs = msg.gameState ?? msg
                setState(s => ({
                    ...s,
                    phase: gs.phase ?? s.phase,
                    round: gs.round ?? s.round,
                    serverSeedHash: gs.serverSeedHash ?? s.serverSeedHash,
                    countdown: gs.countdown ?? 5,
                    multiplier: gs.phase === 'waiting' ? 1.0 : (gs.multiplier ?? s.multiplier),
                    serverSeed: '',
                    crashPoint: null,
                    // Server may include the dynamic bet bounds in its state snapshot.
                    ...(typeof gs.maxBet === 'number' ? { maxBet: gs.maxBet } : {}),
                    ...(typeof gs.minBet === 'number' ? { minBet: gs.minBet } : {}),
                }))
                break
            }

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
                    // Bet bounds — refreshed each round by the server based on
                    // current vault liquidity.
                    ...(typeof msg.maxBet === 'number' ? { maxBet: msg.maxBet } : {}),
                    ...(typeof msg.minBet === 'number' ? { minBet: msg.minBet } : {}),
                    // Reset per-round bet state only on phase transition (not on every countdown tick)
                    ...(s.phase !== 'waiting' ? { hasBet: false, betAmount: null, cashedOutAt: null, lastXpGained: 0, lastProfit: null } : {}),
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
                    // Restore bet state (critical for reconnect/refresh during active round)
                    hasBet: msg.hasBet ?? s.hasBet,
                    betAmount: msg.betAmount ?? s.betAmount,
                    cashedOutAt: msg.cashedOutAt ?? s.cashedOutAt,
                }))
                break
            }

            case 'bet_ok': {
                // Confirm — sync authoritative balance from server
                pendingBetRef.current = null
                setState(s => ({
                    ...s,
                    hasBet: true,
                    betAmount: msg.amount ?? s.betAmount,
                    balance: msg.newBalance ?? s.balance,
                    error: null,
                }))
                break
            }

            case 'cashout_ok': {
                pendingCashoutRef.current = false
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
                if (pendingCashoutRef.current) {
                    // Rollback optimistic cashout
                    pendingCashoutRef.current = false
                    setState(s => ({ ...s, cashedOutAt: null, error: msg.msg }))
                } else if (pendingBetRef.current) {
                    // Rollback optimistic bet
                    const { prevBalance } = pendingBetRef.current
                    pendingBetRef.current = null
                    setState(s => ({
                        ...s,
                        hasBet: false,
                        betAmount: null,
                        balance: prevBalance,
                        error: msg.msg,
                    }))
                } else {
                    setState(s => ({ ...s, error: msg.msg }))
                }
                // If we were waiting for auth balance, stop the spinner
                setState(s => ({
                    ...s,
                    balanceLoading: s.balanceLoading ? false : s.balanceLoading,
                }))
                setTimeout(() => setState(s => ({ ...s, error: null })), 4000)
                break
            }

            case 'pong':
                break
        }
    }, [doAuth])

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

    // Re-auth when wallet changes (reuse the existing connection's challenge nonce)
    useEffect(() => {
        if (!wallet) {
            setState(s => ({ ...s, balance: null, balanceLoading: false }))
            return
        }
        if (!signFnRef.current || !challengeNonceRef.current) {
            // Will auth when challenge arrives (handled in 'challenge' case above)
            return
        }
        setState(s => ({ ...s, balanceLoading: true }))
        doAuth(wallet)
    }, [wallet, doAuth])

    const actions: FlightSocketActions = {
        auth: (w) => { doAuth(w) },
        bet: (amount) => {
            // Optimistic: mark bet placed + deduct balance immediately
            const prev = stateRef.current
            pendingBetRef.current = { amount, prevBalance: prev.balance }
            setState(s => ({
                ...s,
                hasBet: true,
                betAmount: amount,
                balance: s.balance !== null ? parseFloat((s.balance - amount).toFixed(4)) : null,
            }))
            send({ type: 'bet', amount })
        },
        cashout: () => {
            // Optimistic: immediately show cashed-out state at current multiplier
            pendingCashoutRef.current = true
            setState(s => ({ ...s, cashedOutAt: s.multiplier }))
            send({ type: 'cashout' })
        },
        refreshBalance: () => {
            if (!walletRef.current) return
            setState(s => ({ ...s, balanceLoading: true }))
            doAuth(walletRef.current)
        },
    }

    return [state, actions]
}
