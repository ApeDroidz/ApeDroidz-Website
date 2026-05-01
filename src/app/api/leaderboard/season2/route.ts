import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 30

// Season 2 officially starts when Glitch Flight landed (commit 1599687,
// 2026-04-09). Anything claimed before this date is pre-S2 test data and
// must NOT be counted toward the S2 leaderboard's quest tally.
const S2_START_ISO = '2026-04-09T00:00:00.000Z'
const S2_START_DATE = '2026-04-09'   // for date columns (no time component)

/**
 * GET /api/leaderboard/season2?limit=50&wallet=0x...
 *
 * Returns Season 2 leaderboard (Glitch Game + Glitch Flight combined XP).
 * Includes username (from users) and x_handle (from glitch_users).
 * If wallet param is provided, also returns the player's personal rank.
 */
export async function GET(req: NextRequest) {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50'), 100)
    const wallet = req.nextUrl.searchParams.get('wallet')

    // 1. Fetch top season 2 rows
    const { data: seasonData, error } = await supabaseAdmin
        .from('glitch_season_2')
        .select('wallet_address, season_xp, games_played, flights_played, updated_at')
        .order('season_xp', { ascending: false })
        .limit(limit)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = seasonData ?? []

    // 2. Bulk-fetch usernames, x_handles, and quest counts
    let usernames: Record<string, string | null> = {}
    let xHandles: Record<string, string | null> = {}
    let questCounts: Record<string, number> = {}

    if (rows.length > 0) {
        const wallets = rows.map((r: any) => r.wallet_address)
        const orFilter = wallets.map((w: string) => `wallet_address.ilike.${w}`).join(',')

        // Quest tally = activity-quest claims + X-task daily claims + streak
        // milestone claims. Tables are mostly S2-isolated — exceptions get
        // a date filter:
        //   • daily_activity_claims   — date filter on claim_date (legacy
        //     table, but pre-S2 rows in this one are negligible)
        //   • daily_claims_log_s2     — S2-only by construction, no filter
        //   • weekly_streak_claims    — date filter on week_monday
        const [usersRes, glitchRes, activityRes, dailyRes, streakRes] = await Promise.all([
            supabaseAdmin.from('users').select('wallet_address, username').or(orFilter),
            supabaseAdmin.from('glitch_users').select('wallet_address, x_handle').or(orFilter),
            supabaseAdmin.from('daily_activity_claims').select('wallet_address').or(orFilter)
                .gte('claim_date', S2_START_DATE),
            supabaseAdmin.from('daily_claims_log_s2').select('wallet_address').or(orFilter),
            supabaseAdmin.from('weekly_streak_claims').select('wallet_address').or(orFilter)
                .gte('week_monday', S2_START_DATE),
        ])

        for (const u of usersRes.data ?? []) {
            usernames[u.wallet_address.toLowerCase()] = u.username || null
        }
        for (const g of glitchRes.data ?? []) {
            xHandles[g.wallet_address.toLowerCase()] = g.x_handle || null
        }
        for (const r of [
            ...(activityRes.data ?? []),
            ...(dailyRes.data ?? []),
            ...(streakRes.data ?? []),
        ]) {
            const k = r.wallet_address.toLowerCase()
            questCounts[k] = (questCounts[k] ?? 0) + 1
        }
    }

    // 3. Build leaderboard
    const leaderboard = rows.map((row: any, i: number) => ({
        rank: i + 1,
        wallet: row.wallet_address,
        season_xp: row.season_xp,
        games_played: row.games_played,
        flights_played: row.flights_played,
        quests_finished: questCounts[row.wallet_address.toLowerCase()] ?? 0,
        username: usernames[row.wallet_address.toLowerCase()] ?? null,
        x_handle: xHandles[row.wallet_address.toLowerCase()] ?? null,
    }))

    // 4. Player's own rank (may be outside top 50)
    let playerRank: number | null = null
    let playerXp: number | null = null

    if (wallet) {
        const { data: player } = await supabaseAdmin
            .from('glitch_season_2')
            .select('season_xp')
            .ilike('wallet_address', wallet)
            .maybeSingle()

        if (player) {
            playerXp = player.season_xp
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
