import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, isMaintenanceModeEnabled } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/stats/overview
 *
 * High-level health snapshot for the panel home tab. Cheap aggregates only —
 * heavy per-game queries live in their own endpoints (cards/flight/season).
 */
export async function GET(req: Request) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const now = Date.now()
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString()
    const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()

    try {
        const [
            cardsToday, cards7d,
            flightToday, flight7d,
            ticketsToday, ticketsApeToday,
            depositsToday, depositsApe7d,
            withdrawalsToday, withdrawals7d,
            pendingInvest,
            errorsToday,
            usersTotal, glitchUsersTotal,
            s2Top1,
        ] = await Promise.all([
            // Cards plays
            supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                .eq('status', 'success').gte('created_at', since24h),
            supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                .eq('status', 'success').gte('created_at', since7d),

            // Flight bets
            supabaseAdmin.from('flight_game_logs').select('id', { count: 'exact', head: true })
                .gte('created_at', since24h),
            supabaseAdmin.from('flight_game_logs').select('id', { count: 'exact', head: true })
                .gte('created_at', since7d),

            // Cards revenue
            supabaseAdmin.from('ticket_purchases').select('id', { count: 'exact', head: true })
                .gte('created_at', since24h),
            supabaseAdmin.from('ticket_purchases').select('ape_amount')
                .gte('created_at', since24h),

            // Flight money flow
            supabaseAdmin.from('flight_transactions').select('amount')
                .eq('type', 'deposit').eq('status', 'confirmed').gte('created_at', since24h),
            supabaseAdmin.from('flight_transactions').select('amount')
                .eq('type', 'deposit').eq('status', 'confirmed').gte('created_at', since7d),

            supabaseAdmin.from('flight_transactions').select('amount')
                .eq('type', 'withdrawal').eq('status', 'confirmed').gte('created_at', since24h),
            supabaseAdmin.from('flight_transactions').select('amount')
                .eq('type', 'withdrawal').eq('status', 'confirmed').gte('created_at', since7d),

            // Health
            supabaseAdmin.from('flight_transactions').select('id', { count: 'exact', head: true })
                .eq('status', 'pending_investigation'),
            supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                .eq('status', 'error').gte('created_at', since24h),

            // User totals
            supabaseAdmin.from('users').select('wallet_address', { count: 'exact', head: true }),
            supabaseAdmin.from('glitch_users').select('wallet_address', { count: 'exact', head: true }),

            // Top wallet S2
            supabaseAdmin.from('glitch_season_2').select('wallet_address, season_xp')
                .order('season_xp', { ascending: false }).limit(1).maybeSingle(),
        ])

        const sum = (rows: any) => (rows?.data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0)
        const sumApe = (rows: any) => (rows?.data ?? []).reduce((s: number, r: any) => s + Number(r.ape_amount ?? 0), 0)

        const depositsApeToday = sum(depositsToday)
        const withdrawalsApeToday = sum(withdrawalsToday)
        const flightNetToday = depositsApeToday - withdrawalsApeToday
        const flightNet7d = sum(depositsApe7d) - sum(withdrawals7d)

        return NextResponse.json({
            generatedAt: new Date().toISOString(),
            maintenance: isMaintenanceModeEnabled(),
            cards: {
                playsToday: cardsToday.count ?? 0,
                plays7d: cards7d.count ?? 0,
                ticketsBoughtToday: ticketsToday.count ?? 0,
                revenueApeToday: sumApe(ticketsApeToday),
            },
            flight: {
                betsToday: flightToday.count ?? 0,
                bets7d: flight7d.count ?? 0,
                depositsApeToday,
                withdrawalsApeToday,
                netToday: flightNetToday,
                net7d: flightNet7d,
            },
            users: {
                total: usersTotal.count ?? 0,
                glitchUsers: glitchUsersTotal.count ?? 0,
            },
            health: {
                pendingInvestigation: pendingInvest.count ?? 0,
                errorsToday: errorsToday.count ?? 0,
            },
            season2: {
                topWallet: s2Top1.data?.wallet_address ?? null,
                topXp: s2Top1.data?.season_xp ?? 0,
            },
        }, { headers: { 'cache-control': 'no-store' } })
    } catch (err: any) {
        console.error('[admin/stats/overview]', err.message)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
