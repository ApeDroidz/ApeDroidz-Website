import { NextResponse } from 'next/server'
import { getLivePoolApe, renderPoolBoard } from '@/lib/arcade'

/**
 * GET /api/otherside/arcade-pool.png?p=<sum> — the cabinet's prize-pool LED board with the live sum.
 * `p` only busts caches (the MML puts the current sum there); the picture is always drawn from the
 * live pool. Edge-cached a minute: every cabinet in every world asks, nobody needs it to the second.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
    const png = await renderPoolBoard(await getLivePoolApe())
    return new NextResponse(new Uint8Array(png), {
        headers: {
            'Content-Type': 'image/png',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=120',
        },
    })
}
