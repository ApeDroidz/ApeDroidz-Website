import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { privateKeyToAccount } from 'thirdweb/wallets'
import { eth_getBalance, getRpcClient } from 'thirdweb/rpc'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { apeChainServer, createServerThirdwebClient } from '@/lib/apechain'

/**
 * Баланс призового волта Glitch Cards в APE.
 *
 * Мониторился только волт Glitch Flight, а этот — нет. Когда он опустел,
 * каждый выигрыш APE отлетал с «insufficient funds», игрок терял спин, и
 * узнали мы об этом лишь из жалобы. Порог считаем от самого дорогого
 * активного APE-приза: если волт не покрывает даже его — это критично.
 */
async function prizeVaultStatus(): Promise<
    { address: string; ape: number; maxPrize: number } | { error: string }
> {
    const pk = process.env.PRIZE_VAULT_PRIVATE_KEY
    if (!pk) return { error: 'PRIZE_VAULT_PRIVATE_KEY not set' }
    try {
        const client = createServerThirdwebClient()
        const account = privateKeyToAccount({ client, privateKey: pk })
        const rpc = getRpcClient({ client, chain: apeChainServer })
        const [wei, prizes] = await Promise.all([
            eth_getBalance(rpc, { address: account.address as `0x${string}` }),
            supabaseAdmin.from('prize_types').select('amount').eq('type', 'token').eq('is_active', true),
        ])
        const maxPrize = Math.max(
            0,
            ...(prizes.data ?? []).map((p: any) => Number(p.amount) || 0)
        )
        return { address: account.address, ape: Number(wei) / 1e18, maxPrize }
    } catch (e: any) {
        return { error: e?.message ?? 'vault check failed' }
    }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Alert {
    severity: 'critical' | 'warning' | 'info'
    kind: string
    message: string
    detail?: any
    /** Stable sha256 of the alert detail — used by the dismiss table. */
    fingerprint?: string
}

/** Stable JSON stringify (sorted keys) so equivalent payloads hash the same. */
function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}

function fingerprintOf(detail: unknown): string {
    return createHash('sha256').update(stableStringify(detail)).digest('hex')
}

/**
 * GET /api/admin/health
 *
 * Surface anomalies and bug-shaped issues that need attention. The intent is
 * "open the panel, see red dots = something to fix" rather than a crystal
 * ball. Designed to be cheap — runs in <1s for a normal-size DB.
 */
