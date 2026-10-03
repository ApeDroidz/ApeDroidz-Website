import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { readSessionFromRequest } from '@/lib/walletAuth'
import { readBody } from '@/lib/survivalRuns'
import { ANON_ID, CLIENT_STEPS, funnelEnabled, recordClientStep, type ClientStep } from '@/lib/survivalFunnelServer'

/**
 * POST /api/survival/funnel { step, anonId } — one step of the landing funnel (owner, 03.10.2026),
 * sent by the site's pages (lib/survivalFunnel.ts trackFunnel):
 *   landing_view · play_click · wallet_connected · signed_in
 * anonId — the browser's random id (localStorage `ds_anon_id`, 8–64 of [a-z0-9-]). The wallet is
 * taken from the signed session when there is one, never from the body. first_run and
 * first_purchase are not taken here: the server writes them itself (run/finish, the payment booking).
 *
 * Written once per (step, anonId) as survival_events `funnel.<step>` (lib/survivalFunnelServer.ts).
 * Always 200 { ok: true } — a beacon has nobody to show an error to; `dup` / `skipped` say why
 * nothing was written. Bounded: the middleware's per-IP limit, and a per-IP-hash ceiling per hour
 * counted in the table across all instances.
 */
export const dynamic = 'force-dynamic'

const PER_IP_HOUR = 60
const OK = (extra: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...extra }, { headers: { 'cache-control': 'no-store' } })

export async function POST(req: NextRequest) {
    const body = await readBody(req)
    const step = typeof body.step === 'string' && (CLIENT_STEPS as readonly string[]).includes(body.step) ? body.step as ClientStep : null
    const anon = typeof body.anonId === 'string' && ANON_ID.test(body.anonId) ? body.anonId.toLowerCase() : null
    if (!step || !anon || !supabaseAdmin) return OK({ skipped: true })
    if (!funnelEnabled()) return OK({ skipped: 'dev' })

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
    const ipHash = ip ? createHash('sha256').update(ip).digest('hex').slice(0, 16) : null
    if (ipHash) {
        const since = new Date(Date.now() - 3_600_000).toISOString()
        const { count } = await supabaseAdmin.from('survival_events').select('id', { count: 'exact', head: true })
            .in('kind', CLIENT_STEPS.map((s) => `funnel.${s}`)).eq('ip_hash', ipHash).gte('at', since)
        if ((count ?? 0) >= PER_IP_HOUR) return OK({ skipped: true })
    }
    const session = readSessionFromRequest(req)
    const r = await recordClientStep(step, anon, session?.wallet ?? null, ipHash)
    return OK(r === 'dup' ? { dup: true } : r === 'ok' ? {} : { skipped: true })
}
