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
 *   • Since 18.09 a wave ends when it is CLEARED, not on a timer (game src/systems/Spawn.ts): a
 *     wave has a quota of round(10 + 2.2·wave) bodies, clamped 12..46, fed at most 4 per 0.6 s,
 *     then a 2.5 s breath. Killing every body the frame it lands, the fastest possible run reaches
 *     wave 5 at 59 s, 7 at 76 s, 10 at 99 s, and from wave 17 on every wave takes ≥ 9.1 s
 *     (WAVE_REACH_S, the model in the investigation's sim.mjs). Game time runs only SLOWER than
 *     wall time (pauses, drafts, a background tab). A wave ahead of that pace is a FLAG, not a
 *     rejection — the pace is a balance number and the game's balance moves (the old «25 s a
 *     wave» rule outlived the timed waves and refused five honest runs, 20–28.09). Only a wave
 *     no conceivable balance reaches (WAVE_HARD_S a wave) is rejected.
 *   • The director spawns at most 4 bodies per 0.6 s (200 per wave); splitters, carriers and
 *     boss summons add to that, but bounded. A run cannot have more kills than were spawned.
 *   • Score = Σ per-kill points (xp × 10 + bonuses) × multiplier ≤ 8, plus pack and wave bonuses;
 *     everything in it is bounded by kills and wave.
 *   • Pulses (one per new wave, plus one when the tab is hidden) can only ever go UP: wave, kills
 *     and score never decrease in a run. A pulse that is behind in EVERY number is a stale one
 *     overtaken on the network and is ignored; one that goes back in some number and forward in
 *     another is a lie.
 */

export type Verdict = 'ok' | 'cheat' | 'void'

export interface Check {
    verdict: Verdict
    /** Machine reason, stored in survival_runs.reject_reason. */
    reason?: string
    /** What the player is shown. Short, honest, upper-case like the rest of the HUD. */
    message?: string
    /** Why, in the player's words — the line under the verdict (whyOf). */
    why?: string
    /** Soft signals for review — never shown, never rejecting. */
    flags: string[]
    /** A pulse behind the trail in every number — overtaken on the network; store nothing. */
    stale?: boolean
}

export const MSG = {
    cheat: 'CHEATING DETECTED - RESULT NOT COUNTED',
    short: 'RUN TOO SHORT TO COUNT',
    superseded: 'RUN CLOSED - A NEWER RUN WAS STARTED',
    expired: 'RUN EXPIRED - NO SIGNAL FROM THE GAME FOR 24 H',
    refunded: 'RUN CLOSED BEFORE WAVE 2 - YOUR RUN CREDIT WAS RETURNED',
} as const

/** A run counted from its last pulse (lib/survivalRuns.ts closeAbandoned): what the player reads. */
export const restoredMessage = (wave: number): string => `RECORDED AT THE LAST CHECKPOINT - WAVE ${wave}`

/**
 * Why a run was refused, in the player's words (the result screen shows it under the verdict —
 * owner, 17.09: «не резать юзерам счёт без объяснений»). Keys are the machine reasons below.
 */
const WHY: Record<string, string> = {
    pulse_malformed: 'THE GAME SENT A BROKEN CHECKPOINT',
    finish_malformed: 'THE GAME SENT A BROKEN RESULT',
    pulse_regressed: 'THE RUN WENT BACKWARDS BETWEEN CHECKPOINTS',
    pulse_kills_over_cap: 'MORE KILLS THAN ENEMIES WERE SPAWNED',
    kills_over_cap: 'MORE KILLS THAN ENEMIES WERE SPAWNED',
    pulse_score_over_cap: 'SCORE ABOVE WHAT THE KILLS CAN GIVE',
    score_over_cap: 'SCORE ABOVE WHAT THE KILLS CAN GIVE',
    pulse_wave_impossible: 'WAVE FAR AHEAD OF THE CLOCK',
    wave_impossible: 'WAVE FAR AHEAD OF THE CLOCK',
    client_clock_fast: 'THE GAME CLOCK RAN FASTER THAN REAL TIME',
    finish_below_last_pulse: 'RESULT BELOW THE LAST CHECKPOINT',
    too_short: 'UNDER 15 SECONDS OR NO KILLS',
    superseded: 'A NEWER RUN WAS STARTED BEFORE THIS ONE FINISHED',
    expired: 'NO SIGNAL FROM THE GAME FOR 24 HOURS',
    admin_review: 'TAKEN OFF THE BOARD AFTER A REVIEW - ASK IN DISCORD',
}

