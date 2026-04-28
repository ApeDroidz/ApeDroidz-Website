import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createThirdwebClient, defineChain, getContract } from 'thirdweb'
import { balanceOf } from 'thirdweb/extensions/erc721'
import { requireWalletAuth } from '@/lib/walletAuth'

const thirdwebClient = createThirdwebClient({ clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID! })
const apeChain = defineChain(33139)
const DROID_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ''

/**
 * Server-side holder check. Never trust the client's `isHolder` flag.
 * Falls back to the DB snapshot in `users.droids_count` if the on-chain RPC
 * call fails. Must NEVER return `true` on error — fail closed.
 */
async function checkIsHolder(wallet: string): Promise<boolean> {
    try {
        const contract = getContract({ client: thirdwebClient, chain: apeChain, address: DROID_CONTRACT_ADDRESS })
        const bal = await balanceOf({ contract, owner: wallet })
        return bal > BigInt(0)
    } catch (e) {
        try {
            const { data } = await supabaseAdmin
                .from('users')
                .select('droids_count')
                .ilike('wallet_address', wallet)
                .maybeSingle()
            return (data?.droids_count ?? 0) > 0
        } catch {
            return false
        }
    }
}

/**
 * POST /api/glitch_games/quest/claim
 * Body: { questId, periodKey }   (wallet from session, isHolder verified server-side)
 */
export async function POST(req: NextRequest) {
    const auth = requireWalletAuth(req)
    if (auth instanceof Response) return auth
    const wallet = auth.wallet

    let body: any
    try { body = await req.json() }
    catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    const { questId, periodKey } = body ?? {}

    if (typeof questId !== 'string' || questId.length === 0 || questId.length > 64) {
        return NextResponse.json({ error: 'Quest ID required' }, { status: 400 })
    }
    if (typeof periodKey !== 'string' || periodKey.length === 0 || periodKey.length > 32) {
        return NextResponse.json({ error: 'Period key required' }, { status: 400 })
    }

    const isHolder = await checkIsHolder(wallet)

    try {
        const { data, error } = await supabaseAdmin.rpc('claim_quest_reward', {
            p_wallet: wallet,
            p_quest_id: questId,
            p_period_key: periodKey,
            p_is_holder: isHolder,
        })

        if (error) throw error

        if (!data?.success) {
            return NextResponse.json({ error: data?.error || 'Claim failed' }, { status: 400 })
        }

        return NextResponse.json({
            success: true,
            xp_gained: data.xp_gained ?? 0,
            tickets_gained: data.tickets_gained ?? 0,
            new_s2_xp: data.new_s2_xp ?? 0,
        })

    } catch (err: any) {
        console.error('[QuestClaim] Error:', err.message)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

/**
 * PATCH /api/glitch_games/quest/streak-claim
 * No body required (wallet from session, isHolder verified server-side).
 */
export async function PATCH(req: NextRequest) {
    const auth = requireWalletAuth(req)
    if (auth instanceof Response) return auth
    const wallet = auth.wallet

    const isHolder = await checkIsHolder(wallet)

    try {
        const { data, error } = await supabaseAdmin.rpc('claim_streak_reward', {
            p_wallet: wallet,
            p_is_holder: isHolder,
        })

        if (error) throw error

        if (!data?.success) {
            return NextResponse.json({ error: data?.error || 'Claim failed' }, { status: 400 })
        }

        return NextResponse.json({
            success: true,
            streak_day: data.streak_day,
            xp_gained: data.xp_gained ?? 0,
            tickets_gained: data.tickets_gained ?? 0,
            ape_gained: data.ape_gained ?? 0,
        })

    } catch (err: any) {
        console.error('[StreakClaim] Error:', err.message)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
