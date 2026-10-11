import { NextResponse } from 'next/server'
import { getRunPrice, renderPriceStrip } from '@/lib/arcade'

/**
 * GET /api/otherside/arcade-price.png?p=<price>-<sale> — the cabinet's «1 RUN = N APE» strip, live from
 * the catalog (owner, 12.10.2026: a run costs 2 APE now; the strip follows the price and its sales).
 * `p` only busts caches; the picture is always drawn from the current price.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
    const png = await renderPriceStrip(await getRunPrice())
    return new NextResponse(new Uint8Array(png), {
        headers: {
            'Content-Type': 'image/png',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=120',
        },
    })
}
