import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isValidWallet, requireWalletAuth } from '@/lib/walletAuth'

export const dynamic = 'force-dynamic'

const REF_CODE_REGEX = /^[A-Z0-9_-]{4,32}$/

/**
 * GET /api/glitch_games/referral?wallet=0x...
 * Read-only stats. Wallet validated to prevent ilike wildcard abuse.
 */
export async function GET(req: NextRequest) {
    const wallet = req.nextUrl.searchParams.get('wallet')
    if (!wallet || !isValidWallet(wallet)) {
        return NextResponse.json({ error: 'Wallet required' }, { status: 400 })
    }
    const w = wallet.toLowerCase()

    try {
        const { data: refCode, error: codeErr } = await supabaseAdmin
            .rpc('get_or_create_ref_code', { p_wallet: w })

        if (codeErr) throw codeErr

        const { data: refs } = await supabaseAdmin
            .from('referrals')
            .select('invitee_wallet, invitee_cards_played, invitee_flights_played, xp_reward_paid, ticket_reward_paid, created_at')
            .ilike('inviter_wallet', w)
            .order('created_at', { ascending: false })

        const totalReferrals = refs?.length ?? 0
        const activeReferrals = refs?.filter((r: any) => (r.invitee_cards_played + r.invitee_flights_played) >= 3).length ?? 0
        const ticketsEarned = refs?.filter((r: any) => r.ticket_reward_paid).length ?? 0

        return NextResponse.json({
            refCode,
            refUrl: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://apedroidz.xyz'}/glitch_games?ref=${refCode}`,
            totalReferrals,
            activeReferrals,
            ticketsEarned,
            referrals: refs ?? [],
        })

    } catch (err: any) {
        console.error('[Referral GET] Error:', err.message)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

/**
 * POST /api/glitch_games/referral
 * Body: { refCode }      (inviteeWallet comes from session cookie)
 *
 * Auth: requires session. The invitee MUST be the authenticated wallet so an
 *       attacker cannot register fake referrals on someone else's behalf.
 *       Self-referral (inviter == invitee) is blocked here as a belt-and-suspenders
 *       check on top of any guard in the underlying RPC.
 */
export async function POST(req: NextRequest) {
    const auth = requireWalletAuth(req)
    if (auth instanceof Response) return auth
    const inviteeWallet = auth.wallet

    let body: any
    try { body = await req.json() }
    catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    const refCode = typeof body?.refCode === 'string' ? body.refCode.toUpperCase().trim() : ''
    if (!REF_CODE_REGEX.test(refCode)) {
        return NextResponse.json({ error: 'Invalid ref code' }, { status: 400 })
    }

    try {
        // ── Self-referral guard ────────────────────────────────────────────
        // Look up the inviter for this code; reject if it is the same wallet.
        const { data: inviterRow } = await supabaseAdmin
            .from('referrals')
            .select('inviter_wallet')
            .eq('ref_code', refCode)
            .limit(1)
            .maybeSingle()
            .then((r: any) => r, () => ({ data: null }))

        // Some schemas store ref codes on a separate table — fall back to RPC's
        // own check if the lookup fails. We do not return an error here on miss;
        // we let register_referral handle it.
        if (inviterRow?.inviter_wallet && String(inviterRow.inviter_wallet).toLowerCase() === inviteeWallet) {
            return NextResponse.json({ error: 'Cannot refer yourself' }, { status: 400 })
        }

        const { data, error } = await supabaseAdmin.rpc('register_referral', {
            p_invitee_wallet: inviteeWallet,
            p_ref_code: refCode,
        })

        if (error) throw error

        return NextResponse.json({ success: data?.success ?? false, error: data?.error })

    } catch (err: any) {
        console.error('[Referral POST] Error:', err.message)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
