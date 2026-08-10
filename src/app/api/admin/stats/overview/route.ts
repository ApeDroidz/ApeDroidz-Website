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
            ticketsToday, ticketsApeToday,
            errorsToday,
            usersTotal, glitchUsersTotal,
            lifetime,
            dauTrend, signupsTrend,
        ] = await Promise.all([
            supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                .eq('status', 'success').gte('created_at', since24h),
            supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                .eq('status', 'success').gte('created_at', since7d),
            supabaseAdmin.from('ticket_purchases').select('id', { count: 'exact', head: true })
                .gte('created_at', since24h),
            supabaseAdmin.from('ticket_purchases').select('ape_amount').gte('created_at', since24h),
            supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                .eq('status', 'error').gte('created_at', since24h),
            supabaseAdmin.from('users').select('wallet_address', { count: 'exact', head: true }),
            supabaseAdmin.from('glitch_users').select('wallet_address', { count: 'exact', head: true }),

            // Heavy aggregates via SQL RPCs
            supabaseAdmin.rpc('admin_lifetime_totals'),
            supabaseAdmin.rpc('admin_dau_trend', { p_days: 30 }),
            supabaseAdmin.rpc('admin_signups_trend', { p_days: 30 }),
        ])

        const sumApe = (rows: any) => (rows?.data ?? []).reduce((s: number, r: any) => s + Number(r.ape_amount ?? 0), 0)

        // RPC results: rpc returns array (TABLE) — pick first row for single-row functions
        const lifetimeRow = Array.isArray(lifetime.data) ? lifetime.data[0] : lifetime.data

        // Detect missing analytics RPCs (PGRST202 = function not found in PostgREST schema cache)
        const missingRpcs: string[] = []
        if (lifetime.error?.code === 'PGRST202' || lifetime.error?.message?.includes('does not exist')) missingRpcs.push('admin_lifetime_totals')
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
            users: {
                total: usersTotal.count ?? 0,
                glitchUsers: glitchUsersTotal.count ?? 0,
            },
            health: {
                errorsToday: errorsToday.count ?? 0,
            },

            // ── Lifetime ────────────────────────────────────────────────────
            lifetime: lifetimeRow ?? null,

            // ── Trends (30-day daily series) ────────────────────────────────
            trends: {
                dau: dauTrend.data ?? [],
                signups: signupsTrend.data ?? [],
            },
        }, { headers: { 'cache-control': 'no-store' } })
    } catch (err: any) {
        console.error('[admin/stats/overview]', err.message)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
