import { NextRequest, NextResponse } from 'next/server'
import { eth_blockNumber } from 'thirdweb/rpc'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'
import { apeToWei, CASHIER, describe, encodePay, isMode, isTestSku, loadCatalog, modeOpen, priceFor, resolveItem } from '@/lib/survivalShop'
import { isDroidHolder } from '@/lib/droidHolder'
import { seasonVisibleFor } from '@/lib/survivalAccess'
import { rpc, settlePending, within } from '@/lib/survivalSettle'
import { logEvent } from '@/lib/survivalLog'

/**
 * POST /api/survival/order { sku, mode?: 'solo' | 'coop', platform?: 'site' | 'otherside' }
 *   → { ok: true, orderId, to, valueApe, data, description, mode }
 *     what the page sends: `to` = the cashier, `data` = pay(player, order, mode), value in APE —
 *     from the site through thirdweb, from Otherside through the Hub (GlyphSDK.sendTransaction).
 *   → { ok: false, state: 'not_configured' | 'malformed' | 'unknown_item' | 'mode_closed' | 'no_season' | 'season_over'
 *                      | 'rate_limited' | 'owned' (the pass is already held) | 'pending' (a pass payment is being checked) }
 *
 * POST /api/survival/order { cancel: orderId } — the player said no in the wallet: the order is
 * marked closed (dismissed_at) so it neither counts toward the hourly limit nor crowds the pending
 * scan. Its status stays 'pending': a payment that still turns up is booked (settlePending).
 *
 * What an item is and costs comes from survival_catalog (the owner edits it in spltpnl), never from
 * the client; the order copies the row. Runs feed the pool of the mode they are for; anything else
 * feeds the pool its catalog row names. Co-op is closed until it exists (SURVIVAL_COOP_OPEN=1).
 * A continue is not bought here — it spends a run credit (api/survival/run/continue).
 */
export const dynamic = 'force-dynamic'
const noStore = { 'cache-control': 'no-store' }
const ORDERS_PER_HOUR = 30
/** Orders of any kind, cancelled ones too — a ceiling against «make and cancel» in a loop. */
const ORDERS_PER_HOUR_HARD = 100
/** A pass payment younger than this is still being confirmed: no second pass order meanwhile. */
const PASS_PENDING_MS = 15 * 60 * 1000