export async function GET(req: Request) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const now = Date.now()
    const since24h = new Date(now - 86400_000).toISOString()
    const since7d = new Date(now - 7 * 86400_000).toISOString()

    try {
        const [
            pendingInvest, errorsRecent, mergesFailed,
            stuckPending, dupHandles, vaultRow,
            highWinRate, multiAccountByX, recentRollbacks,
            dismissalsRes,
        ] = await Promise.all([
            supabaseAdmin.from('flight_transactions')
                .select('id, wallet_address, amount, created_at, tx_hash, type')
                .eq('status', 'pending_investigation')
                .order('created_at', { ascending: false }).limit(50),

            supabaseAdmin.from('game_logs')
                .select('wallet_address, prize_type_id, error_message, created_at')
                .eq('status', 'error').gte('created_at', since24h)
                .order('created_at', { ascending: false }).limit(50),

            supabaseAdmin.from('merge_logs')
                .select('user_wallet, tx_hash, error_message, created_at')
                .eq('status', 'failed').gte('created_at', since7d)
                .order('created_at', { ascending: false }).limit(20),

            // Pending withdrawals stuck >1h
            supabaseAdmin.from('flight_transactions')
                .select('id, wallet_address, amount, created_at, tx_hash')
                .eq('type', 'withdrawal').eq('status', 'pending')
                .lt('created_at', new Date(now - 60 * 60_000).toISOString())
                .order('created_at', { ascending: true }).limit(20),

            // Same X handle on multiple wallets in the daily claims log.
            // Reads the S2-isolated table — pre-S2 history isn't operationally
            // relevant for live multi-account detection.
            supabaseAdmin.from('daily_claims_log_s2')
                .select('x_handle, wallet_address, claimed_at')
                .not('x_handle', 'is', null).gte('claimed_at', since7d),

            // Vault balance vs daily cap
            supabaseAdmin.from('vault_limits').select('daily_withdrawal_cap, max_win_pct')
                .eq('id', 1).maybeSingle(),

            // Wallets with very high cards win rate (>= 90% NFT prizes)
            supabaseAdmin.from('game_logs')
                .select('wallet_address, prize_type_id')
                .eq('status', 'success').gte('created_at', since7d),

            // Same X handle multi-wallet (sister query — collected separately for recency)
            supabaseAdmin.from('glitch_users')
                .select('wallet_address, x_handle').not('x_handle', 'is', null),

            // NFT inventory rolled back in the last 24h (winner_wallet null but won_at recent)
            supabaseAdmin.from('nft_inventory').select('id, token_id, prize_type_id, status')
                .eq('status', 'available').gte('won_at', since24h),

            // Active alert dismissals — alerts whose fingerprint matches a row
            // here are suppressed. If the fingerprint changes (e.g. new error
            // arrives), the alert resurfaces automatically.
            supabaseAdmin.from('health_alert_dismissals')
                .select('kind, fingerprint'),
        ])

        const dismissalMap: Record<string, string> = {}
        for (const row of (dismissalsRes?.data ?? [])) {
            if (row?.kind && row?.fingerprint) dismissalMap[String(row.kind)] = String(row.fingerprint)
        }

        const alerts: Alert[] = []
        function pushAlert(a: Alert): void {
            const fp = fingerprintOf(a.detail ?? null)
            // Suppress if a dismissal exists for this kind with the same fingerprint.
            // A new error or a new wallet changes the fingerprint and resurfaces it.
            if (dismissalMap[a.kind] === fp) return
            alerts.push({ ...a, fingerprint: fp })
        }

        // ── pending_investigation — manual review needed ────────────────────
        if ((pendingInvest.data ?? []).length > 0) {
            pushAlert({
                severity: 'critical',
                kind: 'flight_pending_investigation',
                message: `${pendingInvest.data?.length} flight transaction(s) in pending_investigation`,
                detail: pendingInvest.data,
            })
        }

        // ── stuck pending withdrawals ───────────────────────────────────────
        if ((stuckPending.data ?? []).length > 0) {
            pushAlert({
                severity: 'critical',
                kind: 'flight_stuck_withdrawals',
                message: `${stuckPending.data?.length} withdrawal(s) stuck in 'pending' >1h`,
                detail: stuckPending.data,
            })
        }

        // ── recent errors spike ─────────────────────────────────────────────
        if ((errorsRecent.data ?? []).length > 0) {
            pushAlert({
                severity: (errorsRecent.data?.length ?? 0) > 10 ? 'critical' : 'warning',
                kind: 'cards_errors_recent',
                message: `${errorsRecent.data?.length} Cards errors in last 24h`,
                detail: (errorsRecent.data ?? []).slice(0, 20),
            })
        }

        // ── failed merges ───────────────────────────────────────────────────
        if ((mergesFailed.data ?? []).length > 0) {
            pushAlert({
                severity: 'warning',
                kind: 'merge_failures',
                message: `${mergesFailed.data?.length} failed merge attempt(s) in last 7d`,
                detail: mergesFailed.data,
            })
        }

        // ── multi-account detection (same X handle, different wallets) ─────
        const handleMap: Record<string, Set<string>> = {}
        for (const row of (multiAccountByX.data ?? [])) {
            const h = String(row.x_handle ?? '').toLowerCase()
            if (!h) continue
            if (!handleMap[h]) handleMap[h] = new Set()
            handleMap[h].add(String(row.wallet_address ?? '').toLowerCase())
        }
        const dupes = Object.entries(handleMap)
            .filter(([, set]) => set.size > 1)
            .map(([handle, set]) => ({ handle, wallets: [...set] }))
        if (dupes.length > 0) {
            pushAlert({
                severity: 'warning',
                kind: 'multi_account_x_handle',
                message: `${dupes.length} X handle(s) used by multiple wallets`,
                detail: dupes.slice(0, 20),
            })
        }

        // ── high win rate (Cards) ───────────────────────────────────────────
        const winRateMap: Record<string, { total: number; nfts: number }> = {}
        for (const r of (highWinRate.data ?? [])) {
            const w = String(r.wallet_address ?? '').toLowerCase()
            if (!w) continue
            if (!winRateMap[w]) winRateMap[w] = { total: 0, nfts: 0 }
            winRateMap[w].total++
            const p = String(r.prize_type_id ?? '')
            // Anything that isn't a shard or token is treated as a "high-value" prize.
            if (!p.startsWith('shard') && p !== 'std_battery') winRateMap[w].nfts++
        }
        const sus = Object.entries(winRateMap)
            .filter(([, v]) => v.total >= 10 && v.nfts / v.total >= 0.9)
            .map(([w, v]) => ({ wallet: w, plays: v.total, nftRate: (v.nfts / v.total).toFixed(2) }))
        if (sus.length > 0) {
            pushAlert({
                severity: 'warning',
                kind: 'cards_suspicious_winrate',
                message: `${sus.length} wallet(s) with >=90% NFT win rate over last 7d`,
                detail: sus,
            })
        }

        // ── призовой волт Cards: хватает ли APE на выплаты ─────────────────
        const vault = await prizeVaultStatus()
        if ('error' in vault) {
            pushAlert({
                severity: 'warning',
                kind: 'prize_vault_unreadable',
                message: `Cards prize vault balance could not be read: ${vault.error}`,
            })
        } else if (vault.maxPrize > 0 && vault.ape < vault.maxPrize) {
            pushAlert({
                severity: 'critical',
                kind: 'prize_vault_empty',
                message: `Cards prize vault holds ${vault.ape.toFixed(2)} APE — not enough for the ${vault.maxPrize} APE prize. Every APE win is failing right now.`,
                detail: { address: vault.address, ape: vault.ape, maxPrize: vault.maxPrize },
            })
        } else if (vault.maxPrize > 0 && vault.ape < vault.maxPrize * 5) {
            pushAlert({
                severity: 'warning',
                kind: 'prize_vault_low',
                message: `Cards prize vault holds ${vault.ape.toFixed(2)} APE — under five payouts of the ${vault.maxPrize} APE top prize. Top it up.`,
                detail: { address: vault.address, ape: vault.ape, maxPrize: vault.maxPrize },
            })
        }

        // ── inventory rollbacks (NFT transfers that failed) ────────────────
        if ((recentRollbacks.data ?? []).length > 0) {
            pushAlert({
                severity: 'info',
                kind: 'inventory_rollbacks',
                message: `${recentRollbacks.data?.length} inventory item(s) rolled back to available in last 24h`,
                detail: recentRollbacks.data,
            })
        }

        return NextResponse.json({
            generatedAt: new Date().toISOString(),
            alerts: alerts.sort((a, b) =>
                ({ critical: 0, warning: 1, info: 2 }[a.severity] - { critical: 0, warning: 1, info: 2 }[b.severity])
            ),
            stats: {
                vaultLimits: vaultRow.data ?? null,
                prizeVault: 'error' in vault ? { error: vault.error } : vault,
                pendingInvestigationCount: pendingInvest.data?.length ?? 0,
                stuckWithdrawalsCount: stuckPending.data?.length ?? 0,
                cardsErrors24hCount: errorsRecent.data?.length ?? 0,
                mergeFailures7dCount: mergesFailed.data?.length ?? 0,
                multiAccountFlags: dupes.length,
                susWinRate: sus.length,
            },
        }, { headers: { 'cache-control': 'no-store' } })
    } catch (err: any) {
        console.error('[admin/health]', err.message)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
