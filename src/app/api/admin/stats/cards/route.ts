import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/stats/cards?window=24h|7d|30d
 */
export async function GET(req: NextRequest) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const win = req.nextUrl.searchParams.get('window') ?? '24h'
    const ms = win === '7d' ? 7 * 86400_000 : win === '30d' ? 30 * 86400_000 : 86400_000
    const since = new Date(Date.now() - ms).toISOString()

    try {
        const [
            playsAgg, errorsAgg, distinctWallets, ticketsBought,
            prizeBreakdown, topWinners, recentLog,
        ] = await Promise.all([
            // Total successful plays in window
            supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                .eq('status', 'success').gte('created_at', since),

            // Errors in window
            supabaseAdmin.from('game_logs').select('id', { count: 'exact', head: true })
                .eq('status', 'error').gte('created_at', since),

            // Distinct wallets that played
            supabaseAdmin.from('game_logs').select('wallet_address')
                .eq('status', 'success').gte('created_at', since),

            // Tickets bought in window
            supabaseAdmin.from('ticket_purchases').select('ticket_count, ape_amount, created_at')
                .gte('created_at', since),

            // Prize drop distribution (group by prize_type_id)
            supabaseAdmin.from('game_logs').select('prize_type_id')
                .eq('status', 'success').gte('created_at', since),

            // Top winners — pull NFTs from inventory claimed in window
            supabaseAdmin.from('nft_inventory')
                .select('winner_wallet, name, image_url, contract_address, token_id, won_at')
                .eq('status', 'claimed').gte('won_at', since)
                .order('won_at', { ascending: false }).limit(10),

            // Recent activity
            supabaseAdmin.from('game_logs')
                .select('wallet_address, prize_type_id, prize_amount_or_id, status, created_at, error_message')
                .gte('created_at', since).order('created_at', { ascending: false }).limit(50),
        ])

        // ── Aggregations ─────────────────────────────────────────────────────
        const distinctSet = new Set((distinctWallets.data ?? []).map((r: any) => String(r.wallet_address).toLowerCase()))

        const ticketsTotal = (ticketsBought.data ?? []).reduce((s: number, r: any) => s + Number(r.ticket_count || 0), 0)
        const apeTotal = (ticketsBought.data ?? []).reduce((s: number, r: any) => s + Number(r.ape_amount || 0), 0)

        const dist: Record<string, number> = {}
        for (const r of (prizeBreakdown.data ?? [])) {
            const id = r.prize_type_id || 'unknown'
            dist[id] = (dist[id] ?? 0) + 1
        }
        const distArr = Object.entries(dist)
            .map(([k, v]) => ({ prize: k, count: v }))
            .sort((a, b) => b.count - a.count)

        return NextResponse.json({
            window: win,
            playsTotal: playsAgg.count ?? 0,
            errorsCount: errorsAgg.count ?? 0,
            uniquePlayers: distinctSet.size,
            ticketsBought: ticketsTotal,
            apeRevenue: apeTotal,
            prizeDistribution: distArr,
            topWinners: topWinners.data ?? [],
            recentActivity: recentLog.data ?? [],
        }, { headers: { 'cache-control': 'no-store' } })
    } catch (err: any) {
        console.error('[admin/stats/cards]', err.message)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
