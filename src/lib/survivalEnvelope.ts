/**
 * The plausibility envelope for a Droidz Survival run (docs: game/docs/PRIZE_POOL.md §5, layer 2).
 *
 * Pure functions, no I/O, no framework — so the rules can be read in one screen and exercised by
 * `scripts/qa-survival-envelope.mjs` against every edge we could think of. The routes in
 * app/api/survival/run/* only fetch, call these, and store the verdict.
 *
 * The one design rule, from the owner (17.09.2026): a wrong verdict here is a BLOCKER for real
 * players — «не резать юзерам счёт без объяснений». So every rule below is a physical invariant
 * of the game, not a statistical guess, and anything softer is a FLAG for review, never a
 * rejection. When a run is rejected the player is told so, in words, on the result screen.
 *
 * Invariants used (all measured off the game's own code):
 *   • Spawn.wave = 1 + floor(gameElapsed / 30 s), and game time can only run SLOWER than wall
 *     time (pauses, drafts, a background tab), never faster. So the wave a run claims cannot be
 *     ahead of the wall clock the server kept.
 *   • The director spawns at most 4 bodies per 0.6 s (200 per wave); splitters, carriers and
 *     boss summons add to that, but bounded. A run cannot have more kills than were spawned.
 *   • Score = Σ per-kill points (xp × 10 + bonuses) × multiplier ≤ 8, plus pack and wave bonuses;
 *     everything in it is bounded by kills and wave.
 *   • Pulses (one per new wave) can only ever go UP: wave, kills and score never decrease in a run.
 */

export type Verdict = 'ok' | 'cheat' | 'void'

export interface Check {
    verdict: Verdict
    /** Machine reason, stored in survival_runs.reject_reason. */
    reason?: string
    /** What the player is shown. Short, honest, upper-case like the rest of the HUD. */
    message?: string
    /** Soft signals for review — never shown, never rejecting. */
    flags: string[]
}

export const MSG = {
    cheat: 'CHEATING DETECTED - RESULT NOT COUNTED',
    short: 'RUN TOO SHORT TO COUNT',
} as const

// ── Tolerances ─────────────────────────────────────────────────────────────────────────────────
// Deliberately loose: a legitimate run must NEVER trip these. Calibrate down only from data.

/** Seconds of wall time a wave needs. The game's period is 30 s; 25 leaves 17 % for clock skew. */
export const WAVE_SECONDS_MIN = 25
/** Kills the director can possibly have produced by wave N (200/wave + splitters, carriers, summons). */
export const killsCap = (wave: number): number => 320 * Math.max(1, wave) + 120
/** Wall time a run must last, and kills it must have, to be a run at all. */
export const MIN_DURATION_MS = 15_000
export const MIN_KILLS = 1
/** A run the server never heard from again is void after this. */
export const RUN_TTL_MS = 6 * 60 * 60 * 1000
/** The client's own duration may exceed the server's by this much (its clock starts before the request lands). */
export const CLIENT_DURATION_SLACK_MS = 8_000

/**
 * The hardest possible score for `kills` kills by `wave`: every kill a boss-class body (xp 25,
 * elite ×2, wave-scaled) at the top multiplier with the biggest pack bonus every time, plus a
 * flawless wave clear per wave. Real runs sit 20-50× below this; it exists to stop `score: 1e9`,
 * not to judge play.
 */
export function scoreCap(kills: number, wave: number): number {
    const w = Math.max(1, wave)
    const xpMax = 25 * (1 + 0.03 * w) * 2           // boss xp, elite mult, wave scaling
    const perKill = (xpMax * 10 + 2500 + 800) * 8 * 2  // + boss bonus + pack bonus, ×mul 8, ×boost 2
    const waveBonus = w * 100 * 2 * 2                  // wave × 100, flawless ×2, boost ×2
    return Math.ceil(kills * perKill + w * waveBonus)
}

/** A rough "typical" ceiling, for the review flag only: an ordinary kill is ~10-60 points × mul. */
export function scoreTypical(kills: number, wave: number): number {
    return Math.ceil(kills * 60 * 8 + wave * 400 + 5000)
}

