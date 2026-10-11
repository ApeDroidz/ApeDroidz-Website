import { NextResponse } from 'next/server'
import { buildArcadeMml, getArcadeSettings, getLivePoolApe } from '@/lib/arcade'

/**
 * GET /api/otherside/arcade.mml — the Droidz Survival arcade cabinet for Otherside (static MML).
 * Rebuilt per request: the board image URL carries the live pool sum, the screen plays the video
 * set in the admin panel. Same no-store headers as the avatar MML (api/mml/[id]) so Otherside
 * always gets the current document.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'CDN-Cache-Control': 'no-store',
    'Vercel-CDN-Cache-Control': 'no-store',
}

export function OPTIONS() {
    return new NextResponse(null, { status: 204, headers })
}

export async function GET() {
    const [pool, settings] = await Promise.all([getLivePoolApe(), getArcadeSettings()])
    return new NextResponse(buildArcadeMml(pool, settings), { headers })
}
