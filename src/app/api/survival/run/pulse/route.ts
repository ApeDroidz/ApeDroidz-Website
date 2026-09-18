import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, ints, loadRun, noServer, readBody } from '@/lib/survivalRuns'
import { checkPulse } from '@/lib/survivalEnvelope'
import { logEvent } from '@/lib/survivalLog'

/**
 * POST /api/survival/run/pulse  { runId, wave, kills, score }
 *
 * The heartbeat, sent once per new wave (~every 30 s). Records where the run is so the finish
 * can be checked against a trail and not only against a single claim. A pulse that contradicts
 * the trail or the clock rejects the run on the spot and says so; a pulse that simply never
 * arrives (bad network) costs nothing — see checkFinish's soft flags.
 *
 * Replies: { ok: true } · { ok: true, verdict: 'rejected', message } · { ok: false, state }
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

    const n = ints(body, ['wave', 'kills', 'score'])
    if (!n) return NextResponse.json({ ok: false, state: 'malformed' })

    const prev = run.last_pulse_wave === null ? null
        : { wave: run.last_pulse_wave, kills: run.last_pulse_kills ?? 0, score: run.last_pulse_score ?? 0 }
    const elapsed = Date.now() - new Date(run.started_at).getTime()
    const check = checkPulse(prev, { wave: n.wave, kills: n.kills, score: n.score }, elapsed)

    if (check.verdict === 'cheat') {
        logEvent({ level: 'warn', kind: 'run.rejected', wallet: caller.wallet, runId: run.id, message: check.reason, data: { pulse: n, prev, elapsed } })
        await supabaseAdmin.from('survival_runs')
            .update({ status: 'rejected', reject_reason: check.reason, finished_at: new Date().toISOString() })
            .eq('id', run.id)
        return NextResponse.json({ ok: true, verdict: 'rejected', reason: check.reason, message: check.message })
    }

    // The pulse is the player's heartbeat: last_seen follows it, so "online now" in the
    // panel is simply who pulsed in the last few minutes.
    void supabaseAdmin.from('survival_players').update({ last_seen: new Date().toISOString() }).eq('wallet', caller.wallet)
    const { error } = await supabaseAdmin.from('survival_runs')
        .update({
            last_pulse_at: new Date().toISOString(), last_pulse_wave: n.wave, last_pulse_kills: n.kills,
            last_pulse_score: n.score, pulse_count: run.pulse_count + 1,
        })
        .eq('id', run.id)
    if (error) { console.error('[survival/run/pulse]', error.message); return noServer() }
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
}
