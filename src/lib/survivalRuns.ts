import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { readSessionFromRequest } from '@/lib/walletAuth'
import { supabaseAdmin } from '@/lib/supabase'
import { createPlayToken, PLAY_COOKIE_NAME, PLAY_COOKIE_OPTIONS, readPlayToken } from '@/lib/survivalAccess'
import { accessFor } from '@/lib/survivalAllow'
import { accountOf } from '@/lib/survivalAccount'
import { checkFinish, MSG, restoredMessage, whyOf, type PulseState } from '@/lib/survivalEnvelope'
import { logEvent } from '@/lib/survivalLog'
import { runAlreadyPaid, runReward, type RunReport } from '@/lib/survivalEconomy'
import { withEcon } from '@/lib/survivalEconomyStore'
import { settleCoop } from '@/lib/survivalCoop'

/**
 * Shared plumbing for /api/survival/run/* — who is asking, and the run row they are asking about.
 *
 * Two proofs are required on every call, the same two the game itself needed to load:
 *   1. the signed wallet session (`glitch_session`) — this is whose run it is;
 *   2. the beta play cookie (`survival_play`) — minted only for an allowlisted wallet, and it must
 *      be for the SAME wallet as the session.
 * Both are httpOnly cookies on apedroidz.com; the game runs on the same origin, so they travel
 * with its fetches on their own. The standalone build (localhost:5173) has neither, gets 401,
 * and RunLedger.ts treats that as "no server" — the run plays, nothing is recorded.
 *
 * Every reply is HTTP 200 with `{ ok, state }` unless the caller is not authenticated, so the
 * game can render a state rather than parse an error.
 */

/**
 * `wallet` is the ACCOUNT (lib/survivalAccount.ts): the main wallet when the signed one is linked to
 * it, the signed one otherwise — every table the game writes is keyed by it. `session` is the wallet
 * that actually signed; `wallets` every wallet of the account (whose NFTs count, whose droids give
 * the holder price).
 */
export interface Caller { wallet: string; session: string; wallets: string[] }

/**
 * The account behind a signed wallet. If the lookup fails (no database, or the links table not
 * migrated yet) the signed wallet stands alone — exactly the behaviour before accounts existed.
 */
async function asAccount(session: string, recheck: boolean): Promise<Caller | NextResponse> {
    const acc = await accountOf(session)
    if (!acc) return { wallet: session, session, wallets: [session] }
    // A ban on the account closes every wallet of it — checked when something starts (recheck),
    // like the signed wallet's own gate above.
    if (recheck && acc.account !== session) {
        const access = await accessFor(acc.account)
        if (!access.error && !access.allowed) return NextResponse.json({ ok: false, state: 'no_access' }, { status: 401 })
    }
    return { wallet: acc.account, session, wallets: acc.wallets }
}

/**
 * The play cookie lives PLAY_TTL (6 h) and was minted only when the page loaded, so a long
 * session outlived it: from then on every run, profile, economy and credits call answered 401
 * `no_access`, and the run played on to the end with nothing recorded (a 7 080 013 run the server
 * last saw at wave 101, 29.09). So when the session is good but the play cookie is gone, stale or
 * for another wallet, the gate is asked again — the same rule as /api/survival/access
 * (lib/survivalAllow.ts: the list, bans, revocations, SURVIVAL_PUBLIC=0) — and on a yes the
 * request goes through and the reply carries a fresh cookie (cookies() is merged into whatever
 * response the route returns). On a no it is 401 and the stale cookie is cleared, as the access
 * route does. In the Otherside cabinet the browser keeps only partitioned cookies, so the Lax one
 * set here does not stick — there every such call pays the lookup until the cabinet page renews
 * its own (droidz_survival/otherside/page.tsx).
 */
/**
 * `recheck`: ask the gate even when the play cookie is good — for the calls that start something
 * (a new order, a new run), so SURVIVAL_PUBLIC=0 or a ban reaches a tab already open at the next
 * purchase or run, not six hours later when its cookie runs out. Never for settling a payment
 * already sent (api/survival/pay): money on chain is booked whoever the gate says no to now.
 */
