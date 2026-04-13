import { requireInternalSecret } from '@/lib/requireInternalSecret'
import { NextResponse } from 'next/server'

/**
 * POST /api/flight/session/place-bet — DEPRECATED
 *
 * Bets are now placed entirely over WebSocket via gameLoop.placeBet().
 * This REST endpoint is disabled to eliminate:
 *  - bets placed during 'running' phase (guaranteed wins)
 *  - missing max-bet enforcement (50 APE cap only enforced in gameLoop)
 */
export async function POST(req: Request) {
    const denied = requireInternalSecret(req)
    if (denied) return denied

    return NextResponse.json(
        { error: 'This endpoint is no longer in use' },
        { status: 410 }
    )
}
