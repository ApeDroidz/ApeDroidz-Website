import { NextResponse } from 'next/server'
import { getContract } from 'thirdweb'
import { ownerOf } from 'thirdweb/extensions/erc721'
import { supabaseAdmin } from '@/lib/supabase'
import { requireWalletAuth } from '@/lib/walletAuth'
import { apeChainServer, createServerThirdwebClient } from '@/lib/apechain'
import { writeUserRow } from '@/lib/userNftProgress'

export const dynamic = 'force-dynamic'

const DROID_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_DROID_CONTRACT_ADDRESS || ''
const USERNAME_REGEX = /^[A-Za-z0-9_ .-]{1,24}$/

/**
 * POST /api/user/profile
 * Body: { username?: string, pfp?: number }   (кошелёк — из куки сессии)
 *
 * Раньше profile-modal писал username и PFP прямо в `users` анонимным ключом
 * по ilike(wallet_address) — без подписи, то есть любому кошельку. Теперь:
 *  - username: trim, 1–24 символа из [A-Za-z0-9_ .-];
 *  - pfp: id дроида, которым кошелёк владеет (ownerOf, при сбое RPC — отказ).
 */
export async function POST(req: Request) {
    const auth = requireWalletAuth(req)
    if (auth instanceof Response) return auth
    const wallet = auth.wallet

    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
    }

    let body: any
    try { body = await req.json() }
    catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    const patch: Record<string, unknown> = {}

    if (body?.username !== undefined) {
        const name = typeof body.username === 'string' ? body.username.trim().replace(/\s+/g, ' ') : ''
        if (!USERNAME_REGEX.test(name)) {
            return NextResponse.json(
                { error: 'Name: 1–24 characters, letters, digits, space, _ . - only' },
                { status: 400 },
            )
        }
        patch.username = name
    }

    if (body?.pfp !== undefined) {
        const tokenId = typeof body.pfp === 'number' ? body.pfp : Number(String(body.pfp))
        if (!Number.isSafeInteger(tokenId) || tokenId < 0) {
            return NextResponse.json({ error: 'Invalid PFP token' }, { status: 400 })
        }
        if (!DROID_CONTRACT_ADDRESS) {
            return NextResponse.json({ error: 'Contract not configured' }, { status: 500 })
        }
        let owner = ''
        try {
            const contract = getContract({
                client: createServerThirdwebClient(),
                chain: apeChainServer,
                address: DROID_CONTRACT_ADDRESS,
            })
            owner = await ownerOf({ contract, tokenId: BigInt(tokenId) })
        } catch (e: any) {
            console.error('[user/profile] ownerOf failed:', e?.message)
            return NextResponse.json({ error: 'Ownership check failed, try again' }, { status: 502 })
        }
        if (!owner || owner.toLowerCase() !== wallet) {
            return NextResponse.json({ error: 'You do not own this droid' }, { status: 403 })
        }
        patch.PFP = tokenId
    }

    if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    try {
        await writeUserRow(wallet, { ...patch, updated_at: new Date().toISOString() })
    } catch (e: any) {
        console.error('[user/profile] write failed:', e?.message)
        return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, ...patch })
}
