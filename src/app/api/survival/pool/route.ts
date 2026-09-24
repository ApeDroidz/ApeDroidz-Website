import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/survival/pool — the live season's prize pools, for the game's main menu and Season
 * screen. Public and read-only: the numbers the pool panel advertises, nothing behind them.
 *
 *   { seasonId, seasonName, endsAt, paysOut, poolApe, soloApe, coopApe, players, games, soloGames, coopGames }
 *
 * Every figure is summed from the append-only ledger and the runs table at read time — the pool is
 * never a stored number anyone can edit. Each mode has its own pool (owner, 24.09.2026: «чтобы для
 * каждого режима формировался свой пул»): the cashier pays half of every purchase into that mode's
 * vault and the ledger books it as solo_pool / coop_pool. The pre-split bucket (season_pool) counts
 * as solo. `games` = runs played to the end this season; `players` = wallets that played one.
 *
 * 204 when no season is live — the game then shows no number rather than an invented one.
 */
export const dynamic = 'force-dynamic'

const round = (n: number) => Math.round(n * 1e6) / 1e6

export async function GET() {
    if (!supabaseAdmin) return new NextResponse(null, { status: 204 })
    const { data: season, error } = await supabaseAdmin.from('survival_seasons')
        .select('id, name, ends_at, pays_out').eq('status', 'live').limit(1).maybeSingle()
    if (error || !season) return new NextResponse(null, { status: 204 })

    const [ledger, runs] = await Promise.all([
        supabaseAdmin.from('survival_pool_ledger').select('bucket, amount_ape').eq('season_id', season.id).limit(200_000),
        supabaseAdmin.from('survival_runs').select('wallet, mode, status').eq('season_id', season.id).in('status', ['finished', 'rejected']).limit(500_000),
    ])
    let solo = 0, coop = 0
    for (const l of (ledger.data as Array<{ bucket: string; amount_ape: number }> | null) ?? []) {
        if (l.bucket === 'coop_pool') coop += Number(l.amount_ape)
        else if (l.bucket === 'solo_pool' || l.bucket === 'season_pool') solo += Number(l.amount_ape)
    }
    const R = ((runs.data as Array<{ wallet: string; mode: string; status: string }> | null) ?? []).filter((r) => r.status === 'finished')
    return NextResponse.json({
        seasonId: season.id,
        seasonName: season.name,
        endsAt: season.ends_at ? new Date(season.ends_at).getTime() : null,
        paysOut: season.pays_out === true,
        poolApe: round(solo + coop), soloApe: round(solo), coopApe: round(coop),
        players: new Set(R.map((r) => r.wallet)).size,
        games: R.length,
        soloGames: R.filter((r) => r.mode !== 'coop').length,
        coopGames: R.filter((r) => r.mode === 'coop').length,
        // legacy fields the Season screen reads
        totalRuns: R.length, totalPlayers: new Set(R.map((r) => r.wallet)).size,
    }, {
        // Short shared cache: every player on the menu asks, nobody needs it to the second.
        headers: { 'cache-control': 'public, max-age=5, s-maxage=5, stale-while-revalidate=30' },
    })
}
