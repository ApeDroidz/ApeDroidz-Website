import { NextResponse } from 'next/server'
import { ADMIN_COOKIE_NAME } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/logout
 * Clears the admin cookie. The next page request will be rewritten to
 * /coming-soon by the middleware.
 */
export async function POST() {
    const res = NextResponse.json({ ok: true })
    res.cookies.set(ADMIN_COOKIE_NAME, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
    })
    return res
}
