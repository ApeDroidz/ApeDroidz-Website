import { generateServerSeed, hashServerSeed, computeCrashPoint } from './crypto'
import {
    createSession, markSessionRunning, markSessionCrashed, getLastRoundNumber,
    deductBalance, creditBalance, insertBetLog, existingBetInSession,
    updateBetCashout, updateBetLost, awardXp, updateQuestProgress,
    getVaultLiquidity,
} from './db'
import { logger } from './logger'

// ── Bet limits & vault protection ─────────────────────────────────────────────
// All env-driven so a hot fix doesn't need a code change.
//
//   MIN_BET_APE                — hard floor (default 5)
//   MAX_BET_APE                — hard ceiling regardless of vault size (default 50)
//   MAX_ROUND_LIABILITY_PCT    — single-bet exposure cap. Worst-case payout
//                                (bet × 65.51) cannot exceed vault × this.
//                                Default 0.05 → at most 5% of vault per single bet.
//   MAX_TOTAL_LIABILITY_PCT    — sum of (bet × 65.51) across all live bets
//                                in this round cannot exceed vault × this.
//                                Default 0.10 → at most 10% of vault total.
//   CRASH_CAP_MAX              — must mirror the highest cap-tier value in
//                                crypto.ts (currently 65.51).
const MIN_BET                  = parseFloat(process.env.MIN_BET_APE ?? '5')
const MAX_BET                  = parseFloat(process.env.MAX_BET_APE ?? '50')
const MAX_ROUND_LIABILITY_PCT  = parseFloat(process.env.MAX_ROUND_LIABILITY_PCT ?? '0.05')
const MAX_TOTAL_LIABILITY_PCT  = parseFloat(process.env.MAX_TOTAL_LIABILITY_PCT ?? '0.10')
const CRASH_CAP_MAX            = parseFloat(process.env.CRASH_CAP_MAX ?? '65.51')

/**
 * Per-bet ceiling that accounts for BOTH liability caps:
 *   • per-bet cap   — `(vault × ROUND_PCT) / CAP_MAX`
 *   • remaining-of-total-round-pool cap — `(vault × TOTAL_PCT − currentLiability) / CAP_MAX`
 *
 * Without the second clamp the displayed `maxBet` overstates the real ceiling
 * — a player sees "Max 20 APE" but server rejects with "round pool full"
 * because `bet × CAP_MAX` blows the round-total budget.
 *
 * Returns 0 when the vault has no liquidity or the round pool is exhausted.
 */
