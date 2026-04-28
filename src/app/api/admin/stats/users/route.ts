import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { isValidWallet } from '@/lib/walletAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/stats/users
 *
 * Modes (mutually exclusive):
 *   - default          → top spenders + top profits + worst losers + recent signups
 *   - ?wallet=0x...    → drill-down: full activity for a single wallet
 */
export async function GET(req: NextRequest) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const wallet = req.nextUrl.searchParams.get('wallet')

    try {
        // ── Drill-down mode ──────────────────────────────────────────────
        if (wallet) {
            if (!isValidWallet(wallet)) {
                return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
            }
            const w = wallet.toLowerCase()

            const [summary, recentCards, recentFlight, recentTx, recentNfts] = await Promise.all([
                supabaseAdmin.rpc('admin_wallet_summary', { p_wallet: w }),

                supabaseAdmin.from('game_logs')
                    .select('prize_type_id, prize_amount_or_id, status, xp_awarded, created_at, error_message, tx_hash')
                    .ilike('wallet_address', w)
                    .order('created_at', { ascending: false }).limit(30),

                supabaseAdmin.from('flight_game_logs')
                    .select('bet_amount, cashout_at, profit, xp_gained, created_at')
                    .ilike('wallet_address', w)
                    .order('created_at', { ascending: false }).limit(30),

                supabaseAdmin.from('flight_transactions')
                    .select('type, amount, status, tx_hash, created_at')
                    .ilike('wallet_address', w)
                    .order('created_at', { ascending: false }).limit(30),

                supabaseAdmin.from('nft_inventory')
                    .select('name, image_url, contract_address, token_id, won_at, prize_type_id')
                    .ilike('winner_wallet', w).eq('status', 'claimed')
                    .order('won_at', { ascending: false }).limit(30),
            ])

            const sumRow = Array.isArray(summary.data) ? summary.data[0] : summary.data

            return NextResponse.json({
                wallet: w,
                summary: sumRow ?? null,
                recentCards: recentCards.data ?? [],
                recentFlight: recentFlight.data ?? [],
                recentTransactions: recentTx.data ?? [],
                nftsWon: recentNfts.data ?? [],
            }, { headers: { 'cache-control': 'no-store' } })
        }

        // ── Top lists ────────────────────────────────────────────────────
        const win = req.nextUrl.searchParams.get('window') ?? 'all'
        const ms = win === 'all' ? null
            : win === '30d' ? 30 * 86400_000
            : win === '7d' ? 7 * 86400_000
            : 86400_000
        const since = ms == null ? null : new Date(Date.now() - ms).toISOString()

        const [
            topSpenders, topProfits, worstLosers, signups, signupsTrend,
        ] = await Promise.all([
            supabaseAdmin.rpc('admin_top_card_spenders', { p_limit: 50 }),
            supabaseAdmin.rpc('admin_top_flight_profits', { p_limit: 50, p_since: since }),
            supabaseAdmin.rpc('admin_worst_flight_losers', { p_limit: 50, p_since: since }),
            supabaseAdmin.rpc('admin_recent_signups', { p_limit: 50 }),
            supabaseAdmin.rpc('admin_signups_trend', { p_days: 30 }),
        ])

        return NextResponse.json({
            window: win,
            topSpenders: topSpenders.data ?? [],
            topProfits: topProfits.data ?? [],
            worstLosers: worstLosers.data ?? [],
            recentSignups: signups.data ?? [],
            signupsTrend: signupsTrend.data ?? [],
        }, { headers: { 'cache-control': 'no-store' } })
    } catch (err: any) {
        console.error('[admin/stats/users]', err.message)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
