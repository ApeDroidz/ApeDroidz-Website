import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/stats/cards?window=24h|7d|30d|all
 *
 *   - Window-scoped: plays, errors, unique players, tickets bought, prize
 *     drop distribution (via SQL group-by RPC), top NFT winners.
 *   - All-time-only: drop-rate fairness analysis (configured % vs observed),
 *     hourly heatmap, XP distributed.
 */
export async function GET(req: NextRequest) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const win = req.nextUrl.searchParams.get('window') ?? '24h'
    const ms = win === 'all' ? null
        : win === '30d' ? 30 * 86400_000
        : win === '7d' ? 7 * 86400_000
        : 86400_000

    const since = ms == null ? null : new Date(Date.now() - ms).toISOString()

    try {
        const ticketsBaseQ = since
            ? supabaseAdmin.from('ticket_purchases').select('ticket_count, ape_amount, created_at, wallet_address').gte('created_at', since)
            : supabaseAdmin.from('ticket_purchases').select('ticket_count, ape_amount, created_at, wallet_address')

        const [
            playsAgg, errorsAgg, distinctPlayers,
            ticketsBought, prizeDistRpc, topWinners, recentLog,
            xpAgg, prizeTypes, hourly,
        ] = await Promise.all([
            // Total successful plays
            since
                ? supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                    .eq('status', 'success').gte('created_at', since)
                : supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                    .eq('status', 'success'),

            // Errors
            since
                ? supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                    .eq('status', 'error').gte('created_at', since)
                : supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                    .eq('status', 'error'),

            // Distinct players via RPC (avoids fetching all wallets to JS)
            supabaseAdmin.rpc('admin_distinct_players', { p_table: 'game_logs', p_since: since }),

            // Tickets bought
            ticketsBaseQ,

            // Prize drop distribution (group by, server-side)
            supabaseAdmin.rpc('admin_prize_drop_distribution', { p_since: since }),

            // Top NFT winners
            since
                ? supabaseAdmin.from('nft_inventory')
                    .select('winner_wallet, name, image_url, contract_address, token_id, won_at, prize_type_id')
                    .eq('status', 'claimed').gte('won_at', since)
                    .order('won_at', { ascending: false }).limit(15)
                : supabaseAdmin.from('nft_inventory')
                    .select('winner_wallet, name, image_url, contract_address, token_id, won_at, prize_type_id')
                    .eq('status', 'claimed')
                    .order('won_at', { ascending: false }).limit(15),

            // Recent activity (always last 50, unfiltered by window)
            supabaseAdmin.from('game_logs')
                .select('wallet_address, prize_type_id, prize_amount_or_id, status, created_at, error_message')
                .order('created_at', { ascending: false }).limit(50),

            // Total XP distributed via Cards (window)
            since
                ? supabaseAdmin.from('game_logs').select('xp_awarded').eq('status', 'success').gte('created_at', since)
                : supabaseAdmin.from('game_logs').select('xp_awarded').eq('status', 'success'),

            // Prize catalogue (for fairness analysis)
            supabaseAdmin.from('prize_types').select('id, name, type, drop_chance, xp_reward, is_active'),

            // Hourly distribution (always last 7d — cheap)
            supabaseAdmin.rpc('admin_hourly_play_distribution'),
        ])

        // ── Aggregations in JS (cheap) ───────────────────────────────────
        const ticketsTotal = (ticketsBought.data ?? []).reduce((s: number, r: any) => s + Number(r.ticket_count || 0), 0)
        const apeTotal = (ticketsBought.data ?? []).reduce((s: number, r: any) => s + Number(r.ape_amount || 0), 0)
        const xpDistributed = (xpAgg.data ?? []).reduce((s: number, r: any) => s + Number(r.xp_awarded || 0), 0)

        // ── Drop-rate fairness analysis ──────────────────────────────────
        // Compares each prize's CONFIGURED drop_chance % against OBSERVED %
        // over the selected window. Big delta = either the RNG is biased
        // OR the catalogue was changed mid-flight (also worth knowing).
        const distArr = (prizeDistRpc.data ?? []) as Array<{ prize_type_id: string; drops: number }>
        const totalDrops = distArr.reduce((s, r) => s + Number(r.drops), 0)
        const dropMap: Record<string, number> = {}
        for (const r of distArr) dropMap[r.prize_type_id] = Number(r.drops)

        const totalWeight = (prizeTypes.data ?? []).reduce((s: number, p: any) =>
            s + (p.is_active ? Number(p.drop_chance || 0) : 0), 0)

        const fairness = (prizeTypes.data ?? []).map((p: any) => {
            const observed = dropMap[p.id] ?? 0
            const configuredPct = totalWeight > 0 && p.is_active ? (Number(p.drop_chance) / totalWeight) * 100 : 0
            const observedPct = totalDrops > 0 ? (observed / totalDrops) * 100 : 0
            const delta = observedPct - configuredPct
            return {
                id: p.id,
                name: p.name,
                type: p.type,
                isActive: !!p.is_active,
                configuredPct,
                observedDrops: observed,
                observedPct,
                delta,
            }
        }).sort((a: any, b: any) => b.observedDrops - a.observedDrops)

        return NextResponse.json({
            window: win,
            playsTotal: playsAgg.count ?? 0,
            errorsCount: errorsAgg.count ?? 0,
            uniquePlayers: Number(distinctPlayers.data ?? 0),
            ticketsBought: ticketsTotal,
            apeRevenue: apeTotal,
            xpDistributed,
            prizeDistribution: distArr,
            fairness,
            topWinners: topWinners.data ?? [],
            recentActivity: recentLog.data ?? [],
            hourlyDistribution: hourly.data ?? [],
        }, { headers: { 'cache-control': 'no-store' } })
    } catch (err: any) {
        console.error('[admin/stats/cards]', err.message)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
