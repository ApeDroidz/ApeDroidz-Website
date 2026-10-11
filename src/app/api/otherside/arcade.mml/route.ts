import { NextResponse } from 'next/server'
import { buildArcadeMml, getArcadeSettings, getLivePoolApe, getRunPrice } from '@/lib/arcade'

/**
 * GET /api/otherside/arcade.mml — the Droidz Survival arcade cabinet for Otherside (static MML).
 * Rebuilt per request: the board and price image URLs carry the live pool sum and run price, the screen plays the video
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
    const [pool, settings, price] = await Promise.all([getLivePoolApe(), getArcadeSettings(), getRunPrice()])
    return new NextResponse(buildArcadeMml(pool, settings, price), { headers })
}
