import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * POST /api/flight/session/place-bet
 * Body: { session_id, wallet, bet_amount }
 *
 * - Validates session is in 'waiting' or 'running' phase
 * - Atomically deducts in-game balance via stored proc
 * - Inserts a pending game_log row (cashout_at = null = pending)
 * - Returns new balance
 */
export async function POST(req: Request) {
    try {
        const { session_id, wallet, bet_amount } = await req.json()

        if (!session_id || !wallet || !bet_amount) {
            return NextResponse.json({ error: 'session_id, wallet, bet_amount required' }, { status: 400 })
        }
        if (bet_amount <= 0) {
            return NextResponse.json({ error: 'bet_amount must be positive' }, { status: 400 })
        }

        // Verify session is still accepting bets
        const { data: session } = await supabaseAdmin
            .from('flight_sessions')
            .select('id, status, crash_point')
            .eq('id', session_id)
            .single()

        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        }
        if (session.status === 'crashed') {
            return NextResponse.json({ error: 'Round already ended' }, { status: 409 })
        }

        // Check player hasn't already bet in this session
        const { data: existingBet } = await supabaseAdmin
            .from('flight_game_logs')
            .select('id')
            .eq('session_id', session_id)
            .ilike('wallet_address', wallet)
            .maybeSingle()

        if (existingBet) {
            return NextResponse.json({ error: 'Already placed a bet for this round' }, { status: 409 })
        }

        // Deduct in-game balance atomically
        const { data: deductResult } = await supabaseAdmin.rpc('deduct_flight_balance', {
            p_wallet: wallet,
            p_amount: bet_amount,
        })

        if (!deductResult?.success) {
            return NextResponse.json({ error: deductResult?.error ?? 'Insufficient balance' }, { status: 400 })
        }

        // Record pending bet (cashout_at = null until round ends)
        await supabaseAdmin.from('flight_game_logs').insert({
            session_id,
            wallet_address: wallet.toLowerCase(),
            bet_amount,
            cashout_at: null,
            profit: null,
            xp_gained: 0,  // updated at round completion
        })

        return NextResponse.json({
            success: true,
            new_balance: deductResult.new_balance,
        })

    } catch (err: any) {
        console.error('[flight/session/place-bet]', err.message)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
