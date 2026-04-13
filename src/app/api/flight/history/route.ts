import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const MAX_LIMIT  = 50
const MAX_OFFSET = 5_000   // prevent full table scan via huge offset

/**
 * GET /api/flight/history?wallet=0x...&limit=20&offset=0
 * Returns a player's personal flight history.
 */
export async function GET(req: NextRequest) {
    const wallet = req.nextUrl.searchParams.get('wallet')
    const limit  = Math.min(Math.max(1, parseInt(req.nextUrl.searchParams.get('limit')  ?? '20')), MAX_LIMIT)
    const offset = Math.min(Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') ?? '0')),  MAX_OFFSET)

    if (!wallet) return NextResponse.json({ error: 'wallet required' }, { status: 400 })

    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
        return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
    }

    const { data, error, count } = await supabaseAdmin
        .from('flight_game_logs')
        .select(`
            id,
            bet_amount,
            cashout_at,
            profit,
            xp_gained,
            created_at,
            flight_sessions ( round_number, crash_point, server_seed, server_seed_hash, status )
        `, { count: 'exact' })
        .ilike('wallet_address', wallet)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

    if (error) return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })

    // Strip crash_point and server_seed from sessions not yet crashed (provably fair — reveal post-crash only)
    const flights = (data ?? []).map((row: any) => {
        const session = row.flight_sessions
        const crashed = session?.status === 'crashed'
        return {
            ...row,
            flight_sessions: session ? {
                round_number:    session.round_number,
                server_seed_hash: session.server_seed_hash,
                crash_point:  crashed ? session.crash_point  : null,
                server_seed:  crashed ? session.server_seed  : null,
            } : null,
        }
    })

    return NextResponse.json({ flights, total: count })
}
