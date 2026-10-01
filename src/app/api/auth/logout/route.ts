import { NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME } from '@/lib/walletAuth'
import { PLAY_COOKIE_NAME, PLAY_COOKIE_OPTIONS } from '@/lib/survivalAccess'

/**
 * POST /api/auth/logout
 * Clears the session cookie.
 */
export async function POST() {
    const res = NextResponse.json({ ok: true })
    res.cookies.set(SESSION_COOKIE_NAME, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
    })
    // The game's play cookie goes with the session: without it the build is not served to a
    // signed-out browser (the middleware), rather than loading and failing every call with 401.
    res.cookies.set(PLAY_COOKIE_NAME, '', { ...PLAY_COOKIE_OPTIONS, maxAge: 0 })
    return res
}
