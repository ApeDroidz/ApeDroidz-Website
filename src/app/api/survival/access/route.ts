import { NextRequest, NextResponse } from 'next/server'
import { readSessionFromRequest } from '@/lib/walletAuth'
import { supabaseAdmin } from '@/lib/supabase'
import { accessFor } from '@/lib/survivalAllow'
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

    // One rule for both doors (lib/survivalAllow.ts): the beta list — timed access caps the play
    // cookie, so the gate closes on the minute — or everyone with SURVIVAL_PUBLIC=1.
    const access = await accessFor(session.wallet)
    if (access.error) {
        console.error('[survival/access]', access.error)
        return NextResponse.json({ error: 'Access check failed' }, { status: 502 })
    }
    const until = access.until
    if (!access.allowed) {
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
