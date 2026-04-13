import { NextResponse } from 'next/server'

/**
 * POST /api/flight/session/start — DEPRECATED
 *
 * This endpoint was used in a previous REST-based architecture.
 * The game now runs entirely over WebSocket (game-server).
 * Disabled to eliminate attack surface.
 */
export async function POST() {
    return NextResponse.json(
        { error: 'This endpoint is no longer in use' },
        { status: 410 }
    )
}
