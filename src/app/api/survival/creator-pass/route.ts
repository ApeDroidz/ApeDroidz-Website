import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer } from '@/lib/survivalRuns'
import { isCreatorWallet } from '@/lib/survivalAccess'
import { loadEcon } from '@/lib/survivalEconomyStore'
import { logEvent } from '@/lib/survivalLog'

/**
 * POST /api/survival/creator-pass  — the CREATOR's free TEST season pass (owner, 02.10.2026: «бесплатно
 * открыть и посмотреть сезонный пропуск и лестницу сезона, а для остальных всё закрыто»).
 *   → { ok: true, state: 'granted' | 'owned', season: { seasonId, season, daily, passOwned, passTest } }
 *   → { ok: false, state: 'unauthenticated' | 'no_access' (401) | 'not_creator' (403) | 'no_season' }
 *
 * Only for the creator (lib/survivalAccess.ts isCreatorWallet — SURVIVAL_TEST_WALLETS or a preview
 * wallet), behind the signed session like every other survival route (authCaller). Costs nothing,
 * moves no money: no payment, no pool ledger row, no credits.
 *
 * The pass is a TEST pass by its sku, `test_creator_pass` — the same mark the 0.01 APE test pass
 * carries (test_* skus, migration 20260929_survival_test_skus), so every place that keeps test passes
 * out keeps this one out too:
 *   - survival_season_standings (`sku not like 'test\_%'`) → not a pass holder who shares the pool,
 *     and therefore not in the pool forecast (lib/survivalForecast.ts reads the standings);
 *   - /api/survival/board → no yellow PASS mark, not on the PASS board, not in passCount;
 *   - /api/survival/order → it never stands in the way of buying the real pass later.
 * And the economy (lib/survivalEconomyStore.ts loadEcon) does count it as held, so the PASS rewards
 * of the ladder open — which is the point. `grant_spec.source = 'creator'` says where it came from.
 *
 * An entitlement must name an order (survival_entitlements.order_id is not null), so the grant makes
 * one: status 'paid' with no transaction and no payment row, the minimum price the table allows
 * (0.01), and closed (dismissed_at). It has no survival_payments row, so no revenue total, pool or
 * chart sees it; the panel's order counts leave test_* orders out too.
 */
export const dynamic = 'force-dynamic'
const noStore = { 'cache-control': 'no-store' }
const CREATOR_PASS_SKU = 'test_creator_pass'

export async function POST(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!isCreatorWallet(caller.wallet)) return NextResponse.json({ ok: false, state: 'not_creator' }, { status: 403, headers: noStore })
    if (!supabaseAdmin) return noServer()

    const { data: season } = await supabaseAdmin.from('survival_seasons').select('id').eq('status', 'live').limit(1).maybeSingle()
    const seasonId = (season as { id: string } | null)?.id
    if (!seasonId) return NextResponse.json({ ok: false, state: 'no_season' }, { headers: noStore })

    const reply = async (state: 'granted' | 'owned') => {
        const loaded = await loadEcon(caller.wallet, seasonId)
        if (!loaded) return noServer()
        return NextResponse.json({
            ok: true, state,
            season: { seasonId, season: loaded.econ.season, daily: loaded.econ.daily, passOwned: loaded.passOwned, passTest: loaded.passTest },
        }, { headers: noStore })
    }

    // Any pass for this season already (the real one, the 0.01 test one, or this one): nothing to give.
    const { data: held, error: heldErr } = await supabaseAdmin.from('survival_entitlements').select('id')
        .eq('wallet', caller.wallet).eq('kind', 'season_pass').or(`season_id.eq.${seasonId},season_id.is.null`).limit(1)
    if (heldErr) return noServer('creator_pass.read', heldErr.message)
    if (held?.length) return reply('owned')

    const now = new Date().toISOString()
    // The player row must exist (FK on orders and entitlements).
    await supabaseAdmin.from('survival_players').upsert({ wallet: caller.wallet, last_seen: now }, { onConflict: 'wallet' })
    const grant = { source: 'creator' }
    const { data: order, error: orderErr } = await supabaseAdmin.from('survival_orders').insert({
        wallet: caller.wallet, season_id: seasonId, sku: CREATOR_PASS_SKU, kind: 'season_pass', credits: 0,
        price_ape: 0.01, min_wei: '1', paid_wei: '0', grant_spec: grant, platform: 'site', mode: 'solo',
        status: 'paid', paid_at: now, dismissed_at: now,
    }).select('id').single()
    if (orderErr || !order) return noServer('creator_pass.order', orderErr?.message)
    const { error: entErr } = await supabaseAdmin.from('survival_entitlements').insert({
        wallet: caller.wallet, order_id: (order as { id: string }).id, sku: CREATOR_PASS_SKU, kind: 'season_pass',
        grant_spec: grant, season_id: seasonId, claimed_at: now,
    })
    if (entErr) {
        await supabaseAdmin.from('survival_orders').delete().eq('id', (order as { id: string }).id)
        return noServer('creator_pass.grant', entErr.message)
    }
    logEvent({ level: 'info', kind: 'pass.creator', wallet: caller.wallet, message: `test pass for ${seasonId} (not in the pool)` })
    return reply('granted')
}
