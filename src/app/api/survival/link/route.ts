import { NextRequest, NextResponse } from 'next/server'
import { authCaller } from '@/lib/survivalRuns'
import { MAX_ACCOUNT_WALLETS } from '@/lib/survivalAccount'

/**
 * GET /api/survival/link — the account's wallets, for the game's Settings → WALLETS
 * (lib/survivalAccount.ts; owner, 17.10.2026).
 *
 *   → { ok, wallets: [{ wallet, main, you }], max }
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { 'cache-control': 'no-store' }

export async function GET(req: NextRequest) {
    const caller = await authCaller(req)
    if (caller instanceof NextResponse) return caller
    return NextResponse.json({
        ok: true,
        wallets: caller.wallets.map((w) => ({ wallet: w, main: w === caller.wallet, you: w === caller.session })),
        max: MAX_ACCOUNT_WALLETS,
    }, { headers: NO_STORE })
}
