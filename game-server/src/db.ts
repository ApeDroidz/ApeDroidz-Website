import { createClient } from '@supabase/supabase-js'

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

export const db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
)

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

// ── XP & Season 2 ──────────────────────────────────────────────────────────────

export async function awardXp(wallet: string, xpGained: number): Promise<void> {
    const w = wallet.toLowerCase()

    // Atomic increment — avoids TOCTOU from concurrent read-then-write
    await db.rpc('increment_user_xp', { p_wallet: w, p_xp: xpGained })

    // Season 2 — upsert with atomic increment via stored proc
    await db.rpc('increment_season2_xp', { p_wallet: w, p_xp: xpGained })
}
