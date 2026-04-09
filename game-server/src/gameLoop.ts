import { generateServerSeed, hashServerSeed, computeCrashPoint } from './crypto'
import {
    createSession, markSessionRunning, markSessionCrashed, getLastRoundNumber,
    deductBalance, creditBalance, insertBetLog, existingBetInSession,
    updateBetCashout, updateBetLost, awardXp, getBalance,
} from './db'
import { logger } from './logger'

// ── Types ──────────────────────────────────────────────────────────────────────

export type GamePhase = 'waiting' | 'running' | 'crashed'

export interface PlayerBet {
    logId: string
    wallet: string
    amount: number
    cashedOutAt?: number   // set when player cashes out
}

export interface GameState {
    phase: GamePhase
    round: number
    sessionId: string | null
    serverSeedHash: string
    crashPoint: number        // NEVER sent to clients
    multiplier: number
    elapsed: number           // ms since running started
    countdown: number
    bets: Map<string, PlayerBet>  // wallet → bet
}

// ── Broadcast callback (injected from ws server) ───────────────────────────────

type BroadcastFn = (msg: object) => void
type SendToFn = (wallet: string, msg: object) => void

// ── XP formula ─────────────────────────────────────────────────────────────────

function calcXp(cashoutAt: number | null): number {
    if (cashoutAt == null) return 75
    return Math.round(75 * cashoutAt)
}

// ── Game Loop ──────────────────────────────────────────────────────────────────

export class GameLoop {
    private state: GameState
    private broadcast: BroadcastFn
    private sendTo: SendToFn
    private tickInterval: NodeJS.Timeout | null = null
    private countdownInterval: NodeJS.Timeout | null = null
    private startTime = 0

    constructor(broadcast: BroadcastFn, sendTo: SendToFn) {
        this.broadcast = broadcast
        this.sendTo = sendTo
        this.state = this.makeInitialState()
    }

    getState(): Readonly<GameState> { return this.state }

    // Safe snapshot for new client connects — no crash_point
    getPublicState() {
        const s = this.state
        return {
            phase: s.phase,
            round: s.round,
            serverSeedHash: s.serverSeedHash,
            multiplier: s.multiplier,
            countdown: s.countdown,
            elapsed: s.elapsed,
        }
    }

    async start(): Promise<void> {
        logger.info('game_loop_start')
        await this.beginWaiting()
    }

    // ── WAITING phase ──────────────────────────────────────────────────────────

    private async beginWaiting(): Promise<void> {
        this.clearTimers()

        const serverSeed = generateServerSeed()
        const serverSeedHash = hashServerSeed(serverSeed)
        const crashPoint = computeCrashPoint(serverSeed)
        const lastRound = await getLastRoundNumber()
        const round = lastRound + 1

        let sessionId: string | null = null
        try {
            sessionId = await createSession({ roundNumber: round, serverSeed, serverSeedHash, crashPoint })
        } catch (e: any) {
            logger.error('session_create_failed', { round, error: e.message })
        }

        this.state = {
            phase: 'waiting',
            round,
            sessionId,
            serverSeedHash,
            crashPoint,        // private — never broadcast
            multiplier: 1.00,
            elapsed: 0,
            countdown: 5,
            bets: new Map(),
        }

        this.broadcast({ type: 'waiting', round, serverSeedHash, countdown: this.state.countdown })
        logger.info('round_waiting', { round, sessionId })

        let cd = 5
        this.countdownInterval = setInterval(async () => {
            cd--
            this.state.countdown = cd
            this.broadcast({ type: 'waiting', round, serverSeedHash, countdown: cd })

            if (cd <= 0) {
                clearInterval(this.countdownInterval!)
                await this.beginRunning()
            }
        }, 1000)
    }

    // ── RUNNING phase ──────────────────────────────────────────────────────────

    private async beginRunning(): Promise<void> {
        this.state.phase = 'running'
        this.startTime = Date.now()

        if (this.state.sessionId) {
            markSessionRunning(this.state.sessionId).catch(() => {})
        }

        this.broadcast({ type: 'running', round: this.state.round })
        logger.info('round_running', { round: this.state.round, bets: this.state.bets.size })

        this.tickInterval = setInterval(() => {
            const elapsed = Date.now() - this.startTime
            const m = parseFloat(Math.exp(elapsed * 0.00006).toFixed(2))
            this.state.multiplier = m
            this.state.elapsed = elapsed

            this.broadcast({ type: 'tick', multiplier: m, elapsed })

            if (m >= this.state.crashPoint) {
                clearInterval(this.tickInterval!)
                this.doCrash(m)
            }
        }, 80)
    }

    // ── CRASH phase ────────────────────────────────────────────────────────────

