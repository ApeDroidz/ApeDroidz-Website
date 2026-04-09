import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/flight/top-pilots?limit=10
 * Returns top players by their single best win (highest profit in one flight).
 */
export async function GET(req: NextRequest) {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '10'), 50)

    const { data, error } = await supabaseAdmin
        .from('flight_game_logs')
        .select('wallet_address, profit, cashout_at, bet_amount')
        .not('cashout_at', 'is', null)
        .not('profit', 'is', null)
        .gt('profit', 0)
        .order('profit', { ascending: false })
        .limit(limit * 3) // fetch extra to deduplicate per wallet

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Keep only each wallet's best single win
    const seen = new Set<string>()
    const leaderboard = []
    for (const row of data ?? []) {
        const w = row.wallet_address.toLowerCase()
        if (seen.has(w)) continue
        seen.add(w)
        leaderboard.push({
            rank: leaderboard.length + 1,
            wallet: row.wallet_address,
            best_profit: parseFloat(Number(row.profit).toFixed(4)),
            best_multiplier: parseFloat(Number(row.cashout_at).toFixed(2)),
            bet_amount: parseFloat(Number(row.bet_amount).toFixed(4)),
        })
        if (leaderboard.length >= limit) break
    }

    return NextResponse.json({ pilots: leaderboard })
}
