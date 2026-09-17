import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, ints, loadRun, noServer, readBody } from '@/lib/survivalRuns'
import { checkFinish } from '@/lib/survivalEnvelope'
import { logEvent } from '@/lib/survivalLog'

/**
 * POST /api/survival/run/finish  { runId, wave, kills, score, durationMs }
 *
 * Closes the ticket. The claim is checked against the server's clock and the pulse trail
 * (src/lib/survivalEnvelope.ts); the verdict is stored AND returned, because the player is told
 * on the result screen what happened to their score:
 *   { ok: true, verdict: 'accepted', rank }              — on the board (survival_season_best via trigger)
 *   { ok: true, verdict: 'rejected', reason, message }   — «CHEATING DETECTED - RESULT NOT COUNTED»
 *   { ok: true, verdict: 'void', reason, message }       — too short to count; nobody is accused
 *   { ok: false, state: 'no_run' | 'run_closed' | … }    — nothing recorded (the game says «offline»)
 * A second finish for the same run is `run_closed`: the first verdict stands.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const body = await readBody(req)
    const run = await loadRun(body.runId, caller.wallet)
    if (run instanceof NextResponse) return run
    if (run.status !== 'started') return NextResponse.json({ ok: false, state: 'run_closed' })

    const n = ints(body, ['wave', 'kills', 'score', 'durationMs'])
    if (!n) return NextResponse.json({ ok: false, state: 'malformed' })

    const now = Date.now()
    const serverDurationMs = now - new Date(run.started_at).getTime()
    const check = checkFinish(
        {
            serverDurationMs,
            lastPulse: run.last_pulse_wave === null ? null
                : { wave: run.last_pulse_wave, kills: run.last_pulse_kills ?? 0, score: run.last_pulse_score ?? 0 },
            pulseCount: run.pulse_count,
        },
        { wave: n.wave, kills: n.kills, score: n.score, durationMs: n.durationMs },
    )

    const status = check.verdict === 'ok' ? 'finished' : check.verdict === 'cheat' ? 'rejected' : 'void'
    const { error } = await supabaseAdmin.from('survival_runs')
        .update({
            status, reject_reason: check.reason ?? null, flags: check.flags,
            finished_at: new Date(now).toISOString(), server_duration_ms: serverDurationMs,
            client_duration_ms: n.durationMs,
            // The claimed numbers are stored for every verdict — a rejected run is evidence.
            score: n.score, wave: n.wave, kills: n.kills,
            verified: check.verdict === 'ok' ? 'envelope' : 'none',
        })
        .eq('id', run.id)
    if (error) { console.error('[survival/run/finish]', error.message); return noServer() }

    if (check.verdict !== 'ok' || check.flags.length) {
        logEvent({
            level: check.verdict === 'cheat' ? 'warn' : 'info',
            kind: check.verdict === 'cheat' ? 'run.rejected' : check.verdict === 'void' ? 'run.void' : 'run.flagged',
            wallet: caller.wallet, runId: run.id, message: check.reason ?? check.flags.join(','),
            data: { claim: n, serverDurationMs, lastPulse: run.last_pulse_wave, pulses: run.pulse_count, flags: check.flags },
        })
    }
    if (check.verdict !== 'ok') {
        return NextResponse.json({ ok: true, verdict: check.verdict === 'cheat' ? 'rejected' : 'void', reason: check.reason, message: check.message })
    }

    // Where the wallet stands on the season board now (the trigger has just applied the run).
    let rank: number | null = null
    const { data: board } = await supabaseAdmin
        .from('survival_board').select('rank, wallet_short').eq('season_id', run.season_id)
        .order('rank', { ascending: true }).limit(500)
    const short = caller.wallet.slice(0, 6) + '…' + caller.wallet.slice(-4)
    const mine = board?.find((b: { wallet_short: string; rank: number }) => b.wallet_short === short)
    if (mine) rank = Number(mine.rank)

    return NextResponse.json({ ok: true, verdict: 'accepted', rank, flags: check.flags }, { headers: { 'cache-control': 'no-store' } })
}
