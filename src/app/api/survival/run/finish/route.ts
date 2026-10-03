import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, closedLine, flagsOf, ints, LATE_FLAG, loadRun, noServer, readBody, REFUNDED_FLAG, RESTORED_FLAG, type RunRow } from '@/lib/survivalRuns'
import { checkFinish, type Check } from '@/lib/survivalEnvelope'
import { logEvent } from '@/lib/survivalLog'
import { runAlreadyPaid, runReward, type RunReport } from '@/lib/survivalEconomy'
import { withEcon } from '@/lib/survivalEconomyStore'
import { markFirstRun } from '@/lib/survivalFunnelServer'

/**
 * POST /api/survival/run/finish  { runId, wave, kills, score, durationMs }
 *
 * Closes the ticket. The claim is checked against the server's clock and the pulse trail
 * (src/lib/survivalEnvelope.ts); the verdict is stored AND returned, because the player is told
 * on the result screen what happened to their score:
 *   { ok: true, verdict: 'accepted', rank, note?, economy, dailyBonus }
 *                                                             — on the board (survival_season_best via trigger);
 *                                                               `economy.paid` is the run's pay, `dailyBonus`
 *                                                               (= economy.paid.daily) whether it was one of
 *                                                               today's x2 runs and how many are left
 *   { ok: true, verdict: 'rejected', reason, message, why }   — «CHEATING DETECTED - RESULT NOT COUNTED» + why
 *   { ok: true, verdict: 'void', reason, message, why }       — too short to count, or closed; nobody is accused
 *   { ok: false, state: 'no_run' | 'malformed' | … }          — nothing recorded (the game says «offline»)
 *
 * A finish for a run that is already closed answers the verdict that stands (it used to answer
 * `run_closed`, which the game showed as «offline» — for a run a pulse had rejected, too), so a
 * finish retried after its reply was lost reads the same thing again.
 *
 * The late finish: a run closed under its game — superseded by the next start (PLAY AGAIN raced
 * this very request) or expired — still takes its finish, checked the same way, once: a run
 * counted from its last pulse is brought up to the full result, a voided one that had no credit
 * to refund is counted. Every close is conditional on the status it was read in, so two requests
 * can never both close one run.
 */
export const dynamic = 'force-dynamic'
/** Flags that put an accepted run in front of a human (spltpnl → Review). */
const REVIEW_FLAGS = new Set(['pulses_missing', 'wave_ahead_of_clock', 'pulse_wave_ahead_of_clock'])
const noStore = { 'cache-control': 'no-store' }

