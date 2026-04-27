import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/stats/flight?window=24h|7d|30d
 *
 * Operational view of Glitch Flight: rounds, bet volume, vault PnL,
 * pending withdrawals queue, top winners/losers.
 */
export async function GET(req: NextRequest) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const win = req.nextUrl.searchParams.get('window') ?? '24h'
    const ms = win === '7d' ? 7 * 86400_000 : win === '30d' ? 30 * 86400_000 : 86400_000
    const since = new Date(Date.now() - ms).toISOString()

    try {
        const [
            roundsAgg, bets, deposits, withdrawals,
            pendingWds, pendingInvest,
            topProfits, biggestLosses, recentLog,
        ] = await Promise.all([
            supabaseAdmin.from('flight_sessions').select('id', { count: 'exact', head: true })
                .eq('status', 'crashed').gte('crashed_at', since),

            supabaseAdmin.from('flight_game_logs')
                .select('wallet_address, bet_amount, cashout_at, profit, xp_gained, created_at')
                .gte('created_at', since),

            supabaseAdmin.from('flight_transactions').select('amount, created_at')
                .eq('type', 'deposit').eq('status', 'confirmed').gte('created_at', since),

            supabaseAdmin.from('flight_transactions').select('amount, created_at')
                .eq('type', 'withdrawal').eq('status', 'confirmed').gte('created_at', since),

            // queue
            supabaseAdmin.from('flight_transactions')
                .select('id, wallet_address, amount, created_at, status, tx_hash')
                .eq('type', 'withdrawal').eq('status', 'pending')
                .order('created_at', { ascending: true }).limit(20),
            supabaseAdmin.from('flight_transactions')
                .select('id, wallet_address, amount, created_at, tx_hash')
                .eq('status', 'pending_investigation')
                .order('created_at', { ascending: false }).limit(20),

            // Top profits
            supabaseAdmin.from('flight_game_logs')
                .select('wallet_address, profit, cashout_at, created_at')
                .not('profit', 'is', null).gte('created_at', since)
                .order('profit', { ascending: false }).limit(10),

            // Biggest losses (no cashout)
            supabaseAdmin.from('flight_game_logs')
                .select('wallet_address, bet_amount, created_at')
                .is('cashout_at', null).gte('created_at', since)
                .order('bet_amount', { ascending: false }).limit(10),

            supabaseAdmin.from('flight_game_logs')
                .select('wallet_address, bet_amount, cashout_at, profit, created_at')
                .gte('created_at', since)
                .order('created_at', { ascending: false }).limit(50),
        ])

        // ── Aggregations ─────────────────────────────────────────────────────
        const betsArr = bets.data ?? []
        const totalBets = betsArr.reduce((s: number, r: any) => s + Number(r.bet_amount || 0), 0)
        const totalPayout = betsArr.reduce((s: number, r: any) => {
            const a = r.cashout_at ? Number(r.cashout_at) : 0
            const amt = Number(r.bet_amount || 0)
            return s + (a ? a * amt : 0)
        }, 0)
        const houseEdgeRealised = totalBets - totalPayout
        const winners = betsArr.filter((b: any) => b.cashout_at != null).length
        const losers = betsArr.filter((b: any) => b.cashout_at == null).length

        const sumDeposits = (deposits.data ?? []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0)
        const sumWithdrawals = (withdrawals.data ?? []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0)

        const distinctPlayers = new Set(betsArr.map((b: any) => String(b.wallet_address).toLowerCase())).size

        return NextResponse.json({
            window: win,
            rounds: roundsAgg.count ?? 0,
            betsCount: betsArr.length,
            uniquePlayers: distinctPlayers,
            volume: {
                totalBets,
                totalPayout,
                houseEdgeRealised,
                edgePct: totalBets > 0 ? (houseEdgeRealised / totalBets) * 100 : 0,
            },
            outcome: { winners, losers },
            money: {
                deposits: sumDeposits,
                withdrawals: sumWithdrawals,
                net: sumDeposits - sumWithdrawals,
            },
            queue: {
                pendingWithdrawals: pendingWds.data ?? [],
                pendingInvestigation: pendingInvest.data ?? [],
            },
            topProfits: topProfits.data ?? [],
            biggestLosses: biggestLosses.data ?? [],
            recentActivity: recentLog.data ?? [],
        }, { headers: { 'cache-control': 'no-store' } })
    } catch (err: any) {
        console.error('[admin/stats/flight]', err.message)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
