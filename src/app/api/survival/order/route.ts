import { NextRequest, NextResponse } from 'next/server'
import { eth_blockNumber } from 'thirdweb/rpc'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'
import { apeToWei, CASHIER, describe, encodePay, isMode, isSku, modeOpen, SKUS } from '@/lib/survivalShop'
import { rpc } from '@/lib/survivalSettle'

/**
 * POST /api/survival/order { sku: 'run' | 'run10' | 'continue', mode?: 'solo' | 'coop', runId?, platform?: 'site' | 'otherside' }
 *   → { ok: true, orderId, to, valueApe, data, description }
 *     what the page sends: `to` = the cashier, `data` = pay(player, order), value in APE —
 *     from the site through thirdweb, from Otherside through the Hub (GlyphSDK.sendTransaction).
 *   → { ok: false, state: 'not_configured' | 'malformed' | 'mode_closed' | 'no_season' | 'no_run' | 'rate_limited' }
 * The mode decides which season pool the purchase feeds (the cashier pays that mode's vault);
 * co-op is closed until it exists (SURVIVAL_COOP_OPEN=1). A continue takes its run's mode.
 *
 * The price and what it buys are the server's (lib/survivalShop.ts), never the client's. A
 * continue belongs to the caller's own open run (named, or the latest one).
 */
export const dynamic = 'force-dynamic'
const noStore = { 'cache-control': 'no-store' }
const ORDERS_PER_HOUR = 30

export async function POST(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    if (!CASHIER) return NextResponse.json({ ok: false, state: 'not_configured' }, { headers: noStore })
    const body = await readBody(req)
    if (!isSku(body.sku)) return NextResponse.json({ ok: false, state: 'malformed' }, { headers: noStore })
    const sku = body.sku
    const platform = body.platform === 'otherside' ? 'otherside' : 'site'
    let mode = isMode(body.mode) ? body.mode : 'solo'

    const { data: season } = await supabaseAdmin.from('survival_seasons').select('id').eq('status', 'live').limit(1).maybeSingle()
    if (!season) return NextResponse.json({ ok: false, state: 'no_season' }, { headers: noStore })

    let runId: string | null = null
    if (sku === 'continue') {
        // The game asks for a continue without naming the run (DroidzPay.charge('continue')):
        // it is the caller's own open run — the one named, or else the latest one.
        const id = typeof body.runId === 'string' && /^[0-9a-f-]{36}$/i.test(body.runId) ? body.runId : ''
        const q = supabaseAdmin.from('survival_runs').select('id, wallet, status, mode').eq('wallet', caller.wallet).eq('status', 'started')
        const { data: run } = await (id ? q.eq('id', id) : q.order('started_at', { ascending: false })).limit(1).maybeSingle()
        if (!run) return NextResponse.json({ ok: false, state: 'no_run' }, { headers: noStore })
        runId = (run as { id: string }).id
        mode = (run as { mode: string }).mode === 'coop' ? 'coop' : 'solo'
    }
    if (!modeOpen(mode)) return NextResponse.json({ ok: false, state: 'mode_closed' }, { headers: noStore })

    const since = new Date(Date.now() - 3_600_000).toISOString()
    const { count } = await supabaseAdmin.from('survival_orders').select('id', { count: 'exact', head: true }).eq('wallet', caller.wallet).gte('created_at', since)
    if ((count ?? 0) >= ORDERS_PER_HOUR) return NextResponse.json({ ok: false, state: 'rate_limited' }, { headers: noStore })

    // A first-time player may buy before ever starting a run: the player row must exist (FK).
    await supabaseAdmin.from('survival_players').upsert({ wallet: caller.wallet, last_seen: new Date().toISOString() }, { onConflict: 'wallet' })
    // Where to look for the Paid event later if the client never returns with the hash.
    const fromBlock = await eth_blockNumber(rpc()).then((b) => Number(b)).catch(() => null)
    const s = SKUS[sku]
    const { data: order, error } = await supabaseAdmin.from('survival_orders').insert({
        wallet: caller.wallet, season_id: season.id, sku, credits: s.credits, price_ape: s.priceApe,
        min_wei: apeToWei(s.priceApe).toString(), run_id: runId, platform, from_block: fromBlock, mode,
    }).select('id').single()
    if (error || !order) { console.error('[survival/order]', error?.message); return noServer() }

    return NextResponse.json({
        ok: true, orderId: order.id, to: CASHIER, valueApe: String(s.priceApe),
        mode, data: encodePay(caller.wallet, order.id, mode), description: describe(sku, mode),
    }, { headers: noStore })
}
