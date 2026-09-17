import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/survival/pool
 *
 * The season's prize pool, for the game's Season screen. Public and read-only: these
 * are the numbers the pool block advertises, and everything behind them
 * (survival_pool_ledger, survival_payments) stays closed.
 *
 * Reads `survival_menu_stats`, which sums the append-only ledger — the pool is never
 * stored as a number anyone can edit, so this endpoint cannot report a figure that the
 * journal does not back (docs/PRIZE_POOL.md §6).
 *
 * Returns 204 when no season is live, or when the schema is not applied yet. That is
 * the honest answer and the game already handles it: no server, no number, and the
 * Season screen shows the rules with a zero instead of inventing a pool.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
    if (!supabaseAdmin) {
        console.error('[survival/pool] service role key missing')
        return new NextResponse(null, { status: 204 })
    }

    const { data, error } = await supabaseAdmin
        .from('survival_menu_stats')
        .select('season_id, ends_at, pool_ape, mega_pool_ape, total_runs, total_players, pays_out')
        .limit(1)
        .maybeSingle()

    // A missing table is not an error worth 500-ing over — it is "the season backend is
    // not up yet", which is a state the game is built to render.
    if (error) {
        console.warn('[survival/pool]', error.message)
        return new NextResponse(null, { status: 204 })
    }
    if (!data) return new NextResponse(null, { status: 204 })

    return NextResponse.json(
        {
            seasonId: data.season_id,
            endsAt: data.ends_at ? new Date(data.ends_at).getTime() : null,
            poolApe: Number(data.pool_ape ?? 0),
            megaPoolApe: Number(data.mega_pool_ape ?? 0),
            totalRuns: Number(data.total_runs ?? 0),
            totalPlayers: Number(data.total_players ?? 0),
            paysOut: data.pays_out === true,
        },
        {
            headers: {
                // Short shared cache: the pool ticks up continuously and every player on
                // the menu asks for it, but nobody needs it to the second.
                'cache-control': 'public, max-age=5, s-maxage=5, stale-while-revalidate=30',
            },
        },
    )
}