export async function authCaller(req: NextRequest, opts: { recheck?: boolean } = {}): Promise<Caller | NextResponse> {
    const session = readSessionFromRequest(req)
    if (!session) return NextResponse.json({ ok: false, state: 'unauthenticated' }, { status: 401 })
    const play = await readPlayToken(req.cookies.get(PLAY_COOKIE_NAME)?.value)
    if (play && play === session.wallet && !opts.recheck) return asAccount(session.wallet, false)

    const access = await accessFor(session.wallet)
    if (access.error) { console.error('[survival] access recheck', access.error); return noServer() }
    if (!access.allowed) {
        const res = NextResponse.json({ ok: false, state: 'no_access' }, { status: 401 })
        res.cookies.set(PLAY_COOKIE_NAME, '', { ...PLAY_COOKIE_OPTIONS, maxAge: 0 })
        return res
    }
    // A good cookie that was only rechecked stays as it is.
    if (play && play === session.wallet) return asAccount(session.wallet, true)
    const token = await createPlayToken(session.wallet, access.until)
    if (token) {
        try { cookies().set(PLAY_COOKIE_NAME, token, PLAY_COOKIE_OPTIONS) } catch { /* not in a request scope */ }
    }
    return asAccount(session.wallet, !!opts.recheck)
}

/** One journal line per kind per minute at most: a database that is down must not flood it. */
const lastDown = new Map<string, number>()

/**
 * The 503 every route answers when the database or the chain did not. With `where`, it also goes
 * into the journal as `server.<where>` (level error) — the panel's «API answers no server» alert —
 * throttled per kind; before this only the Vercel logs knew.
 */
export function noServer(where?: string, err?: unknown): NextResponse {
    if (where) {
        const kind = `server.${where}`
        const now = Date.now()
        if (now - (lastDown.get(kind) ?? 0) > 60_000) {
            lastDown.set(kind, now)
            const message = String((err as { message?: unknown } | null)?.message ?? err ?? '').slice(0, 300)
            logEvent({ level: 'error', kind, message })
        }
    }
    return NextResponse.json({ ok: false, state: 'no_server' }, { status: 503 })
}

export interface RunRow {
    id: string
    wallet: string
    season_id: string
    mode: string
    status: 'started' | 'finished' | 'rejected' | 'void'
    reject_reason: string | null
    started_at: string
    finished_at: string | null
    score: number
    wave: number
    kills: number
    credit_id: string | null
    last_pulse_at: string | null
    last_pulse_wave: number | null
    last_pulse_kills: number | null
    last_pulse_score: number | null
    pulse_count: number
    flags: string[] | null
    /** The hero the run was opened with (checked against the save at runs/start). */
    hero: string | null
    /** A co-op member's run: its team (survival_coop_runs). Null for a solo run. */
    coop_id?: string | null
}

export const RUN_COLUMNS = 'id, wallet, season_id, mode, status, reject_reason, started_at, finished_at, score, wave, kills, credit_id, last_pulse_at, last_pulse_wave, last_pulse_kills, last_pulse_score, pulse_count, flags, hero, coop_id'

/** The caller's own run, or a reply explaining why there is none. */
export async function loadRun(runId: unknown, wallet: string): Promise<RunRow | NextResponse> {
    if (typeof runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(runId)) {
        return NextResponse.json({ ok: false, state: 'no_run' })
    }
    const { data, error } = await supabaseAdmin
        .from('survival_runs')
        .select(RUN_COLUMNS)
        .eq('id', runId)
        .maybeSingle()
    if (error) { console.error('[survival/run] load', error.message); return noServer() }
    if (!data || data.wallet !== wallet) return NextResponse.json({ ok: false, state: 'no_run' })
    return data as RunRow
}

/** Flags as stored (jsonb array), whatever the row holds. */
export const flagsOf = (run: { flags?: unknown }): string[] =>
    Array.isArray(run.flags) ? (run.flags as unknown[]).filter((f): f is string => typeof f === 'string') : []

/** A run closed from its last pulse carries this flag (and `closed_superseded` / `closed_expired`). */
export const RESTORED_FLAG = 'restored_from_last_pulse'
/** The late finish of a restored or closed run was taken — it cannot be taken twice. */
export const LATE_FLAG = 'late_finish'
/** The run's credits were given back (a paid run closed before its first pulse). */
export const REFUNDED_FLAG = 'credit_refunded'

/**
 * What the player reads about a run that is already closed — the pulse and the finish answer it
 * the same way (runs/pulse, runs/finish storedVerdict), so the game can show it in words instead
 * of «offline».
 */
