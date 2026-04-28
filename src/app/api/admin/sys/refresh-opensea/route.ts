import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { refreshOpenseaNft } from '@/lib/openseaRefresh'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DROID_CONTRACT = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ''

/**
 * POST /api/admin/sys/refresh-opensea
 *
 * One-shot bulk refresh of OpenSea metadata for all level-2+ droids. Use after
 * deploying changes that affect metadata (image cache-bust, new traits, etc.)
 * to flush OpenSea's stale cache for already-upgraded NFTs that were cached
 * before the change went live.
 *
 * Body (optional):
 *   { tokenIds?: number[]; minLevel?: number }
 *   - tokenIds: explicit list to refresh (overrides minLevel)
 *   - minLevel: refresh all droids with level ≥ minLevel (default 2)
 *
 * OpenSea free-tier rate limit is roughly 5 writes/minute, so we throttle to
 * stay well under and report per-token results.
 */
export async function POST(req: NextRequest) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    if (!DROID_CONTRACT) {
        return NextResponse.json({ error: 'NEXT_PUBLIC_DROID_CONTRACT_ADDRESS not configured' }, { status: 500 })
    }
    if (!process.env.OPENSEA_API_KEY) {
        return NextResponse.json({ error: 'OPENSEA_API_KEY not configured' }, { status: 500 })
    }

    let body: any = {}
    try { body = await req.json() } catch { /* allow empty body */ }
    const minLevel = Number.isFinite(body?.minLevel) ? Number(body.minLevel) : 2

    let tokenIds: number[] = []
    if (Array.isArray(body?.tokenIds)) {
        tokenIds = body.tokenIds
            .map((v: any) => Number(v))
            .filter((n: number) => Number.isInteger(n) && n >= 0)
    } else {
        const { data, error } = await supabaseAdmin
            .from('droidz')
            .select('token_id')
            .gte('level', minLevel)
            .order('token_id', { ascending: true })
        if (error) {
            return NextResponse.json({ error: `DB query failed: ${error.message}` }, { status: 500 })
        }
        tokenIds = (data ?? []).map((r: any) => Number(r.token_id))
    }

    if (tokenIds.length === 0) {
        return NextResponse.json({ refreshed: 0, failed: 0, results: [] })
    }

    // OpenSea free tier: ~5 writes/min. Sleep ~13s between calls so a 30-NFT
    // batch finishes in under 7 minutes without tripping rate limits. We don't
    // run this inline if tokenIds is huge — start with a sane cap.
    const HARD_CAP = 500
    if (tokenIds.length > HARD_CAP) {
        return NextResponse.json({
            error: `Too many tokens (${tokenIds.length}). Cap is ${HARD_CAP} per call.`,
        }, { status: 400 })
    }

    const results: { tokenId: number; ok: boolean; error?: string }[] = []
    let refreshed = 0
    let failed = 0
    for (const tokenId of tokenIds) {
        const r = await refreshOpenseaNft({ contract: DROID_CONTRACT, tokenId })
        results.push({ tokenId, ok: r.ok, error: r.error })
        if (r.ok) refreshed++
        else failed++
        // Throttle — OpenSea's free tier writes are tight.
        await new Promise(res => setTimeout(res, 13_000))
    }

    return NextResponse.json({ refreshed, failed, total: tokenIds.length, results })
}
