import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/flight/balance?wallet=0x...
 * Returns the player's in-game flight balance.
 */
export async function GET(req: NextRequest) {
    const wallet = req.nextUrl.searchParams.get('wallet')
    if (!wallet) return NextResponse.json({ error: 'wallet required' }, { status: 400 })

    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
        return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
        .from('flight_balances')
        .select('balance')
        .ilike('wallet_address', wallet)
        .maybeSingle()

    if (error) {
        return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 500 })
    }

    return NextResponse.json({ balance: data?.balance ?? 0 })
}
