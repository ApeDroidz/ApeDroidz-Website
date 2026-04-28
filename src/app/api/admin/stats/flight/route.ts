import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/stats/flight?window=24h|7d|30d|all
 *
 *   - Window-scoped: rounds, bets, volume, house edge, money flow, queues,
 *     top profits, biggest losses, crash-point histogram (group-by RPC).
 *   - Always-on: vault liability snapshot (sum of all flight_balances).
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
        const [
            roundsAgg, bets, deposits, withdrawals,
            pendingWds, pendingInvest,
            topProfits, biggestLosses, recentLog,
            distinct, crashBuckets, liability, avgBet,
        ] = await Promise.all([
            since
                ? supabaseAdmin.from('flight_sessions').select('id', { count: 'exact', head: true })
                    .eq('status', 'crashed').gte('crashed_at', since)
                : supabaseAdmin.from('flight_sessions').select('id', { count: 'exact', head: true })
                    .eq('status', 'crashed'),

            since
                ? supabaseAdmin.from('flight_game_logs')
                    .select('wallet_address, bet_amount, cashout_at, profit, xp_gained, created_at')
                    .gte('created_at', since)
                : supabaseAdmin.from('flight_game_logs')
                    .select('wallet_address, bet_amount, cashout_at, profit, xp_gained, created_at'),

            since
                ? supabaseAdmin.from('flight_transactions').select('amount, created_at')
                    .eq('type', 'deposit').eq('status', 'confirmed').gte('created_at', since)
                : supabaseAdmin.from('flight_transactions').select('amount, created_at')
                    .eq('type', 'deposit').eq('status', 'confirmed'),

            since
                ? supabaseAdmin.from('flight_transactions').select('amount, created_at')
                    .eq('type', 'withdrawal').eq('status', 'confirmed').gte('created_at', since)
                : supabaseAdmin.from('flight_transactions').select('amount, created_at')
                    .eq('type', 'withdrawal').eq('status', 'confirmed'),

            // queues — always all open
            supabaseAdmin.from('flight_transactions')
                .select('id, wallet_address, amount, created_at, status, tx_hash')
                .eq('type', 'withdrawal').eq('status', 'pending')
                .order('created_at', { ascending: true }).limit(20),
            supabaseAdmin.from('flight_transactions')
                .select('id, wallet_address, amount, created_at, tx_hash, type')
                .eq('status', 'pending_investigation')
                .order('created_at', { ascending: false }).limit(20),

            // Top profits (RPC handles GROUP BY)
            supabaseAdmin.rpc('admin_top_flight_profits', { p_limit: 15, p_since: since }),

            // Biggest single losses
            since
                ? supabaseAdmin.from('flight_game_logs')
                    .select('wallet_address, bet_amount, created_at')
                    .is('cashout_at', null).gte('created_at', since)
                    .order('bet_amount', { ascending: false }).limit(15)
                : supabaseAdmin.from('flight_game_logs')
                    .select('wallet_address, bet_amount, created_at')
                    .is('cashout_at', null)
                    .order('bet_amount', { ascending: false }).limit(15),

            supabaseAdmin.from('flight_game_logs')
                .select('wallet_address, bet_amount, cashout_at, profit, created_at')
                .order('created_at', { ascending: false }).limit(50),

            // Distinct players
            supabaseAdmin.rpc('admin_distinct_players', { p_table: 'flight_game_logs', p_since: since }),

            // Crash histogram
            supabaseAdmin.rpc('admin_flight_crash_buckets', { p_since: since }),

            // Vault liability (all-time, snapshot)
            supabaseAdmin.rpc('admin_flight_liability'),

            // Average bet for the window (cheap aggregate via the same data we already pulled)
            since
                ? supabaseAdmin.from('flight_game_logs').select('bet_amount').gte('created_at', since).limit(10000)
                : supabaseAdmin.from('flight_game_logs').select('bet_amount').limit(10000),
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

        const avgBetVal = (avgBet.data ?? []).length > 0
            ? (avgBet.data ?? []).reduce((s: number, r: any) => s + Number(r.bet_amount || 0), 0) / Math.max(1, (avgBet.data ?? []).length)
            : 0

        const liabilityRow = Array.isArray(liability.data) ? liability.data[0] : liability.data

        return NextResponse.json({
            window: win,
            rounds: roundsAgg.count ?? 0,
            betsCount: betsArr.length,
            uniquePlayers: Number(distinct.data ?? 0),
            volume: {
                totalBets, totalPayout, houseEdgeRealised, avgBet: avgBetVal,
                edgePct: totalBets > 0 ? (houseEdgeRealised / totalBets) * 100 : 0,
            },
            outcome: { winners, losers, winRate: betsArr.length > 0 ? (winners / betsArr.length) * 100 : 0 },
            money: { deposits: sumDeposits, withdrawals: sumWithdrawals, net: sumDeposits - sumWithdrawals },
            queue: { pendingWithdrawals: pendingWds.data ?? [], pendingInvestigation: pendingInvest.data ?? [] },
            topProfits: topProfits.data ?? [],
            biggestLosses: biggestLosses.data ?? [],
            recentActivity: recentLog.data ?? [],
            crashHistogram: crashBuckets.data ?? [],
            liability: liabilityRow ?? null,
        }, { headers: { 'cache-control': 'no-store' } })
    } catch (err: any) {
        console.error('[admin/stats/flight]', err.message)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
