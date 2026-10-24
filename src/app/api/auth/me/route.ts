import { NextRequest, NextResponse } from 'next/server'
import { readSessionFromRequest } from '@/lib/walletAuth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/me
 * Returns the currently-authenticated wallet, or { authenticated: false, now: Date.now() }.
 * No body, no caching.
 */
export async function GET(req: NextRequest) {
    const session = readSessionFromRequest(req)
    if (!session) {
        return NextResponse.json({ authenticated: false, now: Date.now() }, { headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json(
        { authenticated: true, wallet: session.wallet, exp: session.exp, now: Date.now() },
        { headers: { 'Cache-Control': 'no-store' } },
    )
}
