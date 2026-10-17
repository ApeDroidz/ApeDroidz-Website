import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer } from '@/lib/survivalRuns'
import { CASHIER, catalogFor, loadCatalog, publicCatalog } from '@/lib/survivalShop'
import { settlePending, within } from '@/lib/survivalSettle'
import { anyDroidHolder } from '@/lib/droidHolder'
import { seasonVisibleFor } from '@/lib/survivalAccess'

/**
 * GET /api/survival/credits → { ok, credits: { solo, coop, free }, booked, paidRuns, shop: { configured, items } }
 * `items` is the live price list (survival_catalog, active rows) — the game shows these prices.
 *
 * How many runs the player has paid for and not yet played — a new wallet's three free welcome
 * runs included (granted here, on its first read). Books any order that was paid but
 * never reported first (lib/survivalSettle.ts settlePending), so a closed tab never costs a run.
 * `paidRuns` says whether starting a run needs a credit right now (SURVIVAL_PAID_RUNS=1).
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    // The price list must never wait on the chain (25.09.2026: an owner's two stale unpaid orders
    // made every read scan the chain for ~6 s, the droid check took up to 15 s, and the game gave
    // up at 8 s — no LUCKY TICKET in the menu, the pass button dead). Both run in parallel on a
    // budget; what does not finish in time finishes on the next read. An order is priced on its
    // own (api/survival/order checks the droid again), so a missed holder check only shows the
    // full price here, it never charges it.
    // The droid check (Insight, up to 2 s) only where a holder price can be shown: a discounted
    // item this wallet may buy (the pass only where the season is on sale for it).
    // Test rows (test_*) only for SURVIVAL_TEST_WALLETS, standing in for the real items there.
    const catalog = catalogFor(await loadCatalog(true), caller.wallet)
    const needHolder = catalog.some((i) => i.holder_discount_pct > 0 && (i.kind !== 'season_pass' || seasonVisibleFor(caller.wallet)))
    const [booked, holderNow] = await Promise.all([
        within(settlePending(caller.wallet).catch(() => 0), 2500, 0),
        needHolder ? within(anyDroidHolder(caller.wallets), 2000, false) : Promise.resolve(false),
    ])
    // A new player's three free full runs (owner, 15.10.2026), granted on the first read — once per
    // wallet, never to one that already played (survival_grant_welcome).
    const welcome = await supabaseAdmin.rpc('survival_grant_welcome', { p_wallet: caller.wallet, p_n: 3 })
    if (welcome.error) console.warn('[survival/credits] welcome', welcome.error.message)
    const { data, error } = await supabaseAdmin.from('survival_credits').select('mode, source')
        .eq('wallet', caller.wallet).is('consumed_by_run', null).limit(10_000)
    if (error) { console.error('[survival/credits]', error.message); return noServer('credits', error.message) }
    const rows = (data as Array<{ mode: string; source: string }> | null) ?? []
    // `free`: of the solo runs, the welcome gift still unplayed — the game says «FREE RUNS» for them.
    const credits = {
        solo: rows.filter((r) => r.mode === 'solo').length, coop: rows.filter((r) => r.mode === 'coop').length,
        free: rows.filter((r) => r.mode === 'solo' && r.source === 'welcome').length,
    }
    const holder = catalog.some((i) => i.holder_discount_pct > 0) && holderNow
    return NextResponse.json({
        ok: true, credits, booked, paidRuns: process.env.SURVIVAL_PAID_RUNS === '1',
        shop: { configured: !!CASHIER, holder, items: publicCatalog(catalog, holder) },
    }, { headers: { 'cache-control': 'no-store' } })
}
