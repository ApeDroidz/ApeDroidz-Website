import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'
import { RUN_TTL_MS } from '@/lib/survivalEnvelope'


/**
 * POST /api/survival/run/start  { hero, weapon, clientVersion }
 *
 * Opens a run ticket (PRIZE_POOL.md §5, layer 1). The server, not the client, owns the clock:
 * `started_at` is now(), and every later check measures against it. Replies:
 *   { ok: true,  runId, seed, seasonId }
 *   { ok: false, state: 'no_season' | 'banned' | 'rate_limited' | 'no_server' }
 *
 * One active run per wallet: a still-open ticket from an earlier tab is voided (reason
 * `superseded`), not rejected — closing a tab is not cheating. The beta season needs no credit,
 * so credit_id stays null; a paid season will consume one here.
 */
export const dynamic = 'force-dynamic'

const STARTS_PER_HOUR = 40

export async function POST(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const body = await readBody(req)
    const str = (v: unknown, max = 40) => (typeof v === 'string' ? v.slice(0, max) : null)

    // The player row: first seen / last seen, the clan they fly (optional, from the game's
    // own list — anything else is stored as none), and the ban flag.
    let clan: string | null = null
    if (typeof body.clan === 'string' && body.clan) {
        const { data: known } = await supabaseAdmin.from('survival_clans').select('name').eq('active', true).eq('name', body.clan.slice(0, 40)).maybeSingle()
        clan = known ? (known as { name: string }).name : null
    }
    const { data: player, error: pErr } = await supabaseAdmin
        .from('survival_players')
        .upsert({ wallet: caller.wallet, last_seen: new Date().toISOString(), clan }, { onConflict: 'wallet' })
        .select('banned')
        .single()
    if (pErr) { console.error('[survival/run/start] player', pErr.message); return noServer() }
    if (player?.banned) return NextResponse.json({ ok: false, state: 'banned' })

    const { data: season, error: sErr } = await supabaseAdmin
        .from('survival_seasons').select('id').eq('status', 'live').limit(1).maybeSingle()
    if (sErr) { console.error('[survival/run/start] season', sErr.message); return noServer() }
    if (!season) return NextResponse.json({ ok: false, state: 'no_season' })

    // Bot farms: more starts than a human could play.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count, error: cErr } = await supabaseAdmin
        .from('survival_runs').select('id', { count: 'exact', head: true })
        .eq('wallet', caller.wallet).gte('started_at', since)
    if (cErr) { console.error('[survival/run/start] count', cErr.message); return noServer() }
    if ((count ?? 0) >= STARTS_PER_HOUR) return NextResponse.json({ ok: false, state: 'rate_limited' })

    // Void whatever ticket was left open, and anything that simply expired.
    const stale = new Date(Date.now() - RUN_TTL_MS).toISOString()
    await supabaseAdmin.from('survival_runs')
        .update({ status: 'void', reject_reason: 'superseded' })
        .eq('wallet', caller.wallet).eq('status', 'started')
    await supabaseAdmin.from('survival_runs')
        .update({ status: 'void', reject_reason: 'expired' })
        .eq('status', 'started').lt('started_at', stale)

    // The seed: handed out by the server so a future replay can reproduce the run.
    const seed = Number(BigInt.asUintN(52, BigInt('0x' + crypto.randomUUID().replace(/-/g, '').slice(0, 13))))
    const { data: run, error: rErr } = await supabaseAdmin
        .from('survival_runs')
        .insert({
            season_id: season.id, wallet: caller.wallet, status: 'started',
            hero: str(body.hero), weapon: str(body.weapon), client_version: str(body.clientVersion, 64),
            rng_seed: seed,
        })
        .select('id')
        .single()
    if (rErr || !run) { console.error('[survival/run/start] insert', rErr?.message); return noServer() }

    return NextResponse.json(
        { ok: true, runId: run.id, seed, seasonId: season.id },
        { headers: { 'cache-control': 'no-store' } },
    )
}
