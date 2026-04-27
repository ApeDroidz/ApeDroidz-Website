import { NextResponse } from 'next/server'
import {
    ADMIN_COOKIE_NAME,
    ADMIN_COOKIE_MAX_AGE,
    createAdminToken,
    verifyAdminCredentials,
} from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/login
 * Body: { username, password }
 *
 * Issues an httpOnly, signed cookie that lets the maintenance gate pass through.
 * Credentials are checked against ADMIN_USERNAME / ADMIN_PASSWORD env vars
 * with a constant-time compare.
 */
export async function POST(req: Request) {
    let body: any
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { username, password } = body ?? {}

    // Reject early on missing fields without revealing which one is bad.
    if (typeof username !== 'string' || typeof password !== 'string' ||
        username.length === 0 || password.length === 0 ||
        username.length > 128 || password.length > 256) {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 400 })
    }

    if (!verifyAdminCredentials(username, password)) {
        // Subtle delay to slow brute-force attempts.
        await new Promise(r => setTimeout(r, 400))
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = await createAdminToken()
    if (!token) {
        // Secret missing — refuse rather than mint an unsigned cookie.
        console.error('[admin/login] WALLET_SESSION_SECRET / ADMIN_SESSION_SECRET missing')
        return NextResponse.json({ error: 'Server misconfigured (missing session secret)' }, { status: 503 })
    }

    const res = NextResponse.json({ ok: true })
    res.cookies.set(ADMIN_COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: ADMIN_COOKIE_MAX_AGE,
    })
    return res
}
