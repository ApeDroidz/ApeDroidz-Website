import { NextResponse } from 'next/server'
import { ADMIN_COOKIE_NAME } from '@/lib/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/logout
 * Clears the admin cookie. The next page request will be rewritten to
 * /coming-soon by the middleware.
 *
 * The admin token is stateless, so this only drops it from this browser; a
 * copied cookie stays valid until it expires (12 h). To revoke every admin
 * session at once, change ADMIN_SESSION_VERSION in Vercel and redeploy
 * (see src/lib/adminAuth.ts).
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
    res.headers.set('cache-control', 'no-store')
    return res
}
