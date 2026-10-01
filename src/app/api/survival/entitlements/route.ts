import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'
import { settlePending, within } from '@/lib/survivalSettle'
import { applyEntitlement, type Econ } from '@/lib/survivalEconomy'
import { withEcon } from '@/lib/survivalEconomyStore'

/**
 * What the player bought that is not runs — a season pass, an item, a box, a bundle.
 *
 *   GET  /api/survival/entitlements            → { ok, items: [{ id, sku, kind, grant, seed, seasonId, createdAt }] }  (unclaimed)
 *   POST /api/survival/entitlements { ids }    → { ok, claimed }
 *
 * The server issues (survival_settle_order) AND applies (26.09.2026 — the economy is the server's,
 * lib/survivalEconomy.ts applyEntitlement): a claim puts the purchase into the player's economy and
 * marks it claimed, in that order; the save remembers the ids it has applied, so a lost claim can
 * never apply twice. A box carries the server's seed: its contents are derived from it, so
 * reopening can never reroll what was bought. A full bag leaves the item unclaimed, for later.
 */
export const dynamic = 'force-dynamic'
const noStore = { 'cache-control': 'no-store' }

export async function GET(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    // Bounded like /credits: what does not finish in time is booked by the next read.
    await within(settlePending(caller.wallet).catch(() => 0), 2500, 0)
    const { data, error } = await supabaseAdmin.from('survival_entitlements').select('id, sku, kind, grant_spec, seed, season_id, created_at')
        .eq('wallet', caller.wallet).is('claimed_at', null).order('created_at').limit(50)
    if (error) { console.error('[survival/entitlements]', error.message); return noServer('entitlements', error.message) }
    const items = ((data as Array<{ id: string; sku: string; kind: string; grant_spec: unknown; seed: number; season_id: string | null; created_at: string }> | null) ?? [])
        .map((e) => ({ id: e.id, sku: e.sku, kind: e.kind, grant: e.grant_spec, seed: Number(e.seed), seasonId: e.season_id, createdAt: e.created_at }))
    return NextResponse.json({ ok: true, items }, { headers: noStore })
}

export async function POST(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const body = await readBody(req)
    const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50) : []
    if (ids.length === 0) return NextResponse.json({ ok: false, state: 'malformed' }, { headers: noStore })
    // The player's own, unclaimed ones only.
    const { data: rows, error: rowsErr } = await supabaseAdmin.from('survival_entitlements').select('id, kind, grant_spec, seed')
        .eq('wallet', caller.wallet).is('claimed_at', null).in('id', ids)
    if (rowsErr) { console.error('[survival/entitlements] read', rowsErr.message); return noServer('entitlements.read', rowsErr.message) }
    const ents = ((rows as Array<{ id: string; kind: string; grant_spec: Record<string, unknown>; seed: number }> | null) ?? [])
        .map((r) => ({ id: r.id, kind: r.kind, grant: r.grant_spec ?? {}, seed: Number(r.seed) }))
    const results: Array<{ id: string; state: string; gave: Record<string, unknown> }> = []
    const r = await withEcon(caller.wallet, undefined, (loaded) => {
        let econ: Econ = loaded.econ
        results.length = 0
        for (const ent of ents) {
            const a = applyEntitlement(econ, ent, { now: Date.now() })
            econ = a.econ
            results.push({ id: ent.id, state: a.state, gave: a.gave })
        }
        return results.some((x) => x.state === 'applied') ? { next: econ, out: results } : null
    })
    if (!r.ok) return noServer('entitlements.claim', r.error)
    const done = results.filter((x) => x.state !== 'bag_full').map((x) => x.id)
    const { data, error } = done.length ? await supabaseAdmin.rpc('survival_claim_entitlements', { p_wallet: caller.wallet, p_ids: done }) : { data: 0, error: null }
    if (error) { console.error('[survival/entitlements] claim', error.message); return noServer('entitlements.claim', error.message) }
    return NextResponse.json({ ok: true, claimed: data, results, state: r.econ.state, season: r.econ.season, daily: r.econ.daily }, { headers: noStore })
}