export interface PulseState {
    wave: number
    kills: number
    score: number
}

/**
 * A heartbeat: the client says where it is (a new wave). `serverElapsedMs` is the wall time
 * since the server created the run.
 */
export function checkPulse(prev: PulseState | null, next: PulseState, serverElapsedMs: number): Check {
    const flags: string[] = []
    if (!isSane(next)) return cheat('pulse_malformed', flags)

    // Monotonic: a run only ever moves forward.
    if (prev && (next.wave < prev.wave || next.kills < prev.kills || next.score < prev.score)) {
        return cheat('pulse_regressed', flags)
    }
    // The wave cannot be ahead of the clock.
    if (next.wave > waveCap(serverElapsedMs)) return cheat('pulse_wave_ahead_of_clock', flags)
    if (next.kills > killsCap(next.wave)) return cheat('pulse_kills_over_cap', flags)
    if (next.score > scoreCap(next.kills, next.wave)) return cheat('pulse_score_over_cap', flags)

    return { verdict: 'ok', flags }
}

export interface FinishClaim extends PulseState {
    /** The client's own idea of how long it played (ms). */
    durationMs: number
}

export interface RunFacts {
    /** Wall time since the run was created, as the server measures it. */
    serverDurationMs: number
    /** The last accepted pulse, if any. */
    lastPulse: PulseState | null
    /** How many pulses arrived. */
    pulseCount: number
}

export function checkFinish(run: RunFacts, claim: FinishClaim): Check {
    const flags: string[] = []
    if (!isSane(claim) || !Number.isFinite(claim.durationMs) || claim.durationMs < 0) {
        return cheat('finish_malformed', flags)
    }

    // Physical invariants first — every one of these is impossible for an unmodified client,
    // however short the run, and a lie is a lie even inside the first fifteen seconds.
    if (claim.wave > waveCap(run.serverDurationMs)) return cheat('wave_ahead_of_clock', flags)
    if (claim.durationMs > run.serverDurationMs + CLIENT_DURATION_SLACK_MS) return cheat('client_clock_fast', flags)
    if (claim.kills > killsCap(claim.wave)) return cheat('kills_over_cap', flags)
    if (claim.score > scoreCap(claim.kills, claim.wave)) return cheat('score_over_cap', flags)
    if (run.lastPulse && (claim.wave < run.lastPulse.wave || claim.kills < run.lastPulse.kills || claim.score < run.lastPulse.score)) {
        return cheat('finish_below_last_pulse', flags)
    }

    // Not a run: too short to mean anything. Void, not cheat — a misclick on PLAY is not a crime.
    if (run.serverDurationMs < MIN_DURATION_MS || claim.kills < MIN_KILLS) {
        return { verdict: 'void', reason: 'too_short', message: MSG.short, flags }
    }

    // Soft signals. None of these rejects: pulses go missing on bad networks, and a great run is
    // still a run. They are for a human to look at before money moves.
    const expectedPulses = Math.max(0, claim.wave - 1)
    if (expectedPulses >= 3 && run.pulseCount < expectedPulses - 2) flags.push('pulses_missing')
    if (claim.score > scoreTypical(claim.kills, claim.wave)) flags.push('score_above_typical')
    if (claim.durationMs < run.serverDurationMs * 0.5 && run.serverDurationMs > 60_000) flags.push('long_pauses')

    return { verdict: 'ok', flags }
}

/** Highest wave the wall clock allows: 1 + floor(elapsed / 25 s), plus one for the boundary. */
export function waveCap(serverElapsedMs: number): number {
    return 1 + Math.floor(serverElapsedMs / (WAVE_SECONDS_MIN * 1000)) + 1
}

function isSane(s: PulseState): boolean {
    return [s.wave, s.kills, s.score].every((n) => Number.isInteger(n) && n >= 0 && n < 1e9) && s.wave >= 1
}

function cheat(reason: string, flags: string[]): Check {
    return { verdict: 'cheat', reason, message: MSG.cheat, flags }
}
