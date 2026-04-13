import { requireInternalSecret } from '@/lib/requireInternalSecret'
import { NextResponse } from 'next/server'

/**
 * POST /api/flight/session/cashout — DEPRECATED
 *
 * Cashouts are now handled atomically inside the game-server process via
 * gameLoop.cashout() → creditBalance() → updateBetCashout().
 * This REST endpoint is disabled to eliminate the double-payout TOCTOU attack surface.
 */
export async function POST(req: Request) {
    const denied = requireInternalSecret(req)
    if (denied) return denied

    return NextResponse.json(
        { error: 'This endpoint is no longer in use' },
        { status: 410 }
    )
}
