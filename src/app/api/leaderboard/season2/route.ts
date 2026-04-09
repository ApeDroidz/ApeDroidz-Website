import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/leaderboard/season2?limit=50&wallet=0x...
 *
 * Returns Season 2 leaderboard (Glitch Game + Glitch Flight combined XP).
 * If wallet param is provided, also returns the player's personal rank.
 */
export async function GET(req: NextRequest) {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50'), 100)
    const wallet = req.nextUrl.searchParams.get('wallet')

    const { data, error } = await supabaseAdmin
        .from('glitch_season_2')
        .select('wallet_address, season_xp, games_played, flights_played, updated_at')
        .order('season_xp', { ascending: false })
        .limit(limit)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const leaderboard = (data ?? []).map((row: { wallet_address: string; season_xp: number; games_played: number; flights_played: number }, i: number) => ({
        rank: i + 1,
        wallet: row.wallet_address,
        season_xp: row.season_xp,
        games_played: row.games_played,
        flights_played: row.flights_played,
    }))

    // Player's own rank (may be outside top 50)
    let playerRank: number | null = null
    let playerXp: number | null = null

    if (wallet) {
        const { data: player } = await supabaseAdmin
            .from('glitch_season_2')
            .select('season_xp')
            .eq('wallet_address', wallet.toLowerCase())
            .maybeSingle()

        if (player) {
            playerXp = player.season_xp
            // Count how many wallets have strictly more XP
            const { count } = await supabaseAdmin
                .from('glitch_season_2')
                .select('*', { count: 'exact', head: true })
                .gt('season_xp', player.season_xp)
            playerRank = (count ?? 0) + 1
        }
    }

    return NextResponse.json({
        leaderboard,
        player: wallet ? { rank: playerRank, season_xp: playerXp } : undefined,
    })
}
