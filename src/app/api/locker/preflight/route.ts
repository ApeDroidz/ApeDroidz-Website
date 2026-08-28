import { NextRequest, NextResponse } from 'next/server'
import { activeOperatorsFor, operatorLabel, DROID_CONTRACT } from '@/lib/locker'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const headers = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

/**
 * GET /api/locker/preflight?owner=0x...
 *
 * Lists the marketplace operators this wallet still has approved on the droid collection. While
 * any of them is approved, a listing signed earlier can still be sitting live on some marketplace.
 *
 * Why approvals rather than marketplace APIs: a listing is an off-chain order, and there is no
 * single place to ask about all of them. But every protocol — Seaport, PaymentProcessor, whatever
 * OSWiki settles through, anything built next year — needs an ERC-721 approval before it can move
 * a droid. Revoking that kills the order regardless of which orderbook it lives in, and the check
 * is a plain on-chain read, so it stays honest and needs no API keys.
 *
 * This is hygiene, not enforcement: a locked droid can never be sold either way. It exists so a
 * dead listing does not linger and confuse a buyer.
 */
export async function GET(request: NextRequest) {
    const owner = request.nextUrl.searchParams.get('owner')?.trim().toLowerCase()
    if (!owner || !/^0x[a-f0-9]{40}$/.test(owner)) {
        return NextResponse.json({ error: 'Invalid owner address' }, { status: 400, headers })
    }
    if (!DROID_CONTRACT) {
        return NextResponse.json({ error: 'Droid contract not configured' }, { status: 500, headers })
    }

    try {
        const operators = await activeOperatorsFor(owner)
        return NextResponse.json({
            clear: operators.length === 0,
            collection: DROID_CONTRACT,
            operators: operators.map((address) => ({ address, label: operatorLabel(address) })),
        }, { headers })
    } catch (error: any) {
        console.error('[locker/preflight] failed:', error)
        // Never report "clear" on a failed read — that would wave a holder through with a live
        // listing still standing.
        return NextResponse.json(
            { error: 'Could not read approvals from the chain. Try again before locking.' },
            { status: 502, headers },
        )
    }
}