/** The player's line for a stored reason (a run closed earlier, answered again). */
export function whyOf(reason: string | null | undefined): string | undefined {
    return reason ? WHY[reason] : undefined
}

// ── Tolerances ─────────────────────────────────────────────────────────────────────────────────
// Deliberately loose: a legitimate run must NEVER trip these. Calibrate down only from data.

/**
 * The fastest game-seconds in which a run can REACH wave N (index = wave): every body killed the
 * frame it lands, no boss fight, no draft (the investigation's sim.mjs over Spawn.ts, 29.09.2026).
 * Floors, not averages — a real run is slower.
 */
const WAVE_REACH_S = [0, 0, 21, 38, 49, 59, 68, 75, 83, 91, 98, 107, 114, 122, 130, 138, 147, 156]
/** Past the table every wave is the 46-body quota at 4 per 0.6 s plus the 2.5 s breath: ≥ 9.1 s. */
const WAVE_TAIL_S = 9
/** The pace a real run may beat the model by (the model is a balance number — it drifts). */
export const WAVE_PACE_MARGIN = 0.85
/**
 * Seconds the game's clock may be ahead of the server's: the arena can start before the run
 * ticket lands (a free run does not wait for it — up to two 10 s attempts of runs/start).
 */
export const WAVE_CLOCK_SLACK_S = 30
/**
 * The hard floor, for a wave no balance could ever reach: 3 s a wave (a quota of 12 at the
 * fastest spawn rate is already more), after a minute of slack. Only this rejects; it exists so
 * that a claim of wave 1 000 000 cannot lift the kill and score caps with it.
 */
export const WAVE_HARD_S = 3
export const WAVE_HARD_SLACK_S = 60
/** Kills the director can possibly have produced by wave N (200/wave + splitters, carriers, summons). */
export const killsCap = (wave: number): number => 320 * Math.max(1, wave) + 120
/** Wall time a run must last, and kills it must have, to be a run at all. */
export const MIN_DURATION_MS = 15_000
export const MIN_KILLS = 1
/**
 * A run the server has not heard from for this long is expired (runs/start, counted from the last
 * pulse — a run that pulses is alive however long it lasts; the beta has four-hour runs).
 */
export const RUN_TTL_MS = 24 * 60 * 60 * 1000
/**
 * The client's own duration may exceed the server's by this much: its clock starts when it SENDS
 * runs/start, the server's when the row lands — up to the game's 10 s start timeout.
 */
