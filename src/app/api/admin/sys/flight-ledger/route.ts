import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/sys/flight-ledger?since=2026-04-29
 *
 * Reconstructs the realized house P&L from raw flight logs. Use this when
 * a long lucky-streak makes you suspicious that the math might be broken.
 *
 * What it does
 *   total_bets         = Σ bet_amount  in flight_game_logs in window
 *   total_winnings     = Σ cashout_at × bet_amount  where cashout_at IS NOT NULL
 *   total_lost_to_house = Σ bet_amount  where cashout_at IS NULL  (= no cashout, full bet kept)
 *   house_pnl          = total_bets − total_winnings  (positive = house ahead)
 *   realized_edge_pct  = house_pnl / total_bets × 100   (target ≈ 10–11%)
 *
 * If realized_edge_pct is sitting around +9–13% over a few hundred rounds,
 * the crash math is doing exactly what it's supposed to. If it's near zero
 * or negative across thousands of rounds, something is leaking and we dig.
 *
 * Window defaults to the configured Season-2 cutoff (2026-04-09).
 */

const DEFAULT_SINCE = '2026-04-09T00:00:00.000Z'

export async function GET(req: NextRequest) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const since = req.nextUrl.searchParams.get('since')
        ? new Date(req.nextUrl.searchParams.get('since')!).toISOString()
        : DEFAULT_SINCE

    const { data, error } = await supabaseAdmin
        .from('flight_game_logs')
        .select('bet_amount, cashout_at')
        .gte('created_at', since)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const rows = data ?? []
    let totalBets = 0
    let totalWinnings = 0
    let totalLost = 0
    let wins = 0
    let losses = 0
    let highestCashout = 0
    let largestPayout = 0
    let losingRounds = 0
    let winningRounds = 0

    for (const r of rows) {
        const bet = Number(r.bet_amount) || 0
        totalBets += bet
        const cashout = r.cashout_at == null ? null : Number(r.cashout_at)
        if (cashout == null) {
            totalLost += bet
            losses++
            losingRounds++
        } else {
            const payout = cashout * bet
            totalWinnings += payout
            wins++
            winningRounds++
            if (cashout > highestCashout) highestCashout = cashout
            if (payout > largestPayout) largestPayout = payout
        }
    }

    const houseProfit = totalBets - totalWinnings
    const edgePct = totalBets > 0 ? (houseProfit / totalBets) * 100 : 0
    const winRate = (wins + losses) > 0 ? wins / (wins + losses) : 0

    // Pull current logical liquidity for context.
    let vaultNet: number | null = null
    try {
        const { data: rpcData } = await supabaseAdmin.rpc('get_vault_net_balance')
        vaultNet = Number(rpcData ?? 0) || 0
    } catch { /* ignore — endpoint is best-effort */ }

    // Top winners since `since` for sanity (should not all be one wallet).
    const { data: tops } = await supabaseAdmin
        .from('flight_game_logs')
        .select('wallet_address, bet_amount, cashout_at, profit')
        .gte('created_at', since)
        .not('profit', 'is', null)
        .order('profit', { ascending: false })
        .limit(10)

    return NextResponse.json({
        since,
        rounds: rows.length,
        wins,
        losses,
        winRate: Number(winRate.toFixed(4)),

        totals: {
            bets:       Number(totalBets.toFixed(4)),
            winnings:   Number(totalWinnings.toFixed(4)),
            lostToHouse: Number(totalLost.toFixed(4)),
            houseProfit: Number(houseProfit.toFixed(4)),
        },

        realizedEdgePct: Number(edgePct.toFixed(2)),
        targetEdgePct:   '≈ 10–11% with current envs (HOUSE_EDGE=0.1)',

        extremes: {
            highestCashoutMultiplier: highestCashout,
            largestSinglePayout:      Number(largestPayout.toFixed(4)),
        },

        vault: { logical_net: vaultNet },

        topPayouts: tops ?? [],

        verdict: rows.length < 50
            ? `Only ${rows.length} rounds — variance dominates, edge will stabilise after ~500 rounds.`
            : edgePct < 0
            ? '⚠️ House is currently losing money over the window. Investigate.'
            : edgePct < 4
            ? `Realized edge ${edgePct.toFixed(2)}% — below target 10%. Could still be variance, monitor.`
            : edgePct > 20
            ? `Realized edge ${edgePct.toFixed(2)}% — much higher than target, players running hot bad luck.`
            : `Realized edge ${edgePct.toFixed(2)}% — within expected band, math healthy.`,
    }, { headers: { 'cache-control': 'no-store' } })
}