export function closedLine(run: RunRow): { message: string; why?: string } {
    const flags = flagsOf(run)
    if (run.status === 'finished') {
        const why = flags.includes('closed_superseded') ? whyOf('superseded') : flags.includes('closed_expired') ? whyOf('expired') : undefined
        return flags.includes(RESTORED_FLAG) && !flags.includes(LATE_FLAG) ? { message: restoredMessage(run.wave), why } : { message: 'RESULT RECORDED' }
    }
    if (run.status === 'rejected') return { message: MSG.cheat, why: whyOf(run.reject_reason) }
    const message = flags.includes(REFUNDED_FLAG) ? MSG.refunded
        : run.reject_reason === 'superseded' ? MSG.superseded
            : run.reject_reason === 'expired' ? MSG.expired
                : run.reject_reason === 'too_short' ? MSG.short
                    : 'RESULT NOT COUNTED'
    return { message, why: whyOf(run.reject_reason) }
}

// ── Closing a run its game will never finish ────────────────────────────────────────────────

/**
 * What happens to a run nobody will finish — a newer start by the same wallet (`superseded`) or
 * a run silent for RUN_TTL (`expired`). It used to be voided either way, which is how a run that
 * pulsed to wave 101 left nothing behind, and how a paid run that never got going burnt its credit.
 *
 *   • It pulsed: it counts as far as the last pulse went — every pulse passed the envelope on
 *     arrival, so the trail is verified. Status `finished` (the survival_runs_to_best trigger puts
 *     it on the board), score/wave/kills = the last pulse's, finished_at = the last pulse's time,
 *     flags RESTORED_FLAG + closed_<reason>. Not paid yet: see payRestoredRun.
 *   • It never pulsed: void, as before. A paid one gets its credits back, the same way the panel
 *     grants runs (survival_credits source 'grant', the run's season and mode).
 *
 * Every write is conditional on the row still being `started`, so a finish that lands at the same
 * moment wins or loses cleanly — nothing is closed twice.
 */
export type CloseOutcome = 'restored' | 'void' | 'refunded' | 'lost_race' | 'error'

export async function closeAbandoned(run: RunRow, reason: 'superseded' | 'expired'): Promise<CloseOutcome> {
    const out = await closeAbandonedRun(run, reason)
    // A co-op member's run closed under its team: the team's row follows.
    if (run.coop_id && (out === 'restored' || out === 'void' || out === 'refunded')) await settleCoop(run.coop_id)
    return out
}

async function closeAbandonedRun(run: RunRow, reason: 'superseded' | 'expired'): Promise<CloseOutcome> {
    const flags = flagsOf(run)
    if (run.pulse_count > 0 && run.last_pulse_wave !== null && run.last_pulse_at) {
        const last: PulseState = { wave: run.last_pulse_wave, kills: run.last_pulse_kills ?? 0, score: run.last_pulse_score ?? 0 }
        const serverDurationMs = Math.max(0, Date.parse(run.last_pulse_at) - Date.parse(run.started_at))
        // The last pulse as a finish claim: the same judge, so a trail too thin to be a run (no
        // kills, under 15 s) stays void exactly as its finish would have.
        const check = checkFinish({ serverDurationMs, lastPulse: last, pulseCount: run.pulse_count }, { ...last, durationMs: serverDurationMs })
        if (check.verdict === 'ok') {
            const { data, error } = await supabaseAdmin.from('survival_runs')
                .update({
                    status: 'finished', score: last.score, wave: last.wave, kills: last.kills,
                    finished_at: run.last_pulse_at, server_duration_ms: serverDurationMs, verified: 'envelope',
                    flags: [...new Set([...flags, ...check.flags, RESTORED_FLAG, `closed_${reason}`])],
                })
                .eq('id', run.id).eq('status', 'started').select('id')
            if (error) { console.error('[survival/run] restore', error.message); return 'error' }
            if (!data?.length) return 'lost_race'
            logEvent({
                level: 'info', kind: 'run.restored', wallet: run.wallet, runId: run.id,
                message: `${reason}: counted at the last pulse, wave ${last.wave}`,
                data: { reason, last, pulses: run.pulse_count, lastPulseAt: run.last_pulse_at, flags: check.flags },
            })
            await payRestoredRun(run, last)
            return 'restored'
        }
    }
    const { data, error } = await supabaseAdmin.from('survival_runs')
        .update({ status: 'void', reject_reason: reason })
        .eq('id', run.id).eq('status', 'started').select('id')
    if (error) { console.error('[survival/run] void', error.message); return 'error' }
    if (!data?.length) return 'lost_race'
    // A paid run that never pulsed gets its credits back — counted by what it consumed, not by the
    // credit_id read a moment ago (a start whose credit was spent after that read had none yet).
    if (run.pulse_count === 0) return (await refundRunCredits(run, reason)) ? 'refunded' : 'void'
    return 'void'
}

/**
 * Gives a closed paid run its credits back: one per credit it consumed (the entry, and a continue
 * if it was continued before it ever pulsed), inserted exactly like the panel's grant
 * (api/admin/survival/credits). True when the credits are back.
 */