    private async doCrash(finalMultiplier: number): Promise<void> {
        const { round, sessionId, crashPoint, bets } = this.state
        this.state.phase = 'crashed'
        this.state.multiplier = crashPoint  // snap to exact value

        // Reveal server_seed for provably fair verification
        const { data: session } = await import('./db').then(m => m.db
            .from('flight_sessions')
            .select('server_seed')
            .eq('id', sessionId!)
            .single()
        ).catch(() => ({ data: null }))

        const serverSeed = session?.server_seed ?? ''

        this.broadcast({
            type: 'crashed',
            round,
            crashPoint,
            serverSeed,          // revealed now — client can verify
            serverSeedHash: this.state.serverSeedHash,
        })

        const winners = [...bets.values()].filter(b => b.cashedOutAt != null).length
        const losers  = [...bets.values()].filter(b => b.cashedOutAt == null).length
        logger.info('round_crashed', { round, crashPoint, totalBets: bets.size, winners, losers, sessionId })

        // Mark session crashed in DB
        if (sessionId) {
            markSessionCrashed(sessionId).catch(() => {})
        }

        // Process all losers (winners already processed at cashout time)
        const dbOps: Promise<void>[] = []
        for (const [wallet, bet] of bets) {
            if (bet.cashedOutAt == null) {
                // Lost
                const xp = calcXp(null)
                dbOps.push(
                    updateBetLost(bet.logId, xp)
                        .then(() => awardXp(wallet, xp))
                        .catch(e => logger.error('update_bet_lost_failed', { wallet, error: e.message }))
                )
                this.sendTo(wallet, { type: 'lost', betAmount: bet.amount, xpGained: xp, round })
            }
        }
        await Promise.allSettled(dbOps)

        // Next round after 5s
        setTimeout(() => this.beginWaiting(), 5000)
    }

    // ── Public actions ─────────────────────────────────────────────────────────

    async placeBet(wallet: string, amount: number): Promise<{ ok: boolean; error?: string; newBalance?: number }> {
        const { phase, sessionId, bets } = this.state

        if (phase !== 'waiting') {
            return { ok: false, error: 'Round already started. Wait for next round.' }
        }
        if (!sessionId) {
            return { ok: false, error: 'No active session' }
        }
        if (bets.has(wallet.toLowerCase())) {
            return { ok: false, error: 'Already placed a bet this round' }
        }
        if (amount < 5) {
            return { ok: false, error: 'Minimum bet is 5 APE' }
        }

        const w = wallet.toLowerCase()

        // Check DB for existing bet (prevents double-bet on reconnect)
        const alreadyInDb = await existingBetInSession(sessionId, w)
        if (alreadyInDb) {
            return { ok: false, error: 'Bet already recorded for this session' }
        }

        // Atomically deduct balance
        const deduct = await deductBalance(w, amount)
        if (!deduct.success) {
            return { ok: false, error: deduct.error }
        }

        // Record in DB
        let logId: string
        try {
            logId = await insertBetLog(sessionId, w, amount)
        } catch (e: any) {
            // Rollback balance
            await creditBalance(w, amount).catch(() => {})
            return { ok: false, error: 'DB error, bet rolled back' }
        }

        bets.set(w, { logId, wallet: w, amount })
        logger.info('bet_placed', { wallet: w.slice(0, 10), amount, round: this.state.round, newBalance: deduct.newBalance })

        return { ok: true, newBalance: deduct.newBalance }
    }

    async cashout(wallet: string): Promise<{ ok: boolean; error?: string; at?: number; profit?: number; xpGained?: number; newBalance?: number }> {
        const { phase, multiplier, crashPoint, bets } = this.state

        if (phase !== 'running') {
            return { ok: false, error: 'Not in a running round' }
        }

        const w = wallet.toLowerCase()
        const bet = bets.get(w)

        if (!bet) {
            return { ok: false, error: 'No active bet this round' }
        }
        if (bet.cashedOutAt != null) {
            return { ok: false, error: 'Already cashed out' }
        }

        // Lock in the multiplier at the exact moment of server processing
        // Cap at crashPoint to prevent any race condition
        const at = parseFloat(Math.min(multiplier, crashPoint).toFixed(2))
        const profit = parseFloat(((at - 1) * bet.amount).toFixed(4))
        const payout = parseFloat((at * bet.amount).toFixed(4))
        const xpGained = calcXp(at)

        // Mark as cashed out in memory immediately
        bet.cashedOutAt = at

        // Credit balance + write DB in parallel
        const newBalance = await creditBalance(w, payout)
        await Promise.allSettled([
            updateBetCashout(bet.logId, at, profit, xpGained),
            awardXp(w, xpGained),
        ])

        logger.info('cashout', { wallet: w.slice(0, 10), at, profit, xpGained, round: this.state.round, newBalance })

        return { ok: true, at, profit, xpGained, newBalance }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private clearTimers(): void {
        if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null }
        if (this.countdownInterval) { clearInterval(this.countdownInterval); this.countdownInterval = null }
    }

    private makeInitialState(): GameState {
        return {
            phase: 'waiting',
            round: 0,
            sessionId: null,
            serverSeedHash: '',
            crashPoint: 0,
            multiplier: 1.00,
            elapsed: 0,
            countdown: 5,
            bets: new Map(),
        }
    }
}
