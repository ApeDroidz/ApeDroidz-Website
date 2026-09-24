import { NextRequest, NextResponse } from 'next/server'
import { createSessionToken, isFreshNonce, isValidWallet, readSessionFromRequest, SESSION_COOKIE_NAME, verifyWalletSignature } from '@/lib/walletAuth'
import { createPlayToken, PLAY_COOKIE_NAME, PLAY_PATH } from '@/lib/survivalAccess'
import { accessFor } from '@/lib/survivalAllow'
import { logEvent } from '@/lib/survivalLog'
import { othersideLoginMessage } from '@/lib/othersideMessage'

/**
 * Sign-in for the Otherside arcade cabinet (/otherside, framed by the Hub).
 *
 *   GET  /api/otherside/login                       → { state: 'unverified' } | { state: 'allowed'|'denied', wallet, until }
 *   POST /api/otherside/login { wallet, nonce, signature }   — the player signed `othersideLoginMessage`
 *                                                              with their Glyph wallet in the Hub dialog
 *   DELETE /api/otherside/login                     → sign out
 *
 * Why its own route: inside the Hub our pages are a third-party frame, and the site's cookies
 * (SameSite=Lax) are never sent there. These cookies are the same session and play tokens the
 * whole game already checks — only issued PARTITIONED (CHIPS: SameSite=None; Secure;
 * Partitioned). The browser keeps them in a jar keyed to otherside.xyz, apart from the site's
 * own, so nothing leaks between the two, and every existing route (profile, runs, pay) and the
 * beta gate on /droidz_survival/play read them unchanged. One game, one save, one board — the
 * wallet is the player on both doors. The in-game browser is Chromium, which supports CHIPS.
 */
export const dynamic = 'force-dynamic'

const noStore = { 'cache-control': 'no-store' }
const PARTITIONED = { httpOnly: true, secure: true, sameSite: 'none' as const, partitioned: true }
const SESSION_MAX_AGE = 7 * 24 * 60 * 60
const PLAY_MAX_AGE = 6 * 60 * 60

async function withAccess(wallet: string, res: (body: Record<string, unknown>) => NextResponse): Promise<NextResponse> {
    const access = await accessFor(wallet, { otherside: true })
    if (access.error) return NextResponse.json({ error: 'Access check failed' }, { status: 502, headers: noStore })
    if (!access.allowed) {
        const r = res({ state: 'denied', wallet })
        r.cookies.set(PLAY_COOKIE_NAME, '', { ...PARTITIONED, path: PLAY_PATH, maxAge: 0 })
        return r
    }
    const play = await createPlayToken(wallet, access.until)
    if (!play) return NextResponse.json({ error: 'Service misconfigured' }, { status: 503, headers: noStore })
    const r = res({ state: 'allowed', wallet, until: access.until ? access.until.toISOString() : null })
    const playAge = access.until ? Math.max(1, Math.min(PLAY_MAX_AGE, Math.floor((access.until.getTime() - Date.now()) / 1000))) : PLAY_MAX_AGE
    r.cookies.set(PLAY_COOKIE_NAME, play, { ...PARTITIONED, path: PLAY_PATH, maxAge: playAge })
    return r
}

export async function GET(req: NextRequest) {
    const session = readSessionFromRequest(req)
    if (!session) return NextResponse.json({ state: 'unverified' }, { headers: noStore })
    return withAccess(session.wallet, (body) => NextResponse.json(body, { headers: noStore }))
}

export async function POST(req: NextRequest) {
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: noStore }) }
    const wallet = typeof body.wallet === 'string' ? body.wallet.toLowerCase() : ''
    const { nonce, signature } = body
    if (!isValidWallet(wallet)) return NextResponse.json({ error: 'Invalid wallet' }, { status: 400, headers: noStore })
    if (!isFreshNonce(nonce)) return NextResponse.json({ error: 'Invalid or expired nonce' }, { status: 400, headers: noStore })
    if (typeof signature !== 'string' || signature.length === 0 || signature.length > 4096) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400, headers: noStore })
    }
    // EOA and smart-account (ERC-1271 / ERC-6492) signatures both verify here — a Glyph wallet
    // may be either.
    const ok = await verifyWalletSignature({ wallet, message: othersideLoginMessage(wallet, nonce as string), signature })
    if (!ok) return NextResponse.json({ error: 'Signature verification failed' }, { status: 401, headers: noStore })

    let token: string
    try { ({ token } = createSessionToken(wallet)) } catch (e) {
        console.error('[otherside/login]', (e as Error).message)
        return NextResponse.json({ error: 'Service misconfigured' }, { status: 503, headers: noStore })
    }
    logEvent({ level: 'info', kind: 'otherside.login', wallet, message: 'signed in from the Otherside cabinet' })
    return withAccess(wallet, (b) => {
        const r = NextResponse.json(b, { headers: noStore })
        r.cookies.set(SESSION_COOKIE_NAME, token, { ...PARTITIONED, path: '/', maxAge: SESSION_MAX_AGE })
        return r
    })
}

export async function DELETE() {
    const r = NextResponse.json({ ok: true }, { headers: noStore })
    r.cookies.set(SESSION_COOKIE_NAME, '', { ...PARTITIONED, path: '/', maxAge: 0 })
    r.cookies.set(PLAY_COOKIE_NAME, '', { ...PARTITIONED, path: PLAY_PATH, maxAge: 0 })
    return r
}