function computeMaxBet(vaultBalance: number, currentLiability = 0): number {
    if (vaultBalance <= 0) return 0
    const perBetCap   = (vaultBalance * MAX_ROUND_LIABILITY_PCT) / CRASH_CAP_MAX
    const totalBudget = vaultBalance * MAX_TOTAL_LIABILITY_PCT
    const remaining   = Math.max(0, totalBudget - currentLiability)
    const totalCap    = remaining / CRASH_CAP_MAX
    return Math.max(0, Math.min(MAX_BET, perBetCap, totalCap))
}

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
    // ── Vault protection (refreshed each round) ──
    vaultBalance: number          // logical APE in vault at round start
    currentLiability: number      // sum of (bet × CRASH_CAP_MAX) for placed bets
    maxBet: number                // dynamic per-bet ceiling broadcast to clients
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
            maxBet: s.maxBet,
            minBet: MIN_BET,
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

        // Refresh vault liquidity once per round so single-bet & total-liability
        // caps are based on current liquidity, not stale data.
        const vaultBalance = await getVaultLiquidity()
        const maxBet = computeMaxBet(vaultBalance)

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
            vaultBalance,
            currentLiability: 0,
            maxBet,
        }

        this.broadcast({ type: 'waiting', round, serverSeedHash, countdown: this.state.countdown, maxBet, minBet: MIN_BET })
        logger.info('round_waiting', { round, sessionId, vault: vaultBalance.toFixed(2), maxBet: maxBet.toFixed(2) })

        let cd = 5
        this.countdownInterval = setInterval(async () => {
            cd--
            this.state.countdown = cd
            this.broadcast({ type: 'waiting', round, serverSeedHash, countdown: cd, maxBet: this.state.maxBet, minBet: MIN_BET })

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

    private async doCrash(_finalMultiplier: number): Promise<void> {
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
                        .then(() => Promise.all([
                            awardXp(wallet, xp),
                            updateQuestProgress(wallet, 0), // multiplier 0 = lost/no cashout
                        ]))
                        .then(() => {})
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
        const { phase, sessionId, bets, vaultBalance, currentLiability, maxBet } = this.state

        if (phase !== 'waiting') {
            return { ok: false, error: 'Round already started. Wait for next round.' }
        }
        if (!sessionId) {
            return { ok: false, error: 'No active session' }
        }
        if (bets.has(wallet.toLowerCase())) {
            return { ok: false, error: 'Already placed a bet this round' }
        }
        if (amount < MIN_BET) {
            return { ok: false, error: `Minimum bet is ${MIN_BET} APE` }
        }
        if (amount > MAX_BET) {
            return { ok: false, error: `Maximum bet is ${MAX_BET} APE` }
        }

        // ── Vault protection: reject bets that could drain the bank ──────────
        // (a) Single-bet cap — worst-case payout (bet × CRASH_CAP_MAX) must not
        //     exceed MAX_ROUND_LIABILITY_PCT of the vault. `maxBet` already
        //     encodes this, so we just compare.
        // (b) Total round cap — sum of (bet × CRASH_CAP_MAX) for every active
        //     bet this round must stay below MAX_TOTAL_LIABILITY_PCT × vault.
        //     Without this, 5 players each placing the per-bet max could still
        //     wipe the bank if the round caps at 65.51x.
        if (vaultBalance <= 0) {
            return { ok: false, error: 'Vault unavailable — please retry' }
        }
        if (amount > maxBet) {
            return { ok: false, error: `Max bet right now is ${maxBet.toFixed(2)} APE (vault liquidity)` }
        }
        const newLiability = currentLiability + amount * CRASH_CAP_MAX
        const totalCap     = vaultBalance * MAX_TOTAL_LIABILITY_PCT
        if (newLiability > totalCap) {
            return { ok: false, error: 'Round bet pool full — try the next round' }
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
        // Track total potential payout liability for this round so we can
        // reject further bets if the pool is full.
        this.state.currentLiability += amount * CRASH_CAP_MAX

        // Recompute the per-bet ceiling now that the round pool has shrunk
        // and broadcast the updated value so every connected client sees the
        // new max. Otherwise a second player still sees the original cap and
        // gets a confusing "round pool full" rejection.
        const newMaxBet = computeMaxBet(this.state.vaultBalance, this.state.currentLiability)
        if (newMaxBet !== this.state.maxBet) {
            this.state.maxBet = newMaxBet
            this.broadcast({
                type: 'waiting',
                round: this.state.round,
                serverSeedHash: this.state.serverSeedHash,
                countdown: this.state.countdown,
                maxBet: newMaxBet,
                minBet: MIN_BET,
            })
        }

        logger.info('bet_placed', {
            wallet: w.slice(0, 10), amount, round: this.state.round,
            newBalance: deduct.newBalance,
            roundLiability: this.state.currentLiability.toFixed(2),
            updatedMaxBet: newMaxBet.toFixed(2),
        })

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

        // Mark as cashed out in memory immediately (single-threaded: no concurrent cashout can pass the check above)
        bet.cashedOutAt = at

        // Credit balance — retry up to 3 times before giving up.
        // bet.cashedOutAt is already set so there is zero double-cashout risk on retry.
        let newBalance = 0
        let credited = false
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                newBalance = await creditBalance(w, payout)
                credited = true
                break
            } catch (creditErr: any) {
                logger.error('cashout_credit_failed', { wallet: w.slice(0, 10), payout, attempt, error: creditErr.message })
                if (attempt < 3) await new Promise(r => setTimeout(r, 150 * attempt))
            }
        }
        if (!credited) {
            // All retries exhausted — log for manual review.
            // The player should contact support; we do NOT unset cashedOutAt
            // to prevent a double-cashout if the server recovers.
            logger.error('cashout_credit_unrecoverable', { wallet: w, payout, round: this.state.round })
        }

        await Promise.allSettled([
            updateBetCashout(bet.logId, at, profit, xpGained),
            awardXp(w, xpGained),
            updateQuestProgress(w, at),
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
            vaultBalance: 0,
            currentLiability: 0,
            maxBet: 0,
        }
    }
}