export async function refundRunCredits(run: RunRow, reason: string): Promise<boolean> {
    const { data: spent } = await supabaseAdmin.from('survival_credits').select('id, mode').eq('consumed_by_run', run.id)
    // Nothing spent (a free run, or a paid one whose credit was never taken): nothing to give back.
    if (!spent?.length && !run.credit_id) return false
    const count = Math.max(1, spent?.length ?? 0)
    // Back in the kind it was spent from: a co-op run spends a solo run (20261016_survival_coop.sql).
    const modes = ((spent ?? []) as { mode?: string }[]).map((c) => (c.mode === 'coop' ? 'coop' : 'solo'))
    const rows = Array.from({ length: count }, (_, i) => ({ wallet: run.wallet, season_id: run.season_id, source: 'grant', mode: modes[i] ?? 'solo' }))
    const { error } = await supabaseAdmin.from('survival_credits').insert(rows)
    if (error) {
        console.error('[survival/run] refund', error.message)
        logEvent({ level: 'error', kind: 'credits.refund_failed', wallet: run.wallet, runId: run.id, message: error.message, data: { reason, count } })
        return false
    }
    await supabaseAdmin.from('survival_runs').update({ flags: [...new Set([...flagsOf(run), REFUNDED_FLAG])] }).eq('id', run.id)
    logEvent({ level: 'warn', kind: 'credits.refund', wallet: run.wallet, runId: run.id, message: `${count} run credit${count === 1 ? '' : 's'} back: ${reason} before the first pulse`, data: { by: 'run.void', reason, count, mode: run.mode } })
    return true
}

/**
 * The pay for a run counted from its last pulse (closeAbandoned) — owner, 07.10.2026: «начислить по
 * формуле» (a 207-wave run was closed from its pulse and paid nothing). The same formula and the same
 * write as a finish (runs/finish → lib/survivalEconomy.ts runReward) from the verified score, wave
 * and kills; there is no report, so nothing the report alone tells is paid (Ape Mini picked off the
 * floor, salvage, bosses, the bestiary). The run id is written with the pay, so a finish that
 * still arrives late (runs/finish, `accept`) finds it paid and pays nothing on top. Never throws:
 * a failed pay is logged, the run stays on the board.
 */
export async function payRestoredRun(run: RunRow, at: PulseState): Promise<void> {
    try {
        const durationMs = Math.max(0, Date.parse(run.last_pulse_at ?? run.started_at) - Date.parse(run.started_at))
        const rep: RunReport = run.hero ? { hero: run.hero } : {}
        const paid = await withEcon(run.wallet, run.season_id, (loaded) => {
            if (runAlreadyPaid(loaded.econ, run.id)) return null
            const x = runReward(loaded.econ, { score: at.score, wave: at.wave, kills: at.kills, durationMs, runId: run.id }, rep, { now: Date.now(), noDaily: true })
            return { next: x.econ, out: x.paid }
        })
        if (!paid.ok) {
            logEvent({ level: 'error', kind: 'economy.run_unpaid', wallet: run.wallet, runId: run.id, message: `restored: ${paid.error}` })
        } else if (paid.out) {
            logEvent({ level: 'info', kind: 'economy.run_paid', wallet: run.wallet, runId: run.id, message: `${(paid.out as { coins?: number }).coins ?? 0} mini (restored from the last pulse)`, data: { paid: paid.out, restored: true } })
        }
    } catch (e) {
        logEvent({ level: 'error', kind: 'economy.run_unpaid', wallet: run.wallet, runId: run.id, message: `restored: ${(e as Error).message}` })
    }
}

/**
 * The run's active time from a pulse or finish body (`activeMs`, the game's own clock — pauses,
 * picks and hidden tabs excluded), never more than the server's wall clock since the run opened.
 * Null when the game sent none (an older build) or sent nonsense.
 */
export function activeOf(body: Record<string, unknown>, wallMs: number): number | null {
    const v = body.activeMs
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null
    return Math.round(Math.min(v, Math.max(0, wallMs)))
}

/** Integers from an untrusted JSON body, or null if any is not one. */
export function ints(body: Record<string, unknown>, keys: string[]): Record<string, number> | null {
    const out: Record<string, number> = {}
    for (const k of keys) {
        const v = body[k]
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1e9) return null
        out[k] = v
    }
    return out
}

export async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
    try {
        const b: unknown = await req.json()
        return b && typeof b === 'object' ? (b as Record<string, unknown>) : {}
    } catch {
        return {}
    }
}
