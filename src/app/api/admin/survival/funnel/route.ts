import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { fetchAll } from '@/lib/survivalFetchAll'
import { FUNNEL_STEPS, SERVER_STEPS } from '@/lib/survivalFunnelServer'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

/**
 * GET /api/admin/survival/funnel — the landing funnel for spltpnl (owner, 03.10.2026: «простая
 * воронка, без усложнений»): six steps, each counted as unique visitors (anonymous browser id) for
 * the page's four steps and unique wallets for first_run / first_purchase, over the last 24 hours
 * and the last 7 days.
 *
 *   → { generatedAt, steps: [{ step, d1, d7 }], truncated }
 *
 * Every step is written once per visitor (or wallet) ever (lib/survivalFunnelServer.ts), so «24 h»
 * reads as «reached this step for the first time in the last 24 h». The percentages the panel shows
 * are each step over the one before it.
 */
export async function GET(request: NextRequest) {
    const denied = await requireAdmin(request)
    if (denied) return denied
    if (!supabaseAdmin) return NextResponse.json({ error: 'Database unavailable' }, { status: 500, headers })
    const now = Date.now()
    const dayAgo = now - 86_400_000
    const weekAgo = new Date(now - 7 * 86_400_000).toISOString()

    const { rows, truncated, error } = await fetchAll<{ id: number; kind: string; wallet: string | null; at: string; anon: string | null }>(
        () => supabaseAdmin.from('survival_events').select('id, kind, wallet, at, anon:data->>anon')
            .in('kind', FUNNEL_STEPS.map((s) => `funnel.${s}`)).gte('at', weekAgo).order('id'),
        { cap: 200_000 },
    )
    if (error) return NextResponse.json({ error }, { status: 500, headers })

    const sets = new Map<string, { d1: Set<string>; d7: Set<string> }>(FUNNEL_STEPS.map((s) => [s, { d1: new Set(), d7: new Set() }]))
    const byWallet = new Set<string>(SERVER_STEPS)
    for (const r of rows) {
        const step = r.kind.slice('funnel.'.length)
        const bucket = sets.get(step)
        if (!bucket) continue
        const who = byWallet.has(step) ? r.wallet : r.anon
        if (!who) continue
        bucket.d7.add(who)
        if (Date.parse(r.at) >= dayAgo) bucket.d1.add(who)
    }
    return NextResponse.json({
        generatedAt: new Date(now).toISOString(),
        steps: FUNNEL_STEPS.map((step) => ({ step, d1: sets.get(step)!.d1.size, d7: sets.get(step)!.d7.size })),
        truncated,
    }, { headers })
}
