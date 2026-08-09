import { NextResponse } from 'next/server'
import { createThirdwebClient } from 'thirdweb'
import { eth_getBalance, getRpcClient } from 'thirdweb/rpc'
import { privateKeyToAccount } from 'thirdweb/wallets'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { apeChainServer } from '@/lib/apechain'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/sys/vault-info
 *
 * Diagnostic for the Flight vault. Reports:
 *   - Address derived from FLIGHT_PRIZE_VAULT_PRIVATE_KEY (the wallet that
 *     actually signs withdraw transactions)
 *   - NEXT_PUBLIC_FLIGHT_VAULT_WALLET_ADDRESS env (the wallet players send
 *     deposits to, and that the front-end displays)
 *   - On-chain balance of each
 *   - keysMatchAddress: true iff the private key signs from the same address
 *     players deposit to. If false → withdrawals will revert with
 *     "insufficient funds" because the signing wallet has no APE.
 *   - Recent failed withdrawals from flight_transactions (last 5).
 *   - Logical vault_net from get_vault_net_balance RPC, if available.
 *
 * This is admin-only via the existing requireAdmin guard.
 */
export async function GET(req: Request) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const apeChain = apeChainServer
    const thirdwebClient = createThirdwebClient({
        clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
        secretKey: process.env.THIRDWEB_SECRET_KEY,
    })
    const rpc = getRpcClient({ client: thirdwebClient, chain: apeChain })

    const envAddress = (process.env.NEXT_PUBLIC_FLIGHT_VAULT_WALLET_ADDRESS ?? '').trim()
    const pk = process.env.FLIGHT_PRIZE_VAULT_PRIVATE_KEY ?? ''

    let derivedAddress: string | null = null
    let derivedError: string | null = null
    if (pk) {
        try {
            const account = privateKeyToAccount({ client: thirdwebClient, privateKey: pk })
            derivedAddress = account.address
        } catch (e: any) {
            derivedError = e?.message ?? 'invalid private key'
        }
    }

    async function balanceOf(addr: string | null | undefined): Promise<{ wei: string; ape: number } | null> {
        if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) return null
        try {
            const wei = await eth_getBalance(rpc, { address: addr as `0x${string}` })
            const ape = Number(wei) / 1e18
            return { wei: wei.toString(), ape }
        } catch (e: any) {
            return { wei: 'error', ape: NaN }
        }
    }

    const [envBal, derivedBal] = await Promise.all([
        balanceOf(envAddress),
        balanceOf(derivedAddress),
    ])

    // Logical vault — what the bet protection logic uses today.
    let vaultNet: number | null = null
    let vaultNetError: string | null = null
    try {
        const { data, error } = await supabaseAdmin.rpc('get_vault_net_balance')
        if (error) vaultNetError = error.message
        else vaultNet = Number(data ?? 0)
    } catch (e: any) {
        vaultNetError = e?.message ?? 'unknown error'
    }

    // Sum of player liability (in-game balances we owe to players).
    let playerLiability: number | null = null
    try {
        const { data } = await supabaseAdmin.rpc('admin_flight_liability')
        const row = Array.isArray(data) ? data[0] : data
        if (row) playerLiability = Number(row.total_balance ?? 0)
    } catch { /* ignore — it's an admin-only RPC, may not be applied yet */ }

    // Recent failed withdrawal attempts so the operator can correlate.
    const { data: recentFailures } = await supabaseAdmin
        .from('flight_transactions')
        .select('id, wallet_address, amount, status, created_at, tx_hash')
        .eq('type', 'withdrawal')
        .in('status', ['failed', 'pending_investigation'])
        .order('created_at', { ascending: false })
        .limit(5)

    const keysMatchAddress = !!(envAddress && derivedAddress &&
        envAddress.toLowerCase() === derivedAddress.toLowerCase())

    const warnings: string[] = []
    if (!envAddress) warnings.push('NEXT_PUBLIC_FLIGHT_VAULT_WALLET_ADDRESS is not set')
    if (!pk) warnings.push('FLIGHT_PRIZE_VAULT_PRIVATE_KEY is not set')
    if (derivedError) warnings.push(`Private key invalid: ${derivedError}`)
    if (envAddress && derivedAddress && !keysMatchAddress) {
        warnings.push('CRITICAL: private key does NOT correspond to the env vault address — withdrawals will fail with "insufficient funds" (signing wallet has 0 APE)')
    }
    if (envBal && envBal.ape < 1) warnings.push(`Env vault wallet has only ${envBal.ape.toFixed(4)} APE — top up if you expect any withdrawals`)
    if (vaultNetError) warnings.push(`get_vault_net_balance RPC error: ${vaultNetError}`)
    if (vaultNet != null && vaultNet < 100) warnings.push(`Logical vault_net is ${vaultNet.toFixed(2)} APE — current bet-protection math may block all bets (need ~6500 APE for safe 5-APE bets at 5% pct)`)

    return NextResponse.json({
        keysMatchAddress,
        env: {
            address: envAddress || null,
            balance: envBal,
        },
        derivedFromPrivateKey: {
            address: derivedAddress,
            balance: derivedBal,
            error: derivedError,
        },
        logical: {
            vaultNet,
            vaultNetError,
            playerLiability,
            houseMoney: vaultNet != null && playerLiability != null ? vaultNet - playerLiability : null,
        },
        warnings,
        recentFailedWithdrawals: recentFailures ?? [],
    }, { headers: { 'cache-control': 'no-store' } })
}
