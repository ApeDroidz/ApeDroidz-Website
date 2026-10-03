import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authCaller, noServer, readBody } from '@/lib/survivalRuns'
import { CONTRACT_RE, findOwnedNft, normTokenId, type Avatar } from '@/lib/survivalNfts'
import { ensurePlayer, NO_STORE } from '@/lib/survivalMe'

/**
 * POST /api/survival/me/avatar { contract, tokenId } — make one of the wallet's NFTs (ApeChain, any
 * collection) the player's avatar; { contract: null } takes it off.
 *
 *   → { ok: true, avatar: { contract, tokenId, name, image } } · { ok: true, avatar: null }
 *   → 400 { error: 'invalid' }    — not a contract address / token id
 *   → 403 { error: 'not_owner' }  — this wallet does not hold that token
 *   → 422 { error: 'no_image' }   — held, but no picture could be found for it
 *   → 503 { ok: false, state: 'no_server' } — neither the indexer nor the chain answered, or the database
 *
 * Ownership is checked here, on the server — Insight first, the chain (ownerOf / ERC-1155
 * balanceOf) when the token is not in the index yet. Name and picture are the indexer's, never the
 * body's. Checked when picked, not afterwards: an avatar sold later stays until changed (cosmetic,
 * like the clan; nothing that ranks or pays reads it).
 */
export const dynamic = 'force-dynamic'
// Insight answers in 0.3–18 s (lib/survivalNfts.ts): room for a slow page.
export const maxDuration = 30

export async function POST(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    if (!supabaseAdmin) return noServer()
    const wallet = caller.wallet
    const body = await readBody(req)

    let avatar: Avatar | null = null
    if (body.contract !== null) {
        const contract = typeof body.contract === 'string' ? body.contract.trim().toLowerCase() : ''
        const tokenId = normTokenId(body.tokenId)
        if (!CONTRACT_RE.test(contract) || !tokenId) return NextResponse.json({ error: 'invalid' }, { status: 400, headers: NO_STORE })
        const found = await findOwnedNft(wallet, contract, tokenId)
        if (found === null) return noServer('me.avatar', 'indexer and chain did not answer')
        if (!found.owned) return NextResponse.json({ error: 'not_owner' }, { status: 403, headers: NO_STORE })
        if (!found.nft) return NextResponse.json({ error: 'no_image' }, { status: 422, headers: NO_STORE })
        avatar = { contract, tokenId, name: found.nft.name, image: found.nft.image }
    }

    if (!(await ensurePlayer(wallet))) return noServer('me.avatar', 'player row')
    const { error } = await supabaseAdmin.from('survival_players').update({ avatar }).eq('wallet', wallet)
    if (error) return noServer('me.avatar', error.message)
    return NextResponse.json({ ok: true, avatar }, { headers: NO_STORE })
}