export async function POST(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const body = await readBody(req)
    let run = await loadRun(body.runId, caller.wallet)
    if (run instanceof NextResponse) return run
    if (run.status !== 'started' && !lateFinishable(run)) return storedVerdict(run, caller.wallet)

    const n = ints(body, ['wave', 'kills', 'score', 'durationMs'])
    if (!n) return NextResponse.json({ ok: false, state: 'malformed' })
    const claim = n
    const wallet = caller.wallet

    const now = Date.now()
    const judge = (r: RunRow) => {
        const serverDurationMs = now - new Date(r.started_at).getTime()
        const check = checkFinish(
            {
                serverDurationMs,
                lastPulse: r.last_pulse_wave === null ? null
                    : { wave: r.last_pulse_wave, kills: r.last_pulse_kills ?? 0, score: r.last_pulse_score ?? 0 },
                pulseCount: r.pulse_count,
            },
            { wave: n.wave, kills: n.kills, score: n.score, durationMs: n.durationMs },
        )
        return { check, serverDurationMs }
    }
    const logCheck = (r: RunRow, check: Check, serverDurationMs: number, late: boolean) => {
        if (check.verdict === 'ok' && !check.flags.length && !late) return
        // The flags that mean «look at this run before paying the pool» are warnings (Alerts): a
        // run with its pulses missing, or ahead of the physical pace.
        const serious = check.flags.some((f) => REVIEW_FLAGS.has(f))
        logEvent({
            level: check.verdict === 'cheat' || serious ? 'warn' : 'info',
            kind: check.verdict === 'cheat' ? 'run.rejected' : check.verdict === 'void' ? 'run.void' : late ? 'run.late_finish' : 'run.flagged',
            wallet: caller.wallet, runId: r.id, message: check.reason ?? check.flags.join(','),
            data: { claim: n, serverDurationMs, lastPulse: r.last_pulse_wave, pulses: r.pulse_count, flags: check.flags, late, closedAs: late ? r.status : undefined },
        })
    }

    /** The run is on the board: where it stands, and its pay. */
    const accept = async (r: RunRow, c: Check, serverMs: number): Promise<NextResponse> => {
        const rank = await rankOf(r.season_id, wallet)
        // The run's pay — here, from the run we just verified (lib/survivalEconomy.ts runReward): Ape
        // Mini, salvage, season XP, the bestiary, today's quests. The client's `report` can only lower
        // it (every number in it is capped by the verified score, wave, kills and time).
        // DAILY BONUS: the runs accepted AND paid today are counted in the same write as the pay
        // (the daily part's runDay/runsPaid, inside withEcon's compare-and-set), so two finishes
        // racing cannot both take the third x2, and a run accepted but never paid uses none up.
        const report = (body as { report?: unknown }).report
        const rep0: RunReport = report && typeof report === 'object' ? report as RunReport : {}
        // The hero is the one the run was OPENED with (checked against the save at runs/start),
        // not the report's: DATA SIPHON pays by the hero that played.
        const rep: RunReport = r.hero ? { ...rep0, hero: r.hero } : rep0
        let economy: Record<string, unknown> | null = null
        let dailyBonus: unknown = null
        const paid = await withEcon(wallet, r.season_id, (loaded) => {
            // Paid once per run, whatever reaches here twice: the run id is written with the pay.
            if (runAlreadyPaid(loaded.econ, r.id)) return null
            const x = runReward(loaded.econ, { score: claim.score, wave: claim.wave, kills: claim.kills, durationMs: Math.min(claim.durationMs, serverMs), runId: r.id }, rep, { now })
            return { next: x.econ, out: x.paid }
        })
        if (paid.ok && paid.out === null) {
            logEvent({ level: 'warn', kind: 'economy.run_repeat', wallet, runId: r.id, message: 'finish already paid — not paid again' })
        } else if (paid.ok) {
            economy = { paid: paid.out, state: paid.econ.state, season: paid.econ.season, daily: paid.econ.daily }
            dailyBonus = (paid.out as { daily?: unknown } | null)?.daily ?? null
            const bonusNote = (dailyBonus as { applied?: boolean } | null)?.applied ? ' (daily x2)' : ''
            logEvent({ level: 'info', kind: 'economy.run_paid', wallet, runId: r.id, message: `${(paid.out as { coins?: number } | null)?.coins ?? 0} mini${bonusNote}`, data: { paid: paid.out } })
        } else {
            logEvent({ level: 'error', kind: 'economy.run_unpaid', wallet, runId: r.id, message: paid.error })
        }
        return NextResponse.json({ ok: true, verdict: 'accepted', rank, flags: c.flags, economy, dailyBonus }, { headers: noStore })
    }

    if (run.status === 'started') {
        const { check, serverDurationMs } = judge(run)
        const status = check.verdict === 'ok' ? 'finished' : check.verdict === 'cheat' ? 'rejected' : 'void'
        // Where runs end — the first boss wall (wave 5) — measured on live players: a death on a
        // boss wave with that wave's boss still standing (the report's own boss count).
        const rep = (body as { report?: { bosses?: unknown } }).report
        const bosses = typeof rep?.bosses === 'number' ? rep.bosses : null
        const wall = bosses !== null && n.wave % 5 === 0 && bosses < n.wave / 5 ? [`died_boss_alive:w${n.wave}`] : []
        const { data: closed, error } = await supabaseAdmin.from('survival_runs')
            .update({
                status, reject_reason: check.reason ?? null,
                // The pulses' own review flags stay with the run.
                flags: [...new Set([...flagsOf(run), ...check.flags, ...wall])],
                finished_at: new Date(now).toISOString(), server_duration_ms: serverDurationMs,
                client_duration_ms: n.durationMs,
                // The claimed numbers are stored for every verdict — a rejected run is evidence.
                score: n.score, wave: n.wave, kills: n.kills,
                verified: check.verdict === 'ok' ? 'envelope' : 'none',
            })
            .eq('id', run.id).eq('status', 'started').select('id')
        if (error) { console.error('[survival/run/finish]', error.message); return noServer('run.finish', error.message) }
        if (closed?.length) {
            // The funnel's «first run» (lib/survivalFunnelServer.ts): this wallet's first run to be
            // closed by its finish, whatever the verdict — started now, awaited before the reply.
            const first = markFirstRun(wallet, run.id)
            logCheck(run, check, serverDurationMs, false)
            const reply = check.verdict !== 'ok' ? refused(check) : await accept(run, check, serverDurationMs)
            await first
            return reply
        }
        // Closed between the read and the write — a newer start, or this same finish retried.
        const again = await loadRun(run.id, caller.wallet)
        if (again instanceof NextResponse) return again
        if (again.status === 'started' || !lateFinishable(again)) return storedVerdict(again, caller.wallet)
        run = again
    }

    // ── The late finish ────────────────────────────────────────────────────────────────────
    const late = run
    const { check, serverDurationMs } = judge(late)
    logCheck(late, check, serverDurationMs, true)
    if (check.verdict === 'cheat') {
        // The run keeps what it had (its checkpoint result, or nothing); the claim is kept for review.
        await supabaseAdmin.from('survival_runs')
            .update({ flags: [...new Set([...flagsOf(late), LATE_FLAG, `late_refused:${check.reason}`])] }).eq('id', late.id)
        return refused(check)
    }
    if (check.verdict !== 'ok') return storedVerdict(late, caller.wallet)
    const full = {
        score: n.score, wave: n.wave, kills: n.kills, finished_at: new Date(now).toISOString(),
        server_duration_ms: serverDurationMs, client_duration_ms: n.durationMs, verified: 'envelope',
        flags: [...new Set([...flagsOf(late), ...check.flags, LATE_FLAG])],
    }
    if (late.status === 'void') {
        // Void → finished: the survival_runs_to_best trigger puts it on the board.
        const { data: took, error } = await supabaseAdmin.from('survival_runs')
            .update({ ...full, status: 'finished', reject_reason: null })
            .eq('id', late.id).eq('status', 'void').select('id')
        if (error) { console.error('[survival/run/finish] late', error.message); return noServer('run.finish.late', error.message) }
        if (!took?.length) return storedVerdict(late, caller.wallet)
    } else {
        // Counted from its last pulse already: the trigger fires only on the way INTO `finished`,
        // so the board row is brought up here, by the trigger's own rule — this run's row, or a
        // strictly better score than the wallet's best.
        const { data: took, error } = await supabaseAdmin.from('survival_runs')
            .update(full)
            .eq('id', late.id).eq('status', 'finished').not('flags', 'cs', JSON.stringify([LATE_FLAG])).select('id')
        if (error) { console.error('[survival/run/finish] late', error.message); return noServer('run.finish.late', error.message) }
        if (!took?.length) return storedVerdict(late, caller.wallet)
        const { error: bErr } = await supabaseAdmin.from('survival_season_best')
            .update({ run_id: late.id, score: n.score, wave: n.wave, kills: n.kills, achieved_at: full.finished_at })
            .eq('season_id', late.season_id).eq('wallet', caller.wallet)
            .or(`run_id.eq.${late.id},score.lt.${n.score}`)
        if (bErr) console.error('[survival/run/finish] late best', bErr.message)
    }
    return accept(late, check, serverDurationMs)
}

