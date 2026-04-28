import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, isMaintenanceModeEnabled } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/stats/overview
 *
 * High-level dashboard:
 *   - 24h vs 7d activity
 *   - Lifetime totals (via admin_lifetime_totals RPC)
 *   - Vault liability (via admin_flight_liability RPC)
 *   - 30-day DAU + revenue trend (via admin_dau_trend RPC)
 *   - 30-day signups trend (via admin_signups_trend RPC)
 *
 * Heavy aggregations are pushed to SQL — JS only stitches the results.
 */
export async function GET(req: Request) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const now = Date.now()
    const since24h = new Date(now - 86400_000).toISOString()
    const since7d = new Date(now - 7 * 86400_000).toISOString()

    try {
        const [
            cardsToday, cards7d,
            flightToday, flight7d,
            ticketsToday, ticketsApeToday,
            depositsToday, withdrawalsToday,
            pendingInvest, errorsToday,
            usersTotal, glitchUsersTotal,
            s2Top1,
            lifetime, liability,
            dauTrend, signupsTrend,
        ] = await Promise.all([
            supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                .eq('status', 'success').gte('created_at', since24h),
            supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                .eq('status', 'success').gte('created_at', since7d),
            supabaseAdmin.from('flight_game_logs').select('id', { count: 'exact', head: true })
                .gte('created_at', since24h),
            supabaseAdmin.from('flight_game_logs').select('id', { count: 'exact', head: true })
                .gte('created_at', since7d),
            supabaseAdmin.from('ticket_purchases').select('id', { count: 'exact', head: true })
                .gte('created_at', since24h),
            supabaseAdmin.from('ticket_purchases').select('ape_amount').gte('created_at', since24h),
            supabaseAdmin.from('flight_transactions').select('amount')
                .eq('type', 'deposit').eq('status', 'confirmed').gte('created_at', since24h),
            supabaseAdmin.from('flight_transactions').select('amount')
                .eq('type', 'withdrawal').eq('status', 'confirmed').gte('created_at', since24h),
            supabaseAdmin.from('flight_transactions').select('id', { count: 'exact', head: true })
                .eq('status', 'pending_investigation'),
            supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                .eq('status', 'error').gte('created_at', since24h),
            supabaseAdmin.from('users').select('wallet_address', { count: 'exact', head: true }),
            supabaseAdmin.from('glitch_users').select('wallet_address', { count: 'exact', head: true }),
            supabaseAdmin.from('glitch_season_2').select('wallet_address, season_xp')
                .order('season_xp', { ascending: false }).limit(1).maybeSingle(),

            // Heavy aggregates via SQL RPCs
            supabaseAdmin.rpc('admin_lifetime_totals'),
            supabaseAdmin.rpc('admin_flight_liability'),
            supabaseAdmin.rpc('admin_dau_trend', { p_days: 30 }),
            supabaseAdmin.rpc('admin_signups_trend', { p_days: 30 }),
        ])

        const sumApe = (rows: any) => (rows?.data ?? []).reduce((s: number, r: any) => s + Number(r.ape_amount ?? 0), 0)
        const sum = (rows: any) => (rows?.data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0)

        const depositsApeToday = sum(depositsToday)
        const withdrawalsApeToday = sum(withdrawalsToday)

        // RPC results: rpc returns array (TABLE) — pick first row for single-row functions
        const lifetimeRow = Array.isArray(lifetime.data) ? lifetime.data[0] : lifetime.data
        const liabilityRow = Array.isArray(liability.data) ? liability.data[0] : liability.data

        // Compute platform PnL (Cards APE in − Flight payouts net − any token prizes paid)
        const flightHouseEdge = lifetimeRow ? Number(lifetimeRow.total_flight_volume) - Number(lifetimeRow.total_flight_payout) : 0
        const cardsRevenue = lifetimeRow ? Number(lifetimeRow.total_card_revenue) : 0
        const flightNet = lifetimeRow
            ? Number(lifetimeRow.total_flight_deposits) - Number(lifetimeRow.total_flight_withdrawals)
            : 0
        const liabilityTotal = liabilityRow ? Number(liabilityRow.total_balance) : 0

        // Detect missing analytics RPCs (PGRST202 = function not found in PostgREST schema cache)
        const missingRpcs: string[] = []
        if (lifetime.error?.code === 'PGRST202' || lifetime.error?.message?.includes('does not exist')) missingRpcs.push('admin_lifetime_totals')
        if (liability.error?.code === 'PGRST202' || liability.error?.message?.includes('does not exist')) missingRpcs.push('admin_flight_liability')
        if (dauTrend.error?.code === 'PGRST202' || dauTrend.error?.message?.includes('does not exist')) missingRpcs.push('admin_dau_trend')
        if (signupsTrend.error?.code === 'PGRST202' || signupsTrend.error?.message?.includes('does not exist')) missingRpcs.push('admin_signups_trend')

        return NextResponse.json({
            generatedAt: new Date().toISOString(),
            maintenance: isMaintenanceModeEnabled(),
            migrationNeeded: missingRpcs.length > 0 ? missingRpcs : null,

            // ── Last 24h / 7d snapshot ────────────────────────────────────
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
                netToday: depositsApeToday - withdrawalsApeToday,
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

            // ── Lifetime ────────────────────────────────────────────────────
            lifetime: lifetimeRow ?? null,

            // ── Vault liability ─────────────────────────────────────────────
            liability: liabilityRow ?? null,
            //   solvency = vault_can_pay − liability. We don't know the actual
            //   vault wallet balance from here (would need RPC to chain), but
            //   we expose the liability so the operator can compare manually.

            // ── Trends (30-day daily series) ────────────────────────────────
            trends: {
                dau: dauTrend.data ?? [],
                signups: signupsTrend.data ?? [],
            },

            // Useful derived metrics for the UI
            derived: {
                lifetimeFlightHouseEdge: flightHouseEdge,
                lifetimeCardsRevenue: cardsRevenue,
                lifetimeFlightNet: flightNet,
                outstandingLiability: liabilityTotal,
            },
        }, { headers: { 'cache-control': 'no-store' } })
    } catch (err: any) {
        console.error('[admin/stats/overview]', err.message)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