export async function POST(req: NextRequest) {
    // A new order asks the gate again: a ban or SURVIVAL_PUBLIC=0 reaches an open tab here.
    const caller = await authCaller(req, { recheck: true })
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    if (!CASHIER) return NextResponse.json({ ok: false, state: 'not_configured' }, { headers: noStore })
    const body = await readBody(req)
    if (typeof body.cancel === 'string') {
        const id = body.cancel.toLowerCase()
        if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ ok: false, state: 'malformed' }, { headers: noStore })
        const { data: closed } = await supabaseAdmin.from('survival_orders').update({ dismissed_at: new Date().toISOString() })
            .eq('id', id).eq('wallet', caller.wallet).eq('status', 'pending').is('dismissed_at', null).select('id')
        if (closed?.length) logEvent({ level: 'info', kind: 'pay.cancelled', wallet: caller.wallet, message: id })
        return NextResponse.json({ ok: true }, { headers: noStore })
    }
    if (typeof body.sku !== 'string' || !/^[a-z0-9_]{2,32}$/.test(body.sku)) return NextResponse.json({ ok: false, state: 'malformed' }, { headers: noStore })
    // A test wallet (SURVIVAL_TEST_WALLETS) asking for `run` is sold `test_run` while that row is
    // active; a `test_*` sku is sold to nobody else (lib/survivalShop.ts resolveItem).
    const item = resolveItem(await loadCatalog(true), body.sku, caller.wallet)
    if (!item) return NextResponse.json({ ok: false, state: 'unknown_item' }, { headers: noStore })
    const test = isTestSku(item.sku)
    // The pass is sold where the season is open for sale (SURVIVAL_SEASON_OPEN or a preview wallet);
    // the test pass to a test wallet (resolveItem already said it is one).
    if (item.kind === 'season_pass' && !test && !seasonVisibleFor(caller.wallet)) return NextResponse.json({ ok: false, state: 'unknown_item' }, { headers: noStore })
    const platform = body.platform === 'otherside' ? 'otherside' : 'site'
    const mode = item.kind === 'runs' && isMode(body.mode) ? body.mode : item.mode
    if (!modeOpen(mode)) return NextResponse.json({ ok: false, state: 'mode_closed' }, { headers: noStore })

    const { data: season } = await supabaseAdmin.from('survival_seasons').select('id, ends_at').eq('status', 'live').limit(1).maybeSingle()
    if (!season) return NextResponse.json({ ok: false, state: 'no_season' }, { headers: noStore })
    // Past the season's end nothing new is sold into it (an order already made is still booked).
    const ends = (season as { ends_at?: string | null }).ends_at
    if (ends && Date.parse(ends) <= Date.now()) return NextResponse.json({ ok: false, state: 'season_over' }, { headers: noStore })

    const since = new Date(Date.now() - 3_600_000).toISOString()
    const [{ count }, { count: all }] = await Promise.all([
        // Orders cancelled in the wallet do not count toward the limit: a player who said no five times can still buy.
        supabaseAdmin.from('survival_orders').select('id', { count: 'exact', head: true }).eq('wallet', caller.wallet).gte('created_at', since).is('dismissed_at', null),
        supabaseAdmin.from('survival_orders').select('id', { count: 'exact', head: true }).eq('wallet', caller.wallet).gte('created_at', since),
    ])
    if ((count ?? 0) >= ORDERS_PER_HOUR || (all ?? 0) >= ORDERS_PER_HOUR_HARD) return NextResponse.json({ ok: false, state: 'rate_limited' }, { headers: noStore })

    // One season pass per season. A second order would take 33 APE for nothing: a pass paid a
    // moment ago whose report never came back is booked first, then looked for.
    if (item.kind === 'season_pass') {
        await within(settlePending(caller.wallet).catch(() => 0), 2500, 0)
        // A test pass is one per season like the real one, and never stands in the way of the real
        // one (it counts for nothing in the pool — survival_season_standings).
        let heldQ = supabaseAdmin.from('survival_entitlements').select('id').eq('wallet', caller.wallet).eq('kind', 'season_pass')
            .or(`season_id.eq.${season.id},season_id.is.null`)
        let flightQ = supabaseAdmin.from('survival_orders').select('id').eq('wallet', caller.wallet).eq('kind', 'season_pass').eq('status', 'pending')
            .is('dismissed_at', null).gte('created_at', new Date(Date.now() - PASS_PENDING_MS).toISOString())
        if (test) { heldQ = heldQ.eq('sku', item.sku); flightQ = flightQ.eq('sku', item.sku) }
        else { heldQ = heldQ.not('sku', 'like', 'test_%'); flightQ = flightQ.not('sku', 'like', 'test_%') }
        const [{ data: held }, { data: inFlight }] = await Promise.all([heldQ.limit(1), flightQ.limit(1)])
        if (held?.length) return NextResponse.json({ ok: false, state: 'owned' }, { headers: noStore })
        if (inFlight?.length) return NextResponse.json({ ok: false, state: 'pending' }, { headers: noStore })
    }

    // A first-time player may buy before ever starting a run: the player row must exist (FK).
    await supabaseAdmin.from('survival_players').upsert({ wallet: caller.wallet, last_seen: new Date().toISOString() }, { onConflict: 'wallet' })
    // Where to look for the Paid event later if the client never returns with the hash.
    // An ApeDroidz holder pays the discounted price (the season pass: −30%). Checked here, on the
    // server, and copied into the order — settlement then holds the payment to exactly this price.
    const price = item.holder_discount_pct > 0 ? priceFor(item, await isDroidHolder(caller.wallet)) : item.price_ape
    // Bounded: a slow public RPC must not hold the purchase. Without it the pending scan looks back
    // one span from the head (lib/survivalSettle.ts settlePending), so the order is still found.
    const fromBlock = await within(eth_blockNumber(rpc()).then((b) => Number(b)).catch(() => null), 1500, null)
    const { data: order, error } = await supabaseAdmin.from('survival_orders').insert({
        wallet: caller.wallet, season_id: season.id, sku: item.sku, kind: item.kind, credits: item.kind === 'runs' ? item.credits : 0,
        price_ape: price, min_wei: apeToWei(price).toString(), grant_spec: item.grant_spec,
        platform, from_block: fromBlock, mode,
    }).select('id').single()
    if (error || !order) { console.error('[survival/order]', error?.message); return noServer('order', error?.message) }

    return NextResponse.json({
        ok: true, orderId: order.id, to: CASHIER, valueApe: String(price),
        mode, data: encodePay(caller.wallet, order.id, mode), description: describe(item, mode),
    }, { headers: noStore })
}
