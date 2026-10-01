import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/survival/clans/pfp/[slug] — the clan's collection image, fetched from where
 * OpenSea keeps it and handed on from our origin: the game's loader needs same-origin
 * (or CORS) images, and seadn's headers are not ours to rely on. Cached a day.
 */
export const dynamic = 'force-dynamic'

/** Logos this instance has fetched (12 clubs, small images): a query string no longer reaches seadn. */
const memo = new Map<string, { buf: ArrayBuffer; type: string; until: number }>()
const MEMO_MS = 60 * 60 * 1000
const MAX_BYTES = 2_000_000
const HEADERS = { 'cache-control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800' }

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
    const { slug } = await ctx.params
    if (!supabaseAdmin || !/^[a-z0-9-]{1,64}$/.test(slug)) return new NextResponse(null, { status: 404 })
    // One URL per logo: `?r=…` used to go past the day's edge cache to the database and seadn.
    if (req.nextUrl.search) {
        const clean = req.nextUrl.clone()
        clean.search = ''
        return NextResponse.redirect(clean, 308)
    }
    const hit = memo.get(slug)
    if (hit && hit.until > Date.now()) return new NextResponse(hit.buf, { headers: { 'content-type': hit.type, ...HEADERS } })
    const { data } = await supabaseAdmin.from('survival_clans').select('image_url').eq('slug', slug).maybeSingle()
    const url = (data as { image_url: string | null } | null)?.image_url
    if (!url || !/^https:\/\/(i2c|i)\.seadn\.io\//.test(url)) return new NextResponse(null, { status: 404 })
    try {
        // seadn negotiates AVIF for anything but an exact classic type — ask for the
        // format the stored URL itself carries, so the game's <img>-based loader gets
        // a PNG/JPEG/GIF/WebP it can count on everywhere.
        const ext = (url.split('?')[0].split('.').pop() ?? 'png').toLowerCase()
        const accept = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png'
        const r = await fetch(url, { headers: { accept }, cache: 'no-store', signal: AbortSignal.timeout(5000) })
        if (!r.ok || Number(r.headers.get('content-length') ?? 0) > MAX_BYTES) return new NextResponse(null, { status: 404 })
        const buf = await r.arrayBuffer()
        if (buf.byteLength > MAX_BYTES) return new NextResponse(null, { status: 404 })
        const type = r.headers.get('content-type') ?? 'image/png'
        memo.set(slug, { buf, type, until: Date.now() + MEMO_MS })
        return new NextResponse(buf, { headers: { 'content-type': type, ...HEADERS } })
    } catch {
        return new NextResponse(null, { status: 502 })
    }
}
