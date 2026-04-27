import { NextRequest, NextResponse } from 'next/server'
import {
    isValidWallet,
    isFreshNonce,
    loginMessage,
    verifyWalletSignature,
    createSessionToken,
    SESSION_COOKIE_OPTIONS,
} from '@/lib/walletAuth'

/**
 * POST /api/auth/login
 * Body: { wallet, nonce, signature }
 *
 * Verifies an EIP-191 signature and issues an httpOnly session cookie that
 * authenticates subsequent mutating endpoints.
 */
export async function POST(req: NextRequest) {
    let body: any
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    const { wallet, nonce, signature } = body ?? {}

    if (!isValidWallet(wallet)) {
        return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
    }
    if (!isFreshNonce(nonce)) {
        return NextResponse.json({ error: 'Invalid or expired nonce' }, { status: 400 })
    }
    if (typeof signature !== 'string' || signature.length === 0 || signature.length > 1024) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    const message = loginMessage(wallet, nonce)
    const ok = await verifyWalletSignature({ wallet, message, signature })
    if (!ok) {
        return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 })
    }

    let token: string
    let session
    try {
        ({ token, session } = createSessionToken(wallet))
    } catch (e: any) {
        // WALLET_SESSION_SECRET missing — fail closed
        console.error('[auth/login]', e.message)
        return NextResponse.json({ error: 'Service misconfigured' }, { status: 503 })
    }

    const res = NextResponse.json({ ok: true, wallet: session.wallet, exp: session.exp })
    res.cookies.set(SESSION_COOKIE_OPTIONS.name, token, {
        httpOnly: SESSION_COOKIE_OPTIONS.httpOnly,
        secure: SESSION_COOKIE_OPTIONS.secure,
        sameSite: SESSION_COOKIE_OPTIONS.sameSite,
        path: SESSION_COOKIE_OPTIONS.path,
        maxAge: SESSION_COOKIE_OPTIONS.maxAge,
    })
    return res
}
