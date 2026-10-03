import { NextRequest, NextResponse } from 'next/server'
import { authCaller } from '@/lib/survivalRuns'
import { listWalletNfts, MAX_NFTS } from '@/lib/survivalNfts'

/**
 * GET /api/survival/me/nfts — the signed-in wallet's NFTs on ApeChain, every collection, for the
 * profile's avatar picker (owner, 03.10.2026: «аватар — любая NFT из кошелька»).
 *
 *   → { nfts: [{ contract, tokenId, name, image, collection }], count }   — up to 200, ApeDroidz first
 *   → 502 { error: 'indexer', nfts: [] }                                   — Insight did not answer
 *
 * thirdweb Insight (lib/survivalNfts.ts), not RPC; tokens Insight has no picture for are left out.
 * Kept a minute per wallet on the instance, and `private, max-age=60` for the browser.
 */
export const dynamic = 'force-dynamic'
// Insight answers in 0.3–18 s (lib/survivalNfts.ts): room for a slow page.
export const maxDuration = 30

export async function GET(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    const nfts = await listWalletNfts(caller.wallet)
    if (nfts === null) return NextResponse.json({ error: 'indexer', nfts: [] }, { status: 502, headers: { 'cache-control': 'no-store' } })
    return NextResponse.json({ nfts: nfts.slice(0, MAX_NFTS), count: nfts.length }, { headers: { 'cache-control': 'private, max-age=60' } })
}
