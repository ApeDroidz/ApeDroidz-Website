import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const MAX_LIMIT = 50

/**
 * GET /api/flight/transactions?wallet=0x...&limit=20&offset=0
 * Returns a player's deposit/withdrawal history from flight_transactions.
 */
export async function GET(req: NextRequest) {
    const wallet = req.nextUrl.searchParams.get('wallet')
    const limit  = Math.min(Math.max(1, parseInt(req.nextUrl.searchParams.get('limit')  ?? '20')), MAX_LIMIT)
    const offset = Math.max(0, parseInt(req.nextUrl.searchParams.get('offset') ?? '0'))

    if (!wallet) return NextResponse.json({ error: 'wallet required' }, { status: 400 })
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
        return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
    }

    const { data, error, count } = await supabaseAdmin
        .from('flight_transactions')
        .select('id, type, amount, status, tx_hash, created_at', { count: 'exact' })
        .ilike('wallet_address', wallet)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

    if (error) return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })

    return NextResponse.json({ transactions: data ?? [], total: count ?? 0 })
}
