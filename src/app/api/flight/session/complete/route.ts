import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * POST /api/flight/session/complete
 *
 * Body: { session_id, bets: [{ wallet, bet_amount, cashout_at? }] }
 *
 * - Marks session as 'crashed'
 * - For each bet: updates existing game_log row with xp_gained, awards XP, updates season_2
 *   (winners are already handled by /cashout — this only finalises losers)
 */

interface BetEntry {
    wallet: string
    bet_amount: number
    cashout_at?: number | null   // null / undefined = player lost
}

export async function POST(req: Request) {
    try {
        const { session_id, bets }: { session_id: string; bets: BetEntry[] } = await req.json()

        if (!session_id) {
            return NextResponse.json({ error: 'session_id required' }, { status: 400 })
        }

        // Fetch session
        const { data: session, error: sessionErr } = await supabaseAdmin
            .from('flight_sessions')
            .select('id, crash_point, server_seed, status, round_number')
            .eq('id', session_id)
            .single()

        if (sessionErr || !session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        }
        if (session.status === 'crashed') {
            return NextResponse.json({ error: 'Session already completed' }, { status: 409 })
        }

        const crashPoint: number = session.crash_point

        // Mark session as crashed
        await supabaseAdmin
            .from('flight_sessions')
            .update({ status: 'crashed', crashed_at: new Date().toISOString() })
            .eq('id', session_id)

        // Process each bet (losers only in practice — winners were already handled by /cashout)
        if (Array.isArray(bets) && bets.length > 0) {
            for (const bet of bets) {
                const { wallet, bet_amount, cashout_at } = bet

                const won = cashout_at != null && cashout_at <= crashPoint
                const profit = won ? parseFloat(((cashout_at! - 1) * bet_amount).toFixed(4)) : null
                const payout = won ? parseFloat((cashout_at! * bet_amount).toFixed(4)) : 0
                // 75 XP for any play; if won, multiply by cashout multiplier
                const xpGained = won ? Math.round(75 * cashout_at!) : 75

                // Credit winnings if winner
                if (payout > 0) {
                    await supabaseAdmin.rpc('credit_flight_balance', {
                        p_wallet: wallet,
                        p_amount: payout,
                    })
                }

                // UPDATE existing game_log row (inserted by place-bet) — or INSERT if none exists
                const { data: existingLog } = await supabaseAdmin
                    .from('flight_game_logs')
                    .select('id')
                    .eq('session_id', session_id)
                    .ilike('wallet_address', wallet)
                    .maybeSingle()

                if (existingLog) {
                    await supabaseAdmin
                        .from('flight_game_logs')
                        .update({
                            cashout_at: won ? cashout_at : null,
                            profit,
                            xp_gained: xpGained,
                        })
                        .eq('id', existingLog.id)
                } else {
                    await supabaseAdmin.from('flight_game_logs').insert({
                        session_id,
                        wallet_address: wallet.toLowerCase(),
                        bet_amount,
                        cashout_at: won ? cashout_at : null,
                        profit,
                        xp_gained: xpGained,
                    })
                }

                // XP → users table
                const { data: currentUser } = await supabaseAdmin
                    .from('users')
                    .select('xp')
                    .ilike('wallet_address', wallet)
                    .maybeSingle()

                await supabaseAdmin
                    .from('users')
                    .update({ xp: (currentUser?.xp ?? 0) + xpGained })
                    .ilike('wallet_address', wallet)

                // Season 2 leaderboard
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
            }
        }

        return NextResponse.json({
            success: true,
            crash_point: crashPoint,
            round_number: session.round_number,
        })

    } catch (err: any) {
        console.error('[flight/session/complete]', err.message)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
