import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { refreshOpenseaNft } from '@/lib/openseaRefresh'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DROID_CONTRACT = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ''

/**
 * GET /api/admin/sys/opensea-probe?tokenId=123
 *
 * Diagnostic — calls OpenSea /refresh for one token across the known
 * chain-slug variants and returns the raw HTTP status + body for each.
 * Use to figure out:
 *   - is OPENSEA_API_KEY present and accepted?
 *   - which chain slug does OpenSea use for ApeChain?
 *   - does the contract+tokenId combo even exist on OpenSea yet?
 *
 * No side effects worth worrying about — calling /refresh just nudges
 * OpenSea's indexer.
 */
export async function GET(req: NextRequest) {
    const denied = await requireAdmin(req)
    if (denied) return denied

    const tokenIdParam = req.nextUrl.searchParams.get('tokenId') ?? '1'
    const tokenId = parseInt(tokenIdParam, 10)
    if (!Number.isInteger(tokenId) || tokenId < 0) {
        return NextResponse.json({ error: 'Invalid tokenId' }, { status: 400 })
    }

    const env = {
        hasApiKey: !!process.env.OPENSEA_API_KEY,
        chainSlugEnv: process.env.OPENSEA_CHAIN_SLUG ?? null,
        droidContract: DROID_CONTRACT || null,
    }

    if (!env.hasApiKey) {
        return NextResponse.json({
            env,
            error: 'OPENSEA_API_KEY missing on this deployment. Set it in Vercel env and redeploy.',
        }, { status: 500 })
    }
    if (!DROID_CONTRACT) {
        return NextResponse.json({
            env,
            error: 'NEXT_PUBLIC_DROID_CONTRACT_ADDRESS missing.',
        }, { status: 500 })
    }

    // Probe every chain-slug variant we've ever seen for ApeChain. The
    // first 200/202 wins — that one is the live slug. 404 means the slug
    // is wrong; 401/403 means the API key is invalid.
    const variants = ['ape_chain', 'apechain', 'ape-chain']
    const results: any[] = []
    for (const chain of variants) {
        const r = await refreshOpenseaNft({ contract: DROID_CONTRACT, tokenId, chain })
        results.push({
            chain,
            ok: r.ok,
            status: r.status ?? null,
            url: r.url,
            body: r.body ?? null,
            error: r.error ?? null,
        })
        // Tiny gap between calls — keeps the rate limiter calm.
        await new Promise(res => setTimeout(res, 600))
    }

    const winner = results.find(r => r.ok)

    return NextResponse.json({
        env,
        tokenId,
        winner: winner ? winner.chain : null,
        recommendation: winner
            ? `Set OPENSEA_CHAIN_SLUG=${winner.chain} on Vercel (or leave default if it matches 'ape_chain'). Then run the bulk-refresh.`
            : 'No variant returned 2xx — check API key, contract address, or whether OpenSea has indexed this collection.',
        results,
    })
}
