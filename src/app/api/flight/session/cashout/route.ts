import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * POST /api/flight/session/cashout
 * Body: { session_id, wallet, cashout_at }
 *
 * - Validates session is still running (not crashed yet)
 * - Validates cashout_at <= crash_point
 * - Credits payout, updates game_log, awards XP
 */
export async function POST(req: Request) {
    try {
        const { session_id, wallet, cashout_at } = await req.json()

        if (!session_id || !wallet || cashout_at == null) {
            return NextResponse.json({ error: 'session_id, wallet, cashout_at required' }, { status: 400 })
        }

        // Get session + player's bet
        const { data: session } = await supabaseAdmin
            .from('flight_sessions')
            .select('id, status, crash_point, started_at')
            .eq('id', session_id)
            .single()

        if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        if (session.status === 'crashed') {
            return NextResponse.json({ error: 'Too late — round already crashed' }, { status: 409 })
        }

        // Validate cashout_at is below crash_point
        if (cashout_at > session.crash_point) {
            return NextResponse.json({ error: 'Cashout multiplier exceeds crash point' }, { status: 400 })
        }

        // Get existing bet
        const { data: betLog } = await supabaseAdmin
            .from('flight_game_logs')
            .select('id, bet_amount, cashout_at')
            .eq('session_id', session_id)
            .ilike('wallet_address', wallet)
            .maybeSingle()

        if (!betLog) return NextResponse.json({ error: 'No bet found for this round' }, { status: 404 })
        if (betLog.cashout_at != null) return NextResponse.json({ error: 'Already cashed out' }, { status: 409 })

        const { bet_amount } = betLog
        const profit = parseFloat(((cashout_at - 1) * bet_amount).toFixed(4))
        const payout = parseFloat((cashout_at * bet_amount).toFixed(4))
        const xpGained = Math.round(75 * cashout_at)  // 75 XP × multiplier (e.g. 1.5x → 112 XP)

        // Credit payout
        await supabaseAdmin.rpc('credit_flight_balance', {
            p_wallet: wallet,
            p_amount: payout,
        })

        // Update game log
        await supabaseAdmin
            .from('flight_game_logs')
            .update({ cashout_at, profit, xp_gained: xpGained })
            .eq('id', betLog.id)

        // XP → users
        const { data: currentUser } = await supabaseAdmin
            .from('users')
            .select('xp')
            .ilike('wallet_address', wallet)
            .maybeSingle()

        await supabaseAdmin
            .from('users')
            .update({ xp: (currentUser?.xp ?? 0) + xpGained })
            .ilike('wallet_address', wallet)

        // Season 2
        const { data: s2 } = await supabaseAdmin
            .from('glitch_season_2')
            .select('season_xp, flights_played')
            .eq('wallet_address', wallet.toLowerCase())
            .maybeSingle()

        await supabaseAdmin.from('glitch_season_2').upsert({
            wallet_address: wallet.toLowerCase(),
            season_xp: (s2?.season_xp ?? 0) + xpGained,
            flights_played: (s2?.flights_played ?? 0) + 1,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'wallet_address' })

        // New balance
        const { data: balData } = await supabaseAdmin
            .from('flight_balances')
            .select('balance')
            .ilike('wallet_address', wallet)
            .maybeSingle()

        return NextResponse.json({
            success: true,
            cashout_at,
            profit,
            xp_gained: xpGained,
            new_balance: balData?.balance ?? 0,
        })

    } catch (err: any) {
        console.error('[flight/session/cashout]', err.message)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
