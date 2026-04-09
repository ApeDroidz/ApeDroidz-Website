import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateServerSeed, hashServerSeed, computeCrashPoint } from '@/lib/flightCrypto'

/**
 * POST /api/flight/session/start
 * Body: { wallet? }
 *
 * Each wallet gets their own independent session.
 * - If this wallet already has an active (waiting/running) session → return it
 * - Otherwise create a new session
 *
 * This ensures complete isolation between players.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}))
        const wallet: string | undefined = body?.wallet?.toLowerCase()

        // If wallet provided: look for their existing active session
        if (wallet) {
            const { data: active } = await supabaseAdmin
                .from('flight_sessions')
                .select('id, round_number, server_seed_hash, crash_point, status, started_at, created_at')
                .eq('wallet_address', wallet)
                .in('status', ['waiting', 'running'])
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()

            if (active) {
                // Also fetch existing bet for this wallet in this session (for reload recovery)
                const { data: existingBet } = await supabaseAdmin
                    .from('flight_game_logs')
                    .select('bet_amount, cashout_at')
                    .eq('session_id', active.id)
                    .ilike('wallet_address', wallet)
                    .maybeSingle()

                return NextResponse.json({
                    session_id: active.id,
                    round_number: active.round_number,
                    server_seed_hash: active.server_seed_hash,
                    crash_point: active.crash_point,
                    status: active.status,
                    started_at: active.started_at,
                    created_at: active.created_at,
                    existing_bet: existingBet
                        ? { bet_amount: existingBet.bet_amount, cashout_at: existingBet.cashout_at }
                        : null,
                })
            }
        }

        // Get last round number for this wallet (or global if no wallet)
        const roundQuery = supabaseAdmin
            .from('flight_sessions')
            .select('round_number')
            .order('round_number', { ascending: false })
            .limit(1)
            .maybeSingle()

        const { data: lastSession } = await (wallet
            ? supabaseAdmin.from('flight_sessions').select('round_number').eq('wallet_address', wallet).order('round_number', { ascending: false }).limit(1).maybeSingle()
            : roundQuery
        )

        const roundNumber = (lastSession?.round_number ?? 0) + 1

        // Generate provably fair values
        const serverSeed = generateServerSeed()
        const serverSeedHash = hashServerSeed(serverSeed)
        const crashPoint = computeCrashPoint(serverSeed)

        const insertData: Record<string, unknown> = {
            round_number: roundNumber,
            server_seed: serverSeed,
            server_seed_hash: serverSeedHash,
            crash_point: crashPoint,
            status: 'waiting',
        }
        if (wallet) insertData.wallet_address = wallet

        const { data: session, error } = await supabaseAdmin
            .from('flight_sessions')
            .insert(insertData)
            .select('id, round_number, server_seed_hash, crash_point, status, started_at, created_at')
            .single()

        if (error) throw error

        return NextResponse.json({
            session_id: session.id,
            round_number: session.round_number,
            server_seed_hash: session.server_seed_hash,
            crash_point: session.crash_point,
            status: session.status,
            started_at: session.started_at,
            created_at: session.created_at,
        })

    } catch (err: any) {
        console.error('[flight/session/start]', err.message)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
