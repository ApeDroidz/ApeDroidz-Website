import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { logEvent } from '@/lib/survivalLog'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }

/**
 * POST /api/admin/survival/runs/disqualify { runId, note? }
 *
 * Takes ONE accepted run off the board after a human review (spltpnl → Review — top & flagged
 * runs), without banning the wallet. The run becomes `rejected` / `admin_review` — its numbers stay
 * as evidence — and the wallet's board row is rebuilt from its best remaining accepted run, or
 * removed if none is left. The survival_runs_to_best trigger only ever raises a best (it fires on
 * the way INTO `finished`), so the rebuild is done here.
 *
 * What the run already paid (Ape Mini, salvage, season XP) is not taken back — that is a separate
 * call for the owner.
 */
export async function POST(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const db = supabaseAdmin
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const runId = typeof body.runId === 'string' ? body.runId.toLowerCase() : ''
    if (!/^[0-9a-f-]{36}$/.test(runId)) return NextResponse.json({ error: 'Not a run id' }, { status: 400, headers })
    const note = typeof body.note === 'string' ? body.note.slice(0, 200) : ''

    const { data: took, error } = await db.from('survival_runs')
        .update({ status: 'rejected', reject_reason: 'admin_review', verified: 'none' })
        .eq('id', runId).eq('status', 'finished').select('id, wallet, season_id, score, wave')
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers })
    const run = (took as Array<{ id: string; wallet: string; season_id: string; score: number; wave: number }> | null)?.[0]
    if (!run) return NextResponse.json({ error: 'No accepted run with this id' }, { status: 404, headers })

    // The board row, rebuilt from what is left.
    const [{ data: best }, { count }] = await Promise.all([
        db.from('survival_runs').select('id, score, wave, kills, finished_at').eq('season_id', run.season_id).eq('wallet', run.wallet)
            .eq('status', 'finished').order('score', { ascending: false }).order('finished_at', { ascending: true }).limit(1).maybeSingle(),
        db.from('survival_runs').select('id', { count: 'exact', head: true }).eq('season_id', run.season_id).eq('wallet', run.wallet).eq('status', 'finished'),
    ])
    const next = best as { id: string; score: number; wave: number; kills: number; finished_at: string | null } | null
    const board = next
        ? await db.from('survival_season_best').upsert({
            season_id: run.season_id, wallet: run.wallet, run_id: next.id, score: next.score, wave: next.wave, kills: next.kills,
            achieved_at: next.finished_at ?? new Date().toISOString(), runs_count: count ?? 1,
        }, { onConflict: 'season_id,wallet' })
        : await db.from('survival_season_best').delete().eq('season_id', run.season_id).eq('wallet', run.wallet)
    if (board.error) return NextResponse.json({ error: `run disqualified, board not rebuilt: ${board.error.message}` }, { status: 500, headers })

    logEvent({
        level: 'warn', kind: 'run.disqualified', wallet: run.wallet, runId: run.id, message: note,
        data: { by: 'spltpnl', score: run.score, wave: run.wave, boardNow: next ? { runId: next.id, score: next.score } : null },
    })
    return NextResponse.json({ ok: true, runId: run.id, board: next ? { runId: next.id, score: next.score } : null }, { headers })
}
