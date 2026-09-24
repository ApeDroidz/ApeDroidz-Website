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

    // Counted in the database (survival_pool_stats): one row out, however long the season.
    const { data: st, error: sErr } = await supabaseAdmin.rpc('survival_pool_stats', { p_season: season.id })
    if (sErr) { console.warn('[survival/pool]', sErr.message); return new NextResponse(null, { status: 204 }) }
    const r = ((st as Array<Record<string, number | string>> | null) ?? [])[0] ?? {}
    const solo = Number(r.solo_ape ?? 0), coop = Number(r.coop_ape ?? 0)
    const players = Number(r.players ?? 0), games = Number(r.games ?? 0)
    return NextResponse.json({
        seasonId: season.id,
        seasonName: season.name,
        endsAt: season.ends_at ? new Date(season.ends_at).getTime() : null,
        paysOut: season.pays_out === true,
        poolApe: round(solo + coop), soloApe: round(solo), coopApe: round(coop),
        players, games, soloGames: Number(r.solo_games ?? 0), coopGames: Number(r.coop_games ?? 0),
        // legacy fields the Season screen reads
        totalRuns: games, totalPlayers: players,
    }, {
        // Shared cache: every menu asks, nobody needs it to the second. At the edge for 30 s, so
        // however many players sit on the menu, the function runs about twice a minute.
        headers: { 'cache-control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=60' },
    })
}