export const CLIENT_DURATION_SLACK_MS = 15_000

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
    // Calibrated on the beta (29.09): the best honest run scored 487 a kill, and the top of the
    // board sat at 0.84–0.99 of the old 480-a-kill line — a flag every good run raised is no flag.
    return Math.ceil(kills * 900 + wave * 400 + 5000)
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

    // Monotonic: a run only ever moves forward. A pulse behind in every number is an older one
    // that arrived late (the tab-hidden pulse goes out with keepalive and can overtake the wave's
    // own) — nothing to store, nothing to judge. Back in one number and forward in another is not
    // something the game can send.
    if (prev && next.wave <= prev.wave && next.kills <= prev.kills && next.score <= prev.score) {
        return { verdict: 'ok', flags, stale: true }
    }
    if (prev && (next.wave < prev.wave || next.kills < prev.kills || next.score < prev.score)) {
        return cheat('pulse_regressed', flags)
    }
    // The wave against the clock: past the physical pace a flag, past the hard floor a lie.
    if (next.wave > waveHardCap(serverElapsedMs)) return cheat('pulse_wave_impossible', flags)
    if (next.wave > waveCap(serverElapsedMs)) flags.push('pulse_wave_ahead_of_clock')
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
    // however short the run, and a lie is a lie even inside the first fifteen seconds. The wave
    // against the clock is only a flag until the hard floor (see WAVE_REACH_S).
    if (claim.wave > waveHardCap(run.serverDurationMs)) return cheat('wave_impossible', flags)
    if (claim.wave > waveCap(run.serverDurationMs)) flags.push('wave_ahead_of_clock')
    if (claim.durationMs > run.serverDurationMs + CLIENT_DURATION_SLACK_MS) return cheat('client_clock_fast', flags)
    if (claim.kills > killsCap(claim.wave)) return cheat('kills_over_cap', flags)
    if (claim.score > scoreCap(claim.kills, claim.wave)) return cheat('score_over_cap', flags)
    if (run.lastPulse && (claim.wave < run.lastPulse.wave || claim.kills < run.lastPulse.kills || claim.score < run.lastPulse.score)) {
        return cheat('finish_below_last_pulse', flags)
    }

    // Not a run: too short to mean anything. Void, not cheat — a misclick on PLAY is not a crime.
    if (run.serverDurationMs < MIN_DURATION_MS || claim.kills < MIN_KILLS) {
        return { verdict: 'void', reason: 'too_short', message: MSG.short, why: WHY.too_short, flags }
    }

    // Soft signals. None of these rejects: pulses go missing on bad networks, and a great run is
    // still a run. They are for a human to look at before money moves.
    const expectedPulses = Math.max(0, claim.wave - 1)
    if (expectedPulses >= 3 && run.pulseCount < expectedPulses - 2) flags.push('pulses_missing')
    if (claim.score > scoreTypical(claim.kills, claim.wave)) flags.push('score_above_typical')
    // (`long_pauses` is gone: the game's durationMs is wall-clock time too — Date.now() at start and
    // finish — so it never differed from the server's and the flag could not fire; 29.09.)

    return { verdict: 'ok', flags }
}

/** The fastest game-seconds to reach `wave` (WAVE_REACH_S, then WAVE_TAIL_S a wave). */
export function waveReachSeconds(wave: number): number {
    const w = Math.max(1, Math.floor(wave))
    const last = WAVE_REACH_S.length - 1
    return w <= last ? WAVE_REACH_S[w] : WAVE_REACH_S[last] + (w - last) * WAVE_TAIL_S
}

/**
 * Highest wave the physical pace allows after `serverElapsedMs` of wall time — the pace beaten by
 * WAVE_PACE_MARGIN, the clock WAVE_CLOCK_SLACK_S behind the game's. Past it: a review flag.
 */
export function waveCap(serverElapsedMs: number): number {
    const s = Math.max(0, serverElapsedMs) / 1000
    const reachable = (w: number) => waveReachSeconds(w) * WAVE_PACE_MARGIN - WAVE_CLOCK_SLACK_S <= s
    const last = WAVE_REACH_S.length - 1
    let w = 1
    while (w < last && reachable(w + 1)) w++
    if (w < last) return w
    // The linear tail, solved for w: (reach[last] + (w − last)·tail)·margin − slack ≤ s.
    const tail = Math.floor(((s + WAVE_CLOCK_SLACK_S) / WAVE_PACE_MARGIN - WAVE_REACH_S[last]) / WAVE_TAIL_S)
    return last + Math.max(0, tail)
}

/** Highest wave any balance could reach after `serverElapsedMs`: past it the run is rejected. */
export function waveHardCap(serverElapsedMs: number): number {
    return 2 + Math.floor((Math.max(0, serverElapsedMs) / 1000 + WAVE_HARD_SLACK_S) / WAVE_HARD_S)
}

function isSane(s: PulseState): boolean {
    return [s.wave, s.kills, s.score].every((n) => Number.isInteger(n) && n >= 0 && n < 1e9) && s.wave >= 1
}

function cheat(reason: string, flags: string[]): Check {
    return { verdict: 'cheat', reason, message: MSG.cheat, why: WHY[reason], flags }
}
