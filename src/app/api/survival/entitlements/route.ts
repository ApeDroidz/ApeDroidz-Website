import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'
import { settlePending } from '@/lib/survivalSettle'

/**
 * What the player bought that is not runs — a season pass, an item, a box, a bundle.
 *
 *   GET  /api/survival/entitlements            → { ok, items: [{ id, sku, kind, grant, seed, seasonId, createdAt }] }  (unclaimed)
 *   POST /api/survival/entitlements { ids }    → { ok, claimed }
 *
 * The server issues (survival_settle_order), the GAME applies: the save — Ape Mini, the bag, the
 * pass flag — belongs to the client and the server never writes into it (a server write would be
 * overwritten by the next push; see memory «Ape Mini принадлежат клиенту»). The game remembers the
 * ids it has applied inside the save, so applying twice is impossible even if the claim below is
 * lost; the claim only stops the server offering the item again. A box carries the server's seed:
 * its contents are derived from it, so reopening can never reroll what was bought.
 */
export const dynamic = 'force-dynamic'
const noStore = { 'cache-control': 'no-store' }

export async function GET(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    await settlePending(caller.wallet).catch(() => 0)
    const { data, error } = await supabaseAdmin.from('survival_entitlements').select('id, sku, kind, grant_spec, seed, season_id, created_at')
        .eq('wallet', caller.wallet).is('claimed_at', null).order('created_at').limit(50)
    if (error) { console.error('[survival/entitlements]', error.message); return noServer() }
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
    const { data, error } = await supabaseAdmin.rpc('survival_claim_entitlements', { p_wallet: caller.wallet, p_ids: ids })
    if (error) { console.error('[survival/entitlements] claim', error.message); return noServer() }
    return NextResponse.json({ ok: true, claimed: data }, { headers: noStore })
}