/** A refusal in the player's words: the verdict, the reason, and why. */
function refused(check: Check): NextResponse {
    return NextResponse.json(
        { ok: true, verdict: check.verdict === 'cheat' ? 'rejected' : 'void', reason: check.reason, message: check.message, why: check.why },
        { headers: noStore },
    )
}

/**
 * Whether a closed run still takes its finish: counted from its last pulse and not yet brought up,
 * or voided as superseded / expired with nothing refunded (a refunded run was not paid for — its
 * result would be a free run).
 */
function lateFinishable(run: RunRow): boolean {
    const flags = flagsOf(run)
    if (flags.includes(LATE_FLAG)) return false
    if (run.status === 'finished') return flags.includes(RESTORED_FLAG)
    return run.status === 'void' && (run.reject_reason === 'superseded' || run.reject_reason === 'expired') && !flags.includes(REFUNDED_FLAG)
}

/** The verdict that stands for a run closed earlier — answered again, never re-judged. */
async function storedVerdict(run: RunRow, wallet: string): Promise<NextResponse> {
    const flags = flagsOf(run)
    const line = closedLine(run)
    if (run.status === 'finished') {
        const restored = flags.includes(RESTORED_FLAG) && !flags.includes(LATE_FLAG)
        return NextResponse.json({
            ok: true, verdict: 'accepted', rank: await rankOf(run.season_id, wallet), flags, economy: null, repeat: true,
            ...(restored ? { note: line.message, why: line.why } : {}),
        }, { headers: noStore })
    }
    if (run.status === 'rejected' || run.status === 'void') {
        return NextResponse.json({ ok: true, verdict: run.status, reason: run.reject_reason, ...line }, { headers: noStore })
    }
    return NextResponse.json({ ok: false, state: 'run_open' }, { headers: noStore })
}

/** Where the wallet stands on the season board now (the trigger has just applied the run). */
async function rankOf(seasonId: string, wallet: string): Promise<number | null> {
    const { data: board } = await supabaseAdmin
        .from('survival_board').select('rank, wallet_short').eq('season_id', seasonId)
        .order('rank', { ascending: true }).limit(500)
    const short = wallet.slice(0, 6) + '…' + wallet.slice(-4)
    const mine = board?.find((b: { wallet_short: string; rank: number }) => b.wallet_short === short)
    return mine ? Number(mine.rank) : null
}
