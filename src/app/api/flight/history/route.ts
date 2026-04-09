import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/flight/history?wallet=0x...&limit=20&offset=0
 * Returns a player's personal flight history.
 */
export async function GET(req: NextRequest) {
    const wallet = req.nextUrl.searchParams.get('wallet')
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '20'), 50)
    const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0')

    if (!wallet) return NextResponse.json({ error: 'wallet required' }, { status: 400 })

    const { data, error, count } = await supabaseAdmin
        .from('flight_game_logs')
        .select(`
            id,
            bet_amount,
            cashout_at,
            profit,
            xp_gained,
            created_at,
            flight_sessions ( round_number, crash_point, server_seed, server_seed_hash )
        `, { count: 'exact' })
        .ilike('wallet_address', wallet)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ flights: data, total: count })
}
