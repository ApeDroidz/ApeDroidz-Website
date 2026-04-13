import { requireInternalSecret } from '@/lib/requireInternalSecret'
import { NextResponse } from 'next/server'

/**
 * POST /api/flight/session/complete — DEPRECATED
 *
 * Session completion (marking crashed, awarding loser XP) is now handled
 * entirely inside the game-server process via gameLoop.doCrash().
 * This REST endpoint is disabled.
 */
export async function POST(req: Request) {
    const denied = requireInternalSecret(req)
    if (denied) return denied

    return NextResponse.json(
        { error: 'This endpoint is no longer in use' },
        { status: 410 }
    )
}
