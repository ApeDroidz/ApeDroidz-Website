import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer } from '@/lib/survivalRuns'
import { loadForecast } from '@/lib/survivalForecast'

/**
 * GET /api/survival/pool/forecast — the pool as it will be paid, and this player's share if the
 * season ended now (lib/survivalForecast.ts). Signed-in only: it names the caller's rank.
 *
 *   { ok, poolApe, reserveApe, reservePct, payoutApe, eligible, passHolders, places, cutoffScore,
 *     me: { best, hasPass, rank, forecastApe } }
 *
 * Without a pass, `me` answers «what would I take with one» — the game shows it as the reason to buy.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const f = await loadForecast(caller.wallet)
    if (!f) return NextResponse.json({ ok: false, state: 'no_season' }, { headers: { 'cache-control': 'no-store' } })
    return NextResponse.json({ ok: true, ...f }, { headers: { 'cache-control': 'no-store' } })
}
