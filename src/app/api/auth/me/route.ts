import { NextRequest, NextResponse } from 'next/server'
import { readSessionFromRequest } from '@/lib/walletAuth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/me
 * Returns the currently-authenticated wallet, or { authenticated: false }.
 * No body, no caching.
 */
export async function GET(req: NextRequest) {
    const session = readSessionFromRequest(req)
    if (!session) {
        return NextResponse.json({ authenticated: false }, { headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json(
        { authenticated: true, wallet: session.wallet, exp: session.exp },
        { headers: { 'Cache-Control': 'no-store' } },
    )
}
