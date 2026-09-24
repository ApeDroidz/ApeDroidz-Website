import { NextRequest, NextResponse } from 'next/server'
import { eth_blockNumber } from 'thirdweb/rpc'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'
import { apeToWei, CASHIER, describe, encodePay, isMode, loadCatalog, modeOpen } from '@/lib/survivalShop'
import { rpc } from '@/lib/survivalSettle'

/**
 * POST /api/survival/order { sku, mode?: 'solo' | 'coop', platform?: 'site' | 'otherside' }
 *   → { ok: true, orderId, to, valueApe, data, description, mode }
 *     what the page sends: `to` = the cashier, `data` = pay(player, order, mode), value in APE —
 *     from the site through thirdweb, from Otherside through the Hub (GlyphSDK.sendTransaction).
 *   → { ok: false, state: 'not_configured' | 'malformed' | 'unknown_item' | 'mode_closed' | 'no_season' | 'rate_limited' }
 *
 * What an item is and costs comes from survival_catalog (the owner edits it in spltpnl), never from
 * the client; the order copies the row. Runs feed the pool of the mode they are for; anything else
 * feeds the pool its catalog row names. Co-op is closed until it exists (SURVIVAL_COOP_OPEN=1).
 * A continue is not bought here — it spends a run credit (api/survival/run/continue).
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
    if (typeof body.sku !== 'string' || !/^[a-z0-9_]{2,32}$/.test(body.sku)) return NextResponse.json({ ok: false, state: 'malformed' }, { headers: noStore })
    const item = (await loadCatalog(true)).find((c) => c.sku === body.sku)
    if (!item) return NextResponse.json({ ok: false, state: 'unknown_item' }, { headers: noStore })
    const platform = body.platform === 'otherside' ? 'otherside' : 'site'
    const mode = item.kind === 'runs' && isMode(body.mode) ? body.mode : item.mode
    if (!modeOpen(mode)) return NextResponse.json({ ok: false, state: 'mode_closed' }, { headers: noStore })

    const { data: season } = await supabaseAdmin.from('survival_seasons').select('id').eq('status', 'live').limit(1).maybeSingle()
    if (!season) return NextResponse.json({ ok: false, state: 'no_season' }, { headers: noStore })

    const since = new Date(Date.now() - 3_600_000).toISOString()
    const { count } = await supabaseAdmin.from('survival_orders').select('id', { count: 'exact', head: true }).eq('wallet', caller.wallet).gte('created_at', since)
    if ((count ?? 0) >= ORDERS_PER_HOUR) return NextResponse.json({ ok: false, state: 'rate_limited' }, { headers: noStore })

    // A first-time player may buy before ever starting a run: the player row must exist (FK).
    await supabaseAdmin.from('survival_players').upsert({ wallet: caller.wallet, last_seen: new Date().toISOString() }, { onConflict: 'wallet' })
    // Where to look for the Paid event later if the client never returns with the hash.
    const fromBlock = await eth_blockNumber(rpc()).then((b) => Number(b)).catch(() => null)
    const { data: order, error } = await supabaseAdmin.from('survival_orders').insert({
        wallet: caller.wallet, season_id: season.id, sku: item.sku, kind: item.kind, credits: item.kind === 'runs' ? item.credits : 0,
        price_ape: item.price_ape, min_wei: apeToWei(item.price_ape).toString(), grant_spec: item.grant_spec,
        platform, from_block: fromBlock, mode,
    }).select('id').single()
    if (error || !order) { console.error('[survival/order]', error?.message); return noServer() }

    return NextResponse.json({
        ok: true, orderId: order.id, to: CASHIER, valueApe: String(item.price_ape),
        mode, data: encodePay(caller.wallet, order.id, mode), description: describe(item, mode),
    }, { headers: noStore })
}
