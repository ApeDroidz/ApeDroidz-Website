import { createClient } from '@supabase/supabase-js'
import { JsonRpcProvider, formatEther } from 'ethers'

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

export const db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
)

// ── On-chain provider for vault liquidity (read-only) ─────────────────────────
// We use the on-chain APE balance of the vault wallet as the source of truth
// for liquidity. This avoids drift between the DB ledger
// (flight_transactions sum) and the actual wallet — including the case where
// the operator seeds the vault by sending APE directly, which never lands in
// the DB ledger and would otherwise leave `get_vault_net_balance` at 0.
const APECHAIN_RPC = process.env.APECHAIN_RPC_URL ?? 'https://rpc.apechain.com/http'
const VAULT_ADDRESS = (process.env.VAULT_WALLET_ADDRESS ?? '').trim()
const apeProvider = new JsonRpcProvider(APECHAIN_RPC)

// ── Balance operations ─────────────────────────────────────────────────────────

export async function getBalance(wallet: string): Promise<number> {
    const { data } = await db
        .from('flight_balances')
        .select('balance')
        .ilike('wallet_address', wallet)
        .maybeSingle()
    return Number(data?.balance ?? 0)
}

export async function deductBalance(wallet: string, amount: number): Promise<{ success: boolean; newBalance: number; error?: string }> {
    const { data } = await db.rpc('deduct_flight_balance', {
        p_wallet: wallet,
        p_amount: amount,
    })
    if (!data?.success) return { success: false, newBalance: 0, error: data?.error ?? 'Insufficient balance' }
    return { success: true, newBalance: Number(data.new_balance) }
}

export async function creditBalance(wallet: string, amount: number): Promise<number> {
    await db.rpc('credit_flight_balance', { p_wallet: wallet, p_amount: amount })
    return getBalance(wallet)
}

// ── Session operations ─────────────────────────────────────────────────────────

export async function createSession(opts: {
    roundNumber: number
    serverSeed: string
    serverSeedHash: string
    crashPoint: number
}): Promise<string> {
    const { data, error } = await db
        .from('flight_sessions')
        .insert({
            round_number: opts.roundNumber,
            server_seed: opts.serverSeed,
            server_seed_hash: opts.serverSeedHash,
            crash_point: opts.crashPoint,
            status: 'waiting',
        })
        .select('id')
        .single()
    if (error) throw error
    return data.id
}

export async function markSessionRunning(sessionId: string): Promise<void> {
    await db
        .from('flight_sessions')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', sessionId)
}

export async function markSessionCrashed(sessionId: string): Promise<void> {
    await db
        .from('flight_sessions')
        .update({ status: 'crashed', crashed_at: new Date().toISOString() })
        .eq('id', sessionId)
}

export async function getLastRoundNumber(): Promise<number> {
    const { data } = await db
        .from('flight_sessions')
        .select('round_number')
        .order('round_number', { ascending: false })
        .limit(1)
        .maybeSingle()
    return data?.round_number ?? 0
}

// ── Bet log operations ─────────────────────────────────────────────────────────

export async function insertBetLog(sessionId: string, wallet: string, betAmount: number): Promise<string> {
    const { data, error } = await db
        .from('flight_game_logs')
        .insert({
            session_id: sessionId,
            wallet_address: wallet.toLowerCase(),
            bet_amount: betAmount,
            cashout_at: null,
            profit: null,
            xp_gained: 0,
        })
        .select('id')
        .single()
    if (error) throw error
    return data.id
}

export async function existingBetInSession(sessionId: string, wallet: string): Promise<boolean> {
    const { data } = await db
        .from('flight_game_logs')
        .select('id')
        .eq('session_id', sessionId)
        .ilike('wallet_address', wallet)
        .maybeSingle()
    return !!data
}

export async function updateBetCashout(logId: string, cashoutAt: number, profit: number, xpGained: number): Promise<void> {
    await db
        .from('flight_game_logs')
        .update({ cashout_at: cashoutAt, profit, xp_gained: xpGained })
        .eq('id', logId)
}

export async function updateBetLost(logId: string, xpGained: number): Promise<void> {
    await db
        .from('flight_game_logs')
        .update({ cashout_at: null, profit: null, xp_gained: xpGained })
        .eq('id', logId)
}

// ── Vault liquidity (used by placeBet to bound max bet) ──────────────────────

/**
 * Returns the vault's APE liquidity used by the gameLoop to size the max
 * allowed bet so a single big-multiplier win can't drain the bank.
 *
 * Source-of-truth strategy:
 *   1. If `VAULT_WALLET_ADDRESS` is set → read the on-chain APE balance of
 *      that wallet. This handles operator seed-deposits sent directly to
 *      the vault (which never appear in the DB ledger).
 *   2. Otherwise fall back to the legacy DB sum via `get_vault_net_balance`.
 *
 * Returns 0 if both paths fail (fail-closed: no liquidity → no bets).
 */
export async function getVaultLiquidity(): Promise<number> {
    if (VAULT_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(VAULT_ADDRESS)) {
        try {
            const wei = await apeProvider.getBalance(VAULT_ADDRESS)
            const ape = parseFloat(formatEther(wei))
            if (Number.isFinite(ape) && ape >= 0) return ape
        } catch (e: any) {
            console.warn('[vault] on-chain balance read failed, falling back to RPC:', e?.message ?? e)
        }
    }
    try {
        const { data, error } = await db.rpc('get_vault_net_balance')
        if (error || data == null) return 0
        return Number(data) || 0
    } catch {
        return 0
    }
}

// ── XP & Season 2 ──────────────────────────────────────────────────────────────

export async function awardXp(wallet: string, xpGained: number): Promise<void> {
    const w = wallet.toLowerCase()

    // Global lifetime XP (atomic).
    await db.rpc('increment_user_xp', { p_wallet: w, p_xp: xpGained })

    // Season 2 — XP + flights_played counter in one RPC call. The legacy
    // increment_season2_xp(p_wallet, p_xp) only bumps season_xp and never
    // touched flights_played, which is why the leaderboard showed Cards
    // numbers but always 0 flights regardless of how many rounds the
    // player ran. increment_season2_play knows the game type.
    await db.rpc('increment_season2_play', {
        p_wallet: w, p_xp: xpGained, p_game_type: 'flight',
    })
}

// ── Quest Progress ─────────────────────────────────────────────────────────────

export async function updateQuestProgress(wallet: string, multiplier: number): Promise<void> {
    const w = wallet.toLowerCase()
    try {
        await db.rpc('update_quest_progress', {
            p_wallet: w,
            p_game_type: 'flight',
            p_multiplier: multiplier,
        })
        // Update referral progress (non-critical)
        await db.rpc('update_referral_progress', {
            p_invitee_wallet: w,
            p_game_type: 'flight',
            p_is_holder: false,
        })
    } catch (e: any) {
        // Non-fatal: quest progress failure should never block gameplay
        console.warn('[QuestProgress] Flight update failed:', e.message)
    }
}
