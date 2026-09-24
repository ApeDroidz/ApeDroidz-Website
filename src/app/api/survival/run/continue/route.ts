import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'

/**
 * POST /api/survival/run/continue { runId? } → { ok: true } | { ok: false, state: 'no_run' | 'already' | 'no_credit' }
 *
 * Owner, 25.09.2026: «продление игры после смерти = запуску новой игры по цене». A continue spends one
 * run credit on the run already going — the caller's own open run (named, or else the latest), once
 * per run (survival_continue_run, atomic). With no credit the game sends the player to buy a run
 * first; the CONTINUE countdown is paused while they pay.
 */
export const dynamic = 'force-dynamic'
const noStore = { 'cache-control': 'no-store' }

export async function POST(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const body = await readBody(req)
    const named = typeof body.runId === 'string' && /^[0-9a-f-]{36}$/i.test(body.runId) ? body.runId : ''
    let runId = named
    if (!runId) {
        const { data } = await supabaseAdmin.from('survival_runs').select('id').eq('wallet', caller.wallet).eq('status', 'started')
            .order('started_at', { ascending: false }).limit(1).maybeSingle()
        runId = (data as { id: string } | null)?.id ?? ''
    }
    if (!runId) return NextResponse.json({ ok: false, state: 'no_run' }, { headers: noStore })
    const { data, error } = await supabaseAdmin.rpc('survival_continue_run', { p_wallet: caller.wallet, p_run: runId })
    if (error) { console.error('[survival/run/continue]', error.message); return noServer() }
    return NextResponse.json(data === 'ok' ? { ok: true } : { ok: false, state: data }, { headers: noStore })
}
