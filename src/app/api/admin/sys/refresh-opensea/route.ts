import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/adminAuth'
import { refreshOpenseaNft } from '@/lib/openseaRefresh'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DROID_CONTRACT = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ''
const HONORARY_CONTRACT = '0x427ff4b908c4ba7bc1d689bacac280a0435b2514'

/**
 * POST /api/admin/sys/refresh-opensea
 *
 * Bulk OpenSea metadata refresh. Use after deploying changes that affect
 * metadata (image format, traits, previewer) to flush their cache for NFTs that
 * were indexed before the change.
 *
 * Body (all optional):
 *   collection : 'droidz' (default) | 'honorary'
 *   tokenIds   : explicit list — overrides the collection-wide selection
 *   minLevel   : droidz only, refresh level >= this (default 2)
 *   delayMs    : pause between calls (default 1500)
 *   budgetMs   : stop and report progress before the platform kills the
 *                function (default 45000)
 *
 * A full collection cannot finish inside one serverless invocation, so the
 * route is resumable: it works through the list until the time budget runs out,
 * then returns `remaining` — call again with that list to continue.
 */
export async function POST(req: NextRequest) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    if (!process.env.OPENSEA_API_KEY) {
        return NextResponse.json({ error: 'OPENSEA_API_KEY not configured' }, { status: 500 })
    }

    let body: any = {}
    try { body = await req.json() } catch { /* allow empty body */ }

    const collection = body?.collection === 'honorary' ? 'honorary' : 'droidz'
    const contract = collection === 'honorary' ? HONORARY_CONTRACT : DROID_CONTRACT
    if (!contract) {
        return NextResponse.json({ error: 'Contract not configured' }, { status: 500 })
    }

    const delayMs = Number.isFinite(body?.delayMs) ? Math.max(0, Number(body.delayMs)) : 1500
    const budgetMs = Number.isFinite(body?.budgetMs) ? Math.max(5000, Number(body.budgetMs)) : 45_000

    let tokenIds: number[] = []
    if (Array.isArray(body?.tokenIds)) {
        tokenIds = body.tokenIds
            .map((v: any) => Number(v))
            .filter((n: number) => Number.isInteger(n) && n >= 0)
    } else if (collection === 'honorary') {
        const { data, error } = await supabaseAdmin
            .from('honorary_droidz')
            .select('token_id')
            .order('token_id', { ascending: true })
        if (error) return NextResponse.json({ error: `DB query failed: ${error.message}` }, { status: 500 })
        tokenIds = (data ?? []).map((r: any) => Number(r.token_id))
    } else {
        const minLevel = Number.isFinite(body?.minLevel) ? Number(body.minLevel) : 2
        const { data, error } = await supabaseAdmin
            .from('droidz')
            .select('token_id')
            .gte('level', minLevel)
            .order('token_id', { ascending: true })
        if (error) return NextResponse.json({ error: `DB query failed: ${error.message}` }, { status: 500 })
        tokenIds = (data ?? []).map((r: any) => Number(r.token_id))
    }

    if (tokenIds.length === 0) {
        return NextResponse.json({ done: true, refreshed: 0, failed: 0, remaining: [] })
    }

    const startedAt = Date.now()
    const results: { tokenId: number; ok: boolean; status?: number; error?: string }[] = []
    let refreshed = 0
    let failed = 0
    let rateLimited = 0
    let i = 0

    for (; i < tokenIds.length; i++) {
        if (Date.now() - startedAt > budgetMs) break

        const tokenId = tokenIds[i]
        let r = await refreshOpenseaNft({ contract, tokenId })

        // One backoff retry on 429 — their write limit is tight and bursty.
        if (!r.ok && r.status === 429) {
            rateLimited++
            await new Promise(res => setTimeout(res, 6000))
            r = await refreshOpenseaNft({ contract, tokenId })
        }

        results.push({ tokenId, ok: r.ok, status: r.status, error: r.error })
        if (r.ok) refreshed++
        else failed++

        if (delayMs) await new Promise(res => setTimeout(res, delayMs))
    }

    const remaining = tokenIds.slice(i)
    return NextResponse.json({
        done: remaining.length === 0,
        collection,
        processed: results.length,
        refreshed,
        failed,
        rateLimited,
        remaining,
        elapsedMs: Date.now() - startedAt,
        results: results.filter(r => !r.ok).slice(0, 20),
    })
}
