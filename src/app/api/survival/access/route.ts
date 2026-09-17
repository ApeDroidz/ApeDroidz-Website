import { NextRequest, NextResponse } from 'next/server'
import { readSessionFromRequest } from '@/lib/walletAuth'
import { supabaseAdmin } from '@/lib/supabase'
import { createPlayToken, PLAY_COOKIE_NAME, PLAY_COOKIE_OPTIONS } from '@/lib/survivalAccess'

/**
 * GET /api/survival/access
 *
 * Answers the beta gate for the wallet in the signed session — never for a wallet named in the
 * query string, which is the whole point: a connected wallet is a claim, a signed session is
 * proof. On success it also mints the `survival_play` cookie that lets the middleware serve
 * /droidz_survival/play without another database round trip.
 *
 * Reply shapes, all HTTP 200 so the page can render a state rather than an error:
 *   { state: 'unverified' }              — connected but no signature yet
 *   { state: 'denied',  wallet }         — verified, not on the list
 *   { state: 'allowed', wallet }         — verified and on the list; play cookie set
 */
export async function GET(req: NextRequest) {
    const session = readSessionFromRequest(req)
    if (!session) {
        return NextResponse.json({ state: 'unverified' }, { headers: { 'cache-control': 'no-store' } })
    }

    if (!supabaseAdmin) {
        console.error('[survival/access] service role key missing')
        return NextResponse.json({ error: 'Service misconfigured' }, { status: 503 })
    }

    const { data, error } = await supabaseAdmin.rpc('survival_has_access', { p_wallet: session.wallet })
    if (error) {
        console.error('[survival/access]', error.message)
        return NextResponse.json({ error: 'Access check failed' }, { status: 502 })
    }

    if (data !== true) {
        // Fail closed and clear any play cookie left from an earlier session, so revoking access
        // in the table actually locks someone out on their next page load.
        const res = NextResponse.json(
            { state: 'denied', wallet: session.wallet },
            { headers: { 'cache-control': 'no-store' } },
        )
        res.cookies.set(PLAY_COOKIE_NAME, '', { ...PLAY_COOKIE_OPTIONS, maxAge: 0 })
        return res
    }

    const token = await createPlayToken(session.wallet)
    if (!token) {
        console.error('[survival/access] WALLET_SESSION_SECRET not configured')
        return NextResponse.json({ error: 'Service misconfigured' }, { status: 503 })
    }

    const res = NextResponse.json(
        { state: 'allowed', wallet: session.wallet },
        { headers: { 'cache-control': 'no-store' } },
    )
    res.cookies.set(PLAY_COOKIE_NAME, token, PLAY_COOKIE_OPTIONS)
    return res
}
