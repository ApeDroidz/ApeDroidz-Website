import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer } from '@/lib/survivalRuns'
import { CASHIER, SKUS } from '@/lib/survivalShop'
import { settlePending } from '@/lib/survivalSettle'

/**
 * GET /api/survival/credits → { ok, credits, booked, paidRuns, shop: { configured, skus } }
 *
 * How many runs the player has paid for and not yet played. Books any order that was paid but
 * never reported first (lib/survivalSettle.ts settlePending), so a closed tab never costs a run.
 * `paidRuns` says whether starting a run needs a credit right now (SURVIVAL_PAID_RUNS=1).
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const booked = await settlePending(caller.wallet).catch(() => 0)
    const { count, error } = await supabaseAdmin.from('survival_credits').select('id', { count: 'exact', head: true })
        .eq('wallet', caller.wallet).is('consumed_by_run', null)
    if (error) { console.error('[survival/credits]', error.message); return noServer() }
    return NextResponse.json({
        ok: true, credits: count ?? 0, booked, paidRuns: process.env.SURVIVAL_PAID_RUNS === '1',
        shop: { configured: !!CASHIER, skus: SKUS },
    }, { headers: { 'cache-control': 'no-store' } })
}
