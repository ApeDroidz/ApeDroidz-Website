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
 *   { state: 'allowed', wallet, until } — verified and on the list; play cookie set.
 *                                          `until` is the access expiry (ISO) or null = no expiry
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

    // The row, not just survival_has_access(): a timed beta (expires_at) has to cap the play
    // cookie, so the gate closes when the time is up rather than up to PLAY_TTL later.
    // Same rule as the function — on the list, not revoked, not expired.
    const { data: row, error } = await supabaseAdmin.from('survival_allowlist')
        .select('revoked_at, expires_at').eq('wallet', session.wallet.toLowerCase()).maybeSingle()
    if (error) {
        console.error('[survival/access]', error.message)
        return NextResponse.json({ error: 'Access check failed' }, { status: 502 })
    }
    const until = row?.expires_at ? new Date(row.expires_at as string) : null
    const allowed = !!row && !row.revoked_at && (!until || until.getTime() > Date.now())

    if (!allowed) {
        // Fail closed and clear any play cookie left from an earlier session, so revoking access
        // in the table actually locks someone out on their next page load.
        const res = NextResponse.json(
            { state: 'denied', wallet: session.wallet },
            { headers: { 'cache-control': 'no-store' } },
        )
        res.cookies.set(PLAY_COOKIE_NAME, '', { ...PLAY_COOKIE_OPTIONS, maxAge: 0 })
        return res
    }

    const token = await createPlayToken(session.wallet, until)
    if (!token) {
        console.error('[survival/access] WALLET_SESSION_SECRET not configured')
        return NextResponse.json({ error: 'Service misconfigured' }, { status: 503 })
    }

    const res = NextResponse.json(
        { state: 'allowed', wallet: session.wallet, until: until ? until.toISOString() : null },
        { headers: { 'cache-control': 'no-store' } },
    )
    res.cookies.set(PLAY_COOKIE_NAME, token, PLAY_COOKIE_OPTIONS)
    return res
}
