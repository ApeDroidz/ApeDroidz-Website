import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createThirdwebClient, defineChain, getContract } from 'thirdweb'
import { ownerOf } from 'thirdweb/extensions/erc721'
import { requireWalletAuth } from '@/lib/walletAuth'
import { refreshOpenseaNft } from '@/lib/openseaRefresh'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const apeChain = defineChain(33139)
const thirdwebClient = createThirdwebClient({
    clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
    secretKey: process.env.THIRDWEB_SECRET_KEY,
})

const DROID_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ''

const UNLOCKED_VIEWS = ['pixel', 'animated'] as const
const LOCKED_VIEWS = ['pfp3d', 'fullbody'] as const

/**
 * POST /api/display-pref
 *
 * Saves the holder's default view for the marketplace previewer.
 * Body: { tokenId: number, view: 'pixel' | 'animated' | 'pfp3d' | 'fullbody' }
 *
 * Gating:
 *  - 'pixel'    → any level
 *  - 'animated' → level 2+ only (level 1 sees an Upgrade CTA instead)
 *  - 'pfp3d' / 'fullbody' → rejected until 3D assets ship
 *
 * Auth: wallet session cookie; ownership verified on-chain.
 */
export async function POST(req: Request) {
    const auth = requireWalletAuth(req)
    if (auth instanceof Response) return auth
    const wallet = auth.wallet

    let body: any
    try { body = await req.json() }
    catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    const tokenId = parseInt(body?.tokenId)
    const view = String(body?.view || '')

    if (isNaN(tokenId) || tokenId < 0) {
        return NextResponse.json({ error: 'Invalid tokenId' }, { status: 400 })
    }
    if ((LOCKED_VIEWS as readonly string[]).includes(view)) {
        return NextResponse.json({ error: 'This view is not unlocked yet' }, { status: 403 })
    }
    if (!(UNLOCKED_VIEWS as readonly string[]).includes(view)) {
        return NextResponse.json({ error: 'Invalid view' }, { status: 400 })
    }

    try {
        // Ownership check — fail closed on RPC errors.
        if (!DROID_CONTRACT_ADDRESS) {
            return NextResponse.json({ error: 'Contract not configured' }, { status: 500 })
        }
        let owner = ''
        try {
            const contract = getContract({ client: thirdwebClient, chain: apeChain, address: DROID_CONTRACT_ADDRESS })
            owner = await ownerOf({ contract, tokenId: BigInt(tokenId) })
        } catch (e: any) {
            console.error('[display-pref] ownerOf failed:', e.message)
            return NextResponse.json({ error: 'Ownership check failed, try again' }, { status: 502 })
        }
        if (!owner || owner.toLowerCase() !== wallet.toLowerCase()) {
            return NextResponse.json({ error: 'You do not own this droid' }, { status: 403 })
        }

        // Level gating — the DB is the source of truth for level.
        const { data: droid, error: fetchError } = await supabase
            .from('droidz')
            .select('token_id, level, is_super')
            .eq('token_id', tokenId)
            .maybeSingle()

        if (fetchError || !droid) {
            return NextResponse.json({ error: 'Droid not found' }, { status: 404 })
        }

        const level = droid.level || 1
        if (view === 'animated' && level < 2) {
            return NextResponse.json(
                { error: 'Animated view unlocks at Level 2 — upgrade your droid first', needsUpgrade: true },
                { status: 403 },
            )
        }

        const { error: updateError } = await supabase
            .from('droidz')
            .update({ display_pref: view, display_pref_updated_at: new Date().toISOString() })
            .eq('token_id', tokenId)

        if (updateError) {
            console.error('[display-pref] update failed:', updateError)
            const hint = updateError.message?.includes('display_pref')
                ? 'display_pref column missing — run supabase/migrations/20260724_display_pref.sql'
                : 'Database update failed'
            return NextResponse.json({ error: hint }, { status: 500 })
        }

        // Nudge OpenSea to re-pull metadata so the new default shows up sooner.
        // Fire-and-forget — marketplace lag must not fail the save.
        refreshOpenseaNft({ contract: DROID_CONTRACT_ADDRESS, tokenId })
            .catch((e) => console.error('[display-pref] opensea refresh failed:', e))

        console.log(`✅ [display-pref] wallet=${wallet.slice(0, 8)} droid=${tokenId} view=${view}`)
        return NextResponse.json({ ok: true, tokenId, view })
    } catch (err: any) {
        console.error('[display-pref] error:', err)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
