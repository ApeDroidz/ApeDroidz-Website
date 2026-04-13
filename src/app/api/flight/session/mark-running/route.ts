import { requireInternalSecret } from '@/lib/requireInternalSecret'
import { NextResponse } from 'next/server'

/**
 * POST /api/flight/session/mark-running — DEPRECATED
 *
 * Session state transitions are now managed directly by the game-server
 * via Supabase client calls in db.ts (markSessionRunning).
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
